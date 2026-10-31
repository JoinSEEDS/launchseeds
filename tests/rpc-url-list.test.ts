import { expect, test } from "bun:test";
import { rpcUrlList } from "../src/server/solard";

test("backup RPC endpoints follow the main one, https only and without duplicates", () => {
  const main = "https://mainnet.helius-rpc.com/?api-key=x";
  expect(rpcUrlList(main, {})).toEqual([main]);
  expect(
    rpcUrlList(main, {
      SOLANA_RPC_BACKUP_URLS: ` https://api.mainnet-beta.solana.com, http://insecure.example, ${main}, https://api.mainnet-beta.solana.com `,
    }),
  ).toEqual([main, "https://api.mainnet-beta.solana.com"]);
});
