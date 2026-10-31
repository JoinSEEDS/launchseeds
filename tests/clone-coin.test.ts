import { expect, test } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { cloneCoin, publicUrl, sniffImage } from "../src/server/clone-coin";

test("only IPFS and public https hosts are fetched", () => {
  expect(publicUrl("ipfs://QmAbc")?.toString()).toBe(
    "https://gateway.pinata.cloud/ipfs/QmAbc",
  );
  expect(publicUrl("https://metadata.example.xyz/a.json")).not.toBeNull();
  for (const bad of [
    "http://example.com/a",
    "https://127.0.0.1/a",
    "https://localhost/a",
    "https://[::1]/a",
    "https://10.0.0.5/x",
    "https://user:pw@example.com/",
    "https://example.com:8443/",
    "https://intranet/",
    "file:///etc/passwd",
    "https://box.internal/",
  ])
    expect(publicUrl(bad)).toBeNull();
});

test("images are recognised by their bytes", () => {
  expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe(
    "image/png",
  );
  expect(sniffImage(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe(
    "image/webp",
  );
  expect(sniffImage(new TextEncoder().encode("<svg>"))).toBeNull();
});

test("a clone reads on-chain metadata, then its JSON and image; private redirects are refused", async () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const connection = {
    getParsedAccountInfo: async () => ({
      value: {
        data: {
          parsed: {
            type: "mint",
            info: {
              extensions: [
                {
                  extension: "tokenMetadata",
                  state: {
                    name: "The Sad Cat",
                    symbol: "SADCAT",
                    uri: "https://meta.example.io/m.json",
                  },
                },
              ],
            },
          },
        },
      },
    }),
  } as never;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const fetcher = (async (url: URL) => {
    if (url.hostname === "meta.example.io")
      return Response.json({
        description: "sad",
        image: "https://cdn.example.io/i.png",
        twitter: "https://x.com/a/status/1",
        website: "https://source-coin.example",
      });
    if (url.hostname === "cdn.example.io")
      return new Response(png, { headers: { "content-type": "text/plain" } });
    return new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/secret" },
    });
  }) as unknown as typeof fetch;
  const coin = await cloneCoin(connection, mint, fetcher);
  expect(coin).toMatchObject({
    mint,
    name: "The Sad Cat",
    symbol: "SADCAT",
    description: "sad",
    x: "https://x.com/a/status/1",
    website: "",
    telegram: "",
  });
  expect(coin.image).toBe(
    `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
  );
  // An image that redirects to a private address is dropped.
  const viaRedirect = await cloneCoin(
    {
      getParsedAccountInfo: async () => ({
        value: {
          data: {
            parsed: {
              type: "mint",
              info: {
                extensions: [
                  {
                    extension: "tokenMetadata",
                    state: {
                      name: "A",
                      symbol: "A",
                      uri: "https://meta.example.io/m.json",
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    } as never,
    mint,
    (async (url: URL) =>
      url.hostname === "meta.example.io"
        ? Response.json({ image: "https://evil.example.io/i.png" })
        : new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/latest" },
          })) as unknown as typeof fetch,
  );
  expect(viaRedirect.image).toBeNull();
});
