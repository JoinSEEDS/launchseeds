import { getStore } from "../../../src/server/runtime";
import { scheduledCoinUrl } from "../../../src/server/scheduled-launches";

export default function middleware(req: Request) {
  const url = new URL(req.url);
  const planHash = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  const coinUrl = scheduledCoinUrl(getStore(), planHash);
  if (!coinUrl) return;
  return new Response(null, {
    status: 308,
    headers: { location: coinUrl },
  });
}
