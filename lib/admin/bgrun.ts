/** bgrun integration using its documented CLI. No shell, no dynamic binary
 * commands, no filesystem paths derived from the browser, and no unbounded
 * process output. The installed bgrun CLI owns all process lifecycle state.
 */
import { spawn } from "node:child_process";
import { AdminHttpError } from "./security";

export type AdminAction = "stop" | "restart" | "delete";
export type StreamKind = "stdout" | "stderr" | "both";
export interface ProcessSummary {
  name: string;
  status: string;
  pid: number | null;
  port: number | null;
  uptimeSeconds: number | null;
  restarts: number | null;
  group: string | null;
  manageable: boolean;
}

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
// `bgrun --json` includes every registered process with its env, so it grows
// with the host's registry (140KB+ observed); keep a bound, but a generous one.
const MAX_LIST_BYTES = 8 * 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_LINES = 120;
const COMMAND_TIMEOUT_MS = 7_000;

export function parseConfiguredNames(value: string | undefined): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => NAME_RE.test(name)),
  );
}

export function manageable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    NAME_RE.test(name) &&
    parseConfiguredNames(env.LAUNCHSEEDS_ADMIN_CONTROL_PROCESSES).has(name)
  );
}

export function validProcessName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

/** Stub-able command adapter; process arguments are never interpolated in shell text. */
export async function runBgrun(
  args: string[],
  maxBytes = MAX_LIST_BYTES,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("bgrun", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let bytes = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(out);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("bgrun timed out"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill("SIGKILL");
        finish(new Error("bgrun output exceeds limit"));
      } else out += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      err = `${err}${chunk.toString("utf8")}`.slice(-2048);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) finish(new Error(`bgrun failed with exit code ${code}`));
      else finish();
    });
  });
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const integer = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

/** The CLI has used array and envelope output across releases; both accepted. */
export function parseProcessList(
  json: string,
  env: NodeJS.ProcessEnv = process.env,
): ProcessSummary[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new Error("Invalid process list JSON");
  }
  const entries = Array.isArray(decoded) ? decoded : obj(decoded).processes;
  if (!Array.isArray(entries)) throw new Error("Unsupported bgrun list format");
  const seen = new Set<string>();
  const results: ProcessSummary[] = [];
  for (const entry of entries.slice(0, 500)) {
    const row = obj(entry);
    const name = text(row.name) || text(row.processName);
    if (!name || !NAME_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    const status =
      text(row.status) || (row.running === true ? "running" : "unknown");
    const ports = Array.isArray(row.ports) ? row.ports : [];
    const port = integer(row.port) ?? integer(ports[0]);
    const uptimeSeconds = integer(row.uptimeSeconds) ?? integer(row.uptime);
    results.push({
      name,
      status: status.slice(0, 32),
      pid: integer(row.pid),
      port,
      uptimeSeconds,
      restarts: integer(row.restarts) ?? integer(row.restartCount),
      group:
        (text(row.group) || text(row.directoryGroup))?.slice(0, 64) || null,
      manageable: manageable(name, env),
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** The bgrun registry is host-wide; admin only sees (and can read logs of)
 * this app's configured processes, never unrelated services on the host. */
export async function listProcesses(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProcessSummary[]> {
  return parseProcessList(await runBgrun(["--json"]), env).filter(
    (process) => process.manageable,
  );
}

export async function registeredProcess(name: string): Promise<ProcessSummary> {
  if (!validProcessName(name))
    throw new AdminHttpError("Invalid process name", 400);
  const match = (await listProcesses()).find(
    (process) => process.name === name,
  );
  if (!match) throw new AdminHttpError("Process not found", 404);
  return match;
}

export function parseAction(input: unknown): {
  name: string;
  action: AdminAction;
} {
  const value = obj(input);
  if (
    !validProcessName(value.name) ||
    (value.action !== "stop" &&
      value.action !== "restart" &&
      value.action !== "delete")
  )
    throw new AdminHttpError("Invalid process action", 400);
  return { name: value.name, action: value.action };
}

export async function changeProcess(
  name: string,
  action: AdminAction,
): Promise<void> {
  if (!manageable(name))
    throw new AdminHttpError("Process control not permitted", 403);
  await registeredProcess(name); // Prevent arbitrary process creation or unknown targets.
  await runBgrun([`--${action}`, name], 16 * 1024, 15_000);
}

/** This is a bounded snapshot, not a tail -f subprocess. SSE pushes updated
 * snapshots to browser clients, avoiding leaking detached child processes.
 */
export async function readProcessLogs(
  name: string,
  kind: StreamKind,
  lines = 80,
): Promise<{
  stdout: string;
  stderr: string;
}> {
  await registeredProcess(name);
  const count = Math.min(MAX_LOG_LINES, Math.max(1, Math.trunc(lines)));
  const read = async (stream: "stdout" | "stderr") => {
    const raw = await runBgrun(
      [
        name,
        "--logs",
        stream === "stdout" ? "--log-stdout" : "--log-stderr",
        "--lines",
        String(count),
      ],
      MAX_LOG_BYTES,
    );
    return redactLogs(raw).slice(-MAX_LOG_BYTES);
  };
  const [stdout, stderr] = await Promise.all([
    kind === "stderr" ? Promise.resolve("") : read("stdout"),
    kind === "stdout" ? Promise.resolve("") : read("stderr"),
  ]);
  return { stdout, stderr };
}

/** Defensive only: no pattern library can guarantee arbitrary secrets are
 * absent. Never grant untrusted users admin access or log sensitive values.
 */
export function redactLogs(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(
      /((?:api[_-]?key|password|secret|private[_-]?key|token)\s*[:=]\s*)[^\s,;"']+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/[^\s?#]+\?)[^\s]+/gi, "$1[query redacted]");
}
