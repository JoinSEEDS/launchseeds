import { createHash } from "node:crypto";
import { bindClientIdentity } from "../../lib/trusted-client";
/** Only the actual Bun socket peer is trusted. The server binds loopback, so a
 * loopback peer is either a local client or the Caddy reverse_proxy, which
 * sets X-Forwarded-For to the real visitor IP. Its rightmost entry is the one
 * Caddy itself added, so client-supplied entries to its left are ignored. */
export function localIngress(request:Request,peer:string|null):Request {
 if(!peer||!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(peer))throw new Error("Local runtime requires a loopback peer");
 const visitor=(request.headers.get("x-forwarded-for")||"").split(",").pop()?.trim();
 // Per-visitor rate-limit key; hashed so raw IPs are not used as identifiers.
 const identity=visitor?`ip:${createHash("sha256").update(visitor).digest("hex").slice(0,32)}`:"local-loopback";
 return bindClientIdentity(request,identity);
}
