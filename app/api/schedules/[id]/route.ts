import { getStore } from "../../../../src/server/runtime";
import { publicScheduledPlan } from "../../../../src/server/scheduled-launches";
import { apiJson } from "../../../../lib/api-security";
export function GET(request: Request) {
  const hash = new URL(request.url).pathname.split("/").pop() || "";
  const plan = publicScheduledPlan(getStore(), hash);
  return apiJson(plan ?? { error: "Launch plan not found" }, plan ? 200 : 404, {
    "cache-control": "no-store",
  });
}
