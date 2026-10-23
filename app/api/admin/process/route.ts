import {
  adminError,
  adminResponse,
  enforceAdminAction,
  AdminHttpError,
} from "../../../../lib/admin/security";
import { changeProcess, parseAction } from "../../../../lib/admin/bgrun";
import { auditAdminAction } from "../../../../lib/admin/audit";

const busy = new Set<string>();

export async function POST(request: Request): Promise<Response> {
  let name = "";
  let action = "";
  let locked = false;
  let auditRequested = false;
  try {
    enforceAdminAction(request);
    if (
      !(request.headers.get("content-type") || "").startsWith(
        "application/json",
      )
    )
      throw new AdminHttpError("Expected JSON", 415);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1024)
      throw new AdminHttpError("Request too large", 413);
    const parsed = parseAction(JSON.parse(raw));
    name = parsed.name;
    action = parsed.action;
    if (busy.has(name))
      throw new AdminHttpError("Process action already in progress", 409);
    busy.add(name);
    locked = true;
    // Fail closed if the operator audit log cannot be written.
    await auditAdminAction(request, action, name, "requested");
    auditRequested = true;
    await changeProcess(parsed.name, parsed.action);
    // A failed second audit write must not report an already-executed
    // lifecycle operation as failed (and provoke a duplicate retry).
    let auditIncomplete = false;
    try {
      await auditAdminAction(request, action, name, "completed");
    } catch {
      auditIncomplete = true;
    }
    return adminResponse({ ok: true, name, action, auditIncomplete });
  } catch (error) {
    if (auditRequested) {
      try {
        await auditAdminAction(request, action, name, "failed");
      } catch {
        /* Original command failure takes precedence. */
      }
    }
    if (error instanceof SyntaxError)
      return adminResponse({ error: "Invalid JSON" }, 400);
    return adminError(error);
  } finally {
    if (locked) busy.delete(name);
  }
}
