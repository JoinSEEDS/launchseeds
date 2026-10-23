import {
  adminCookie,
  adminEnabled,
  adminError,
  adminResponse,
  isAdmin,
  issueSession,
  readLogin,
  requireAdmin,
  enforceAdminAction,
} from "../../../../lib/admin/security";

export function GET(request: Request): Response {
  return adminResponse({
    authenticated: isAdmin(request),
    configured: adminEnabled(),
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await readLogin(request);
    const session = issueSession();
    return adminResponse({ authenticated: true }, 200, {
      "set-cookie": adminCookie(request, session),
    });
  } catch (error) {
    return adminError(error);
  }
}

export function DELETE(request: Request): Response {
  try {
    enforceAdminAction(request);
    requireAdmin(request);
    return adminResponse({ authenticated: false }, 200, {
      "set-cookie": adminCookie(request, "", 0),
    });
  } catch (error) {
    return adminError(error);
  }
}
