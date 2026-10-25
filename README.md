# Launchseeds — finalized data layer

This package contains the authoritative **13-table Zod schema**, explicit SQLite indexes,
**unified table-split repository implementation**, and transaction examples. It is the
persistence layer, **not a complete mainnet application or integrated service runtime**.

## Files

- `src/db/schema.ts` — persisted model and shared `StrategyConfig` union
- `src/db/indexes.ts` — unique/partial indexes; run after ORM creates tables
- `src/db/connection.ts` — opens sqlite-zod-orm, WAL, and indexes
- `src/db/repo/*.ts` — table repository modules, deterministic queries, compare-and-set transitions
- `src/db/repo/index.ts` — one `repo` surface with `repo.tx((tx) => ...)`
- `src/db/workflows.ts` — examples: credit verified fee, reserve funded execution, settle, fund platform buyback
- `tests/sql-invariants.py` — SQLite index smoke test using a Python-generated matching table shell

## Installation

```sh
bun install
bun run check
bun test
```

Example usage:

```ts
import { openLaunchseedsData } from './src/db';
const { repo } = openLaunchseedsData('./data/launchseeds.sqlite');
const token = repo.tokens.get('your-token-uid');
const tally = repo.votes.tally('your-token-uid');
```

## Locked product decisions

1. **Backend-funded launch**; tokens and launch state share one row (`tokens`, B1).
2. **Gravity A:** materialized every minute, no retroactive backfill. We store
   `gravityMicros` (1 Gravity = 1 USD-minute = 1,000,000 units). Source quantities
   are atomic strings. A service supplies an observed `priceUsdPicos` integer;
   the repository credits `balanceRaw * priceUsdPicos / (10^tokenDecimals * 10^6)`.
3. **Continuous votes** use current stored Gravity and one vote per wallet/token.
   `activeStrategyId`, `leaderStrategyId` and `leaderSince` are the only governance
   state fields in tokens; the domain algorithm enforces the 180-second takeover.
4. **Treasury C, asset A:** cache SOL atomic balances plus append-only movement ledger;
   hold SOL until a strategy needs another asset.
5. **Fee trigger UNCLAIMED:** unclaimed *community* share alone crosses the strategy
   target. Only *confirmed* on-chain receipts are credited and reserved.
6. **Funded-unfulfilled executions:** insert reservation + execution in one transaction;
   make it immediately visible. Actual fulfillment runs independently by execution ID.
7. **Collectibles B:** cached packs catalog; Collector Crypt pending memo and signed
   payment reference belong to `executions`; delivered NFT belongs to `cards`.
8. **Platform A:** separate `tokenBuybacks`; fixed $500-equivalent batches.
9. **Automatic delivery:** no payout escrow, claims, round tables, or generic queue.

## Financial correctness notes

- `treasuries.availableAtomic` and `.reservedAtomic` are caches. Every change must be
  matched by a `ledger` entry **in the same transaction**. There are example routines
  in `workflows.ts`; applications should not call `treasuries.applyDelta()` standalone.
- SQLite cannot atomically commit an external Solana transaction. Store the signed
  transaction in a secure store and record its reference before broadcasting. Reconcile
  ambiguous results instead of sending a fresh transaction blindly.
- Every signed voting intent must bind the chain, token, wallet, strategy key, and nonce;
  `repo.votes.set` only implements replay-resistant monotonic persistence, not signature verification.
- `feeClaims`/`fees` represent **protocol creator-fee collection**, not recipient claims.
- Recipient wallet resolution for X/GitHub is an external, trusted service. If no
  verified wallet is found, the strategy must remain non-executable; never guess.
- For packs/stocks, SOL-denominated reservations may need additional funding if prices
  change before fulfillment. No reservation guarantees fixed USD purchasing power.
- In a production deployment, finalize database migrations, referential integrity,
  encryption of signing references, transaction error/lease recovery, and test every
  chain/provider adapter against current SDK versions.

## Validation status

Source syntax and SQLite index SQL are checked offline. Bun packages are not available
in this environment, so **`bun install`, `bun run check`, and the live ORM transaction
integration tests have not been run**. Verify those on the target development machine.

## Added domain services (Holder + Gravity + Strategies + Governance)

- `src/domain/holders.ts` — holding period on enter/exit; historic Gravity retained
- `src/domain/gravity.ts` — fixed-point price parsing and dollar-minute scoring
- `src/domain/strategies.ts` — canonical strategy configuration and key
- `src/domain/governance.ts` — strict unique leader and 180-second takeover
- `src/services/{holders,gravity,strategies,governance}.ts` — real services built on the existing repo
- `src/services/index.ts` — service composition; callbacks refresh leadership after balance changes/ticks
- `src/integrations/holders.ts` — chain price/balance/snapshot contracts (implement with Solard)
- `src/integrations/votes.ts` — actual signed-vote verification contract and binding message
- `tests/services.test.ts` — integration scenarios for snapshots, Gravity and votes

No background worker loops or mainnet signing adapters are bundled. That is the next stage.

### Example composition

```ts
import { openLaunchseedsData } from './src/db';
import { createLaunchseedsCoreServices } from './src/services';

const { repo } = openLaunchseedsData('./data/launchseeds.sqlite');
const services = createLaunchseedsCoreServices({
  repo,
  holders: solardHolderAdapter,    // implements HolderSource
  market: solardUsdPriceAdapter,   // implements MarketSource
  voteVerifier: walletVoteVerifier, // real ed25519 validator
  chain: 'solana:mainnet-beta',
});

await services.holders.syncTradeParticipants(tokenId, [buyer, seller]);
await services.gravity.accrueMinute(tokenId);
await services.governance.castVote(signedVote);
```

**Important:** Do not ship a `VoteVerifier` that accepts any signature. It must validate the canonical message against the public key of the voter. The `MarketSource` returns a USD price (as a decimal string), *not* a SOL/token quotation. An incomplete snapshot must never zero missing holders. The score is accrued once per observed minute, not backfilled for missed minutes.

For financial or voting errors, `src/services/measured.ts` preserves thrown errors rather than silently accepting measure-fn's default null fallback.

The preceding repository package has not been validated with Bun in this runtime, and neither this extension nor the integration tests are claimed to have passed without that validation.


### Local runtime and metadata

Use bgrun with the private `.config.toml`: `bun run start 3010` starts the
loopback-only TradJS app and, through the bgrun SDK, ensures its single worker
(`launchseeds-worker`, `bun run scripts/worker.ts`) is running. Rate-limit identities
come from the X-Forwarded-For IP set by Caddy `reverse_proxy 127.0.0.1:3010`. The launch provider
pins token image and metadata through Solard's Pump IPFS uploader and persists
the returned URI; a public application URL is not required for metadata.
The configured public mainnet RPC and a healthy worker are still required.
In production, run the same `bun run start` behind Caddy; keep it bound to
127.0.0.1 so Caddy is the only way in.
