import { render } from "tradjs/client";
import type {
  ProcessSummary,
  StreamKind,
  AdminAction,
} from "../../lib/admin/bgrun";

interface Session {
  authenticated: boolean;
  configured: boolean;
}
interface ProcessResponse {
  processes: ProcessSummary[];
  checkedAt: number;
}
interface HealthResponse {
  checkedAt: number;
  worker: null | {
    active: boolean;
    healthy: boolean;
    stale: boolean;
    heartbeatAt: number;
    completedAt: number;
    ageSeconds: number;
    workerId: string;
  };
  launch: {
    enabled: boolean;
    workerReady: boolean;
    configReady: boolean;
    rpcReady: boolean;
  };
}
interface LogSnapshot {
  stdout: string;
  stderr: string;
  checkedAt: number;
}

const POLL_PROCESSES_MS = 5_000;
const POLL_HEALTH_MS = 10_000;

/** Only dynamic rows are rendered; stable SSR controls keep their handlers. */
export default function mount() {
  const page = document.querySelector<HTMLElement>("[data-admin]");
  if (!page) return;
  const get = <T extends HTMLElement>(selector: string) => {
    const el = page.querySelector<T>(selector);
    if (!el) throw new Error(`Missing admin element: ${selector}`);
    return el;
  };

  const login = get<HTMLElement>("#admin-login");
  const loginForm = get<HTMLFormElement>("#admin-login-form");
  const loginPassword = get<HTMLInputElement>("#admin-password");
  const loginMessage = get<HTMLElement>("#admin-login-message");
  const unavailable = get<HTMLElement>("#admin-unavailable");
  const workspace = get<HTMLElement>("#admin-workspace");
  const logout = get<HTMLButtonElement>("#admin-sign-out");
  const rows = get<HTMLElement>("#admin-process-rows");
  const processFilter = get<HTMLInputElement>("#admin-filter");
  const refresh = get<HTMLButtonElement>("#admin-refresh");
  const processCount = get<HTMLElement>("#admin-process-count");
  const runningCount = get<HTMLElement>("#admin-running-count");
  const processMessage = get<HTMLElement>("#admin-process-message");
  const detailTitle = get<HTMLElement>("#admin-detail-title");
  const detailStatus = get<HTMLElement>("#admin-selected-status");
  const actions = get<HTMLElement>("#admin-actions");
  const logSearch = get<HTMLInputElement>("#admin-log-search");
  const logOutput = get<HTMLElement>("#admin-log-output");
  const streamStatus = get<HTMLElement>("#admin-stream-status");
  const follow = get<HTMLInputElement>("#admin-follow");
  const pause = get<HTMLButtonElement>("#admin-pause");
  const actionMessage = get<HTMLElement>("#admin-action-message");
  const workerState = get<HTMLElement>("#admin-worker-state");
  const workerDetail = get<HTMLElement>("#admin-worker-detail");
  const readiness = get<HTMLElement>("#admin-readiness");
  const readinessDetail = get<HTMLElement>("#admin-readiness-detail");

  let processes: ProcessSummary[] = [];
  let selected = "";
  let logKind: StreamKind = "both";
  let latest: LogSnapshot = { stdout: "", stderr: "", checkedAt: 0 };
  let es: EventSource | null = null;
  let auth = false;
  let destroyed = false;
  let paused = false;
  let busy = false;
  let processesBusy = false;
  let healthBusy = false;
  let processTimer: ReturnType<typeof setInterval> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let sequence = 0;

  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["x-launchseeds-admin-action"] = "1";
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok) {
      if (response.status === 401 && auth) showLogin(true);
      throw new Error(value.error || `Request failed (${response.status})`);
    }
    return value;
  }

  function stopStream() {
    sequence++;
    es?.close();
    es = null;
    streamStatus.textContent = "Not connected";
  }

  function stopPolling() {
    if (processTimer) clearInterval(processTimer);
    if (healthTimer) clearInterval(healthTimer);
    processTimer = null;
    healthTimer = null;
    stopStream();
  }

  function showLogin(configured: boolean) {
    auth = false;
    stopPolling();
    workspace.hidden = true;
    logout.hidden = true;
    unavailable.hidden = configured;
    login.hidden = !configured;
  }

  function showWorkspace() {
    auth = true;
    unavailable.hidden = true;
    login.hidden = true;
    workspace.hidden = false;
    logout.hidden = false;
    processTimer = setInterval(
      () => void refreshProcesses(),
      POLL_PROCESSES_MS,
    );
    healthTimer = setInterval(() => void refreshHealth(), POLL_HEALTH_MS);
    void refreshProcesses();
    void refreshHealth();
  }

  function setActionMessage(value: string, error = false) {
    actionMessage.textContent = value;
    actionMessage.classList.toggle("is-error", error);
  }

  function renderRows() {
    const query = processFilter.value.trim().toLowerCase();
    const filtered = processes.filter((p) =>
      p.name.toLowerCase().includes(query),
    );
    render(
      <>
        {filtered.length ? (
          filtered.map((process) => (
            <tr
              className={`admin__process-row ${selected === process.name ? "is-selected" : ""}`}
              data-process-name={process.name}
              aria-selected={selected === process.name ? "true" : "false"}
            >
              <td>
                <button
                  type="button"
                  className="admin__process-link"
                  data-process-name={process.name}
                >
                  {process.name}
                </button>
                {process.group ? <small>{process.group}</small> : null}
              </td>
              <td>
                <span
                  className={`admin__state ${process.status.toLowerCase() === "running" ? "is-running" : ""}`}
                >
                  {process.status}
                </span>
              </td>
              <td className="num mono">{process.pid ?? "—"}</td>
              <td className="num mono">{process.port ?? "—"}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={4} className="empty-table">
              {processes.length
                ? "No matching processes."
                : "No bgrun processes found."}
            </td>
          </tr>
        )}
      </>,
      rows,
    );
  }

  function renderDetail() {
    const process = processes.find((p) => p.name === selected);
    detailTitle.textContent = process?.name || "Process details";
    detailStatus.textContent = process
      ? `${process.status} · PID ${process.pid ?? "—"}`
      : "Choose a process to inspect it.";
    actions.hidden = !process?.manageable;
    const restart = actions.querySelector<HTMLButtonElement>(
      '[data-admin-action="restart"]',
    );
    if (restart)
      restart.textContent =
        process?.status.toLowerCase() === "running" ? "Restart" : "Start";
    for (const button of actions.querySelectorAll<HTMLButtonElement>("button"))
      button.disabled = busy;
  }

  async function refreshProcesses() {
    if (!auth || destroyed || processesBusy) return;
    processesBusy = true;
    try {
      const result = await api<ProcessResponse>("/api/admin/processes");
      if (!auth || destroyed) return;
      processes = result.processes || [];
      processCount.textContent = processes.length.toLocaleString();
      runningCount.textContent = `${processes.filter((p) => p.status.toLowerCase() === "running").length} running`;
      processMessage.textContent = `Updated ${new Date(result.checkedAt).toLocaleTimeString()}`;
      if (selected && !processes.find((p) => p.name === selected)) {
        selected = "";
        latest = { stdout: "", stderr: "", checkedAt: 0 };
        stopStream();
      }
      renderRows();
      renderDetail();
    } catch (error) {
      processMessage.textContent =
        error instanceof Error ? error.message : "Could not load processes";
    } finally {
      processesBusy = false;
    }
  }

  async function refreshHealth() {
    if (!auth || destroyed || healthBusy) return;
    healthBusy = true;
    try {
      const value = await api<HealthResponse>("/api/admin/health");
      if (!auth || destroyed) return;
      const worker = value.worker;
      workerState.textContent = !worker
        ? "Not detected"
        : worker.active && worker.healthy && !worker.stale
          ? "Healthy"
          : "Needs attention";
      workerDetail.textContent = !worker
        ? "No heartbeat recorded"
        : `Last heartbeat ${worker.ageSeconds}s ago`;
      readiness.textContent = value.launch.enabled
        ? "Available"
        : "Unavailable";
      readinessDetail.textContent = !value.launch.configReady
        ? "Check deployment settings"
        : !value.launch.workerReady
          ? "Worker not ready"
          : !value.launch.rpcReady
            ? "RPC not ready"
            : "Operational checks passed";
    } catch {
      workerState.textContent = "Unavailable";
      readiness.textContent = "Unavailable";
      readinessDetail.textContent = "Could not verify readiness";
    } finally {
      healthBusy = false;
    }
  }

  function displayLogs() {
    const query = logSearch.value.trim().toLowerCase();
    const output =
      logKind === "stdout"
        ? latest.stdout
        : logKind === "stderr"
          ? latest.stderr
          : `${latest.stdout ? "— stdout —\n" + latest.stdout : ""}${latest.stderr ? "\n— stderr —\n" + latest.stderr : ""}`;
    const visible = query
      ? output
          .split("\n")
          .filter((line) => line.toLowerCase().includes(query))
          .join("\n")
      : output;
    // textContent is essential: log output is untrusted text, never HTML.
    logOutput.textContent =
      visible ||
      (selected
        ? "No matching log lines."
        : "Select a process to view its logs.");
    if (follow.checked) logOutput.scrollTop = logOutput.scrollHeight;
  }

  function startStream() {
    stopStream();
    latest = { stdout: "", stderr: "", checkedAt: 0 };
    displayLogs();
    if (!auth || !selected) return;
    const id = sequence;
    const source = new EventSource(
      `/api/admin/stream?name=${encodeURIComponent(selected)}&stream=${logKind}`,
      { withCredentials: true },
    );
    es = source;
    streamStatus.textContent = "Connecting";
    source.addEventListener("connected", () => {
      if (id === sequence) streamStatus.textContent = "Live";
    });
    source.addEventListener("snapshot", (event) => {
      if (id !== sequence || paused) return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as LogSnapshot;
        if (typeof data.stdout !== "string" || typeof data.stderr !== "string")
          return;
        latest = data;
        displayLogs();
        streamStatus.textContent = "Live";
      } catch {
        /* Malformed event is ignored. */
      }
    });
    source.addEventListener("warning", () => {
      if (id === sequence) streamStatus.textContent = "Retrying";
    });
    source.onerror = () => {
      if (id === sequence) streamStatus.textContent = "Reconnecting";
    };
  }

  function selectProcess(name: string) {
    if (name === selected || !processes.find((p) => p.name === name)) return;
    selected = name;
    paused = false;
    pause.textContent = "Pause";
    setActionMessage("");
    renderRows();
    renderDetail();
    startStream();
  }

  const selectRow = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-process-name]",
    );
    if (button?.dataset.processName) selectProcess(button.dataset.processName);
  };
  const updateKind = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-log-kind]",
    );
    const kind = button?.dataset.logKind;
    if (kind !== "both" && kind !== "stdout" && kind !== "stderr") return;
    logKind = kind;
    for (const item of page.querySelectorAll<HTMLButtonElement>(
      "[data-log-kind]",
    )) {
      const active = item === button;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    }
    startStream();
  };

  const execute = async (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-admin-action]",
    );
    const action = button?.dataset.adminAction;
    if (
      !selected ||
      busy ||
      (action !== "stop" && action !== "restart" && action !== "delete")
    )
      return;
    const process = processes.find((p) => p.name === selected);
    if (!process?.manageable) return;
    const verb =
      action === "restart" && process.status !== "running" ? "start" : action;
    if (
      !window.confirm(
        `${verb.toUpperCase()} process ${selected}?${action === "delete" ? " This removes its bgrun registration." : ""}`,
      )
    )
      return;
    busy = true;
    renderDetail();
    setActionMessage(`${verb} requested…`);
    try {
      await api<{ ok: boolean }>("/api/admin/process", "POST", {
        name: selected,
        action: action as AdminAction,
      });
      setActionMessage(`${verb} completed.`);
      await refreshProcesses();
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Action failed",
        true,
      );
    } finally {
      busy = false;
      renderDetail();
    }
  };

  const signIn = async (event: SubmitEvent) => {
    event.preventDefault();
    const button = loginForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    button.disabled = true;
    loginMessage.textContent = "Signing in…";
    try {
      await api<{ authenticated: boolean }>("/api/admin/session", "POST", {
        password: loginPassword.value,
      });
      loginPassword.value = "";
      loginMessage.textContent = "";
      showWorkspace();
    } catch (error) {
      loginMessage.textContent =
        error instanceof Error ? error.message : "Could not sign in";
    } finally {
      button.disabled = false;
    }
  };

  const signOut = async () => {
    try {
      await api("/api/admin/session", "DELETE");
    } catch {
      /* Expired sessions are still cleared in UI. */
    }
    showLogin(true);
  };

  const togglePause = () => {
    paused = !paused;
    pause.textContent = paused ? "Resume" : "Pause";
    if (!paused) startStream();
  };

  loginForm.addEventListener("submit", signIn);
  logout.addEventListener("click", signOut);
  rows.addEventListener("click", selectRow);
  processFilter.addEventListener("input", renderRows);
  refresh.addEventListener("click", () => void refreshProcesses());
  actions.addEventListener("click", execute);
  page
    .querySelector<HTMLElement>(".admin__log-controls .tabs")
    ?.addEventListener("click", updateKind);
  logSearch.addEventListener("input", displayLogs);
  pause.addEventListener("click", togglePause);

  void api<Session>("/api/admin/session")
    .then((session) => {
      if (destroyed) return;
      if (!session.configured || !session.authenticated)
        showLogin(session.configured);
      else showWorkspace();
    })
    .catch(() => showLogin(false));

  return () => {
    destroyed = true;
    stopPolling();
    loginForm.removeEventListener("submit", signIn);
    logout.removeEventListener("click", signOut);
    rows.removeEventListener("click", selectRow);
    processFilter.removeEventListener("input", renderRows);
    actions.removeEventListener("click", execute);
    logSearch.removeEventListener("input", displayLogs);
    pause.removeEventListener("click", togglePause);
  };
}
