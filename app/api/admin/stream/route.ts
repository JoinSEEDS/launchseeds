import {
  adminError,
  requireAdmin,
  AdminHttpError,
  cookieValue,
  SESSION_SECONDS,
} from "../../../../lib/admin/security";
import {
  readProcessLogs,
  registeredProcess,
  type StreamKind,
} from "../../../../lib/admin/bgrun";

const MAX_CONNECTIONS = 12;
const MAX_STREAM_DURATION_MS = 4 * 60_000;
const POLL_MS = 3_000;
let activeConnections = 0;

export async function GET(request: Request): Promise<Response> {
  try {
    requireAdmin(request);
    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "";
    const kind = url.searchParams.get("stream") || "both";
    if (kind !== "both" && kind !== "stdout" && kind !== "stderr")
      throw new AdminHttpError("Invalid log stream", 400);
    await registeredProcess(name);
    if (activeConnections >= MAX_CONNECTIONS)
      throw new AdminHttpError("Too many log streams", 429);
    activeConnections++;
    // A stream opened shortly before session expiry must not extend access.
    const issuedSeconds = Number(cookieValue(request)?.split(".")[0] || 0);
    const remainingSessionMs = Math.max(
      1,
      issuedSeconds * 1_000 + SESSION_SECONDS * 1_000 - Date.now(),
    );

    const encoder = new TextEncoder();
    let poll: ReturnType<typeof setInterval> | null = null;
    let cutoff: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let inFlight = false;
    let last = "";
    let sink: ReadableStreamDefaultController<Uint8Array>;
    const send = (event: string, value: unknown) => {
      if (finished) return;
      const payload = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
      try {
        sink.enqueue(encoder.encode(payload));
      } catch {
        stop();
      }
    };
    const stop = () => {
      if (finished) return;
      finished = true;
      if (poll) clearInterval(poll);
      if (cutoff) clearTimeout(cutoff);
      request.signal.removeEventListener("abort", stop);
      activeConnections = Math.max(0, activeConnections - 1);
      try {
        sink?.close();
      } catch {
        /* stream already closed */
      }
    };
    const tick = async () => {
      if (finished || inFlight) return;
      inFlight = true;
      try {
        const logs = await readProcessLogs(name, kind as StreamKind, 100);
        const encoded = JSON.stringify(logs);
        if (last !== encoded) {
          last = encoded;
          send("snapshot", { ...logs, checkedAt: Date.now() });
        } else send("heartbeat", { checkedAt: Date.now() });
      } catch {
        send("warning", { message: "Log output is temporarily unavailable." });
      } finally {
        inFlight = false;
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sink = controller;
        send("connected", { name });
        void tick();
        poll = setInterval(() => void tick(), POLL_MS);
        cutoff = setTimeout(
          stop,
          Math.min(MAX_STREAM_DURATION_MS, remainingSessionMs),
        );
        request.signal.addEventListener("abort", stop, { once: true });
      },
      cancel() {
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform, private",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    return adminError(error);
  }
}
