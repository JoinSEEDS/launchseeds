import {
  adminResponse,
  adminError,
  requireAdmin,
} from "../../../../lib/admin/security";
import { listProcesses } from "../../../../lib/admin/bgrun";

export async function GET(request: Request): Promise<Response> {
  try {
    requireAdmin(request);
    return adminResponse({
      processes: await listProcesses(),
      checkedAt: Date.now(),
    });
  } catch (error) {
    return adminError(error);
  }
}
