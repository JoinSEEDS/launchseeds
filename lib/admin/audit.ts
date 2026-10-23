/** Minimal append-only operator action trail. No credentials or log bodies. */
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { cookieValue } from "./security";

export async function auditAdminAction(
  request: Request,
  action: string,
  name: string,
  result: "requested" | "completed" | "failed",
): Promise<void> {
  const destination = resolve(
    process.env.LAUNCHSEEDS_ADMIN_AUDIT_PATH || "./data/admin-audit.ndjson",
  );
  const session = cookieValue(request) || "";
  const sessionTag = createHash("sha256")
    .update(session)
    .digest("hex")
    .slice(0, 16);
  const line =
    JSON.stringify({
      time: new Date().toISOString(),
      session: sessionTag,
      action,
      process: name,
      result,
    }) + "\n";
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await appendFile(destination, line, { encoding: "utf8", mode: 0o600 });
}
