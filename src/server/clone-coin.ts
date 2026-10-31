/** Reads an existing coin's public launch fields so the launch form can clone
 * it: name, ticker, image and links (on-chain Token-2022 metadata, or Metaplex
 * metadata for older SPL mints, then the metadata JSON it points to).
 * The metadata URI is attacker-controlled, so fetches go only to IPFS (fixed
 * gateway) or public https hosts, with redirects re-checked, short timeouts and
 * size caps. */
import { Connection, PublicKey } from "@solana/web3.js";

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const MAX_JSON_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type ClonedCoin = {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  website: string;
  x: string;
  telegram: string;
  /** data: URL of the validated image, or null if it could not be fetched. */
  image: string | null;
};

/** Public https URL (or ipfs://) whose host is not an address or internal name. */
export function publicUrl(raw: string): URL | null {
  const value = raw.trim().replace(/^ipfs:\/\//, IPFS_GATEWAY);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    return null;
  const host = url.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)
  )
    return null;
  return url;
}

async function boundedFetch(
  raw: string,
  maxBytes: number,
  fetcher: typeof fetch = fetch,
): Promise<{ body: Uint8Array; type: string } | null> {
  let url = publicUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      url = next ? publicUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > maxBytes) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      body.set(c, at);
      at += c.length;
    }
    return {
      body,
      type: (response.headers.get("content-type") || "")
        .split(";")[0]!
        .trim()
        .toLowerCase(),
    };
  }
  return null;
}

/** Image type from its bytes (headers can lie). */
export function sniffImage(body: Uint8Array): string | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...body.subarray(from, to));
  if (body[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function onChainMetadata(connection: Connection, mint: PublicKey) {
  const info: any = await connection.getParsedAccountInfo(mint, "confirmed");
  const parsed = info.value?.data?.parsed;
  if (!parsed || parsed.type !== "mint") throw new Error("Not a token mint");
  const meta = parsed.info.extensions?.find(
    (e: any) => e.extension === "tokenMetadata",
  )?.state;
  if (meta?.name)
    return {
      name: String(meta.name),
      symbol: String(meta.symbol),
      uri: String(meta.uri),
    };
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX.toBuffer(), mint.toBuffer()],
    METAPLEX,
  );
  const data = (await connection.getAccountInfo(pda, "confirmed"))?.data;
  if (!data) throw new Error("This coin has no metadata");
  let at = 65;
  const str = () => {
    const n = data.readUInt32LE(at);
    at += 4;
    const v = data
      .subarray(at, at + n)
      .toString("utf8")
      .replace(/\u0000+$/, "");
    at += n;
    return v;
  };
  return { name: str(), symbol: str(), uri: str() };
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const link = (value: unknown) => {
  const url = typeof value === "string" ? publicUrl(value) : null;
  return url ? url.toString() : "";
};

export async function cloneCoin(
  connection: Connection,
  mintInput: string,
  fetcher: typeof fetch = fetch,
): Promise<ClonedCoin> {
  const mint = new PublicKey(mintInput.trim());
  const meta = await onChainMetadata(connection, mint);
  const fetched = meta.uri
    ? await boundedFetch(meta.uri, MAX_JSON_BYTES, fetcher).catch(() => null)
    : null;
  let json: any = {};
  if (fetched)
    try {
      json = JSON.parse(new TextDecoder().decode(fetched.body));
    } catch {
      json = {};
    }
  let image: string | null = null;
  if (typeof json.image === "string") {
    const got = await boundedFetch(json.image, MAX_IMAGE_BYTES, fetcher).catch(
      () => null,
    );
    const type = got ? sniffImage(got.body) : null;
    if (got && type && IMAGE_TYPES.includes(type))
      image = `data:${type};base64,${Buffer.from(got.body).toString("base64")}`;
  }
  return {
    mint: mint.toBase58(),
    name: text(meta.name || json.name, 32),
    symbol: text(meta.symbol || json.symbol, 10),
    description: text(json.description, 500),
    // The new coin gets its own LaunchSeeds URL after its mint is assigned.
    website: "",
    x: link(json.twitter ?? json.x),
    telegram: link(json.telegram),
    image,
  };
}
