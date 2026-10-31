# LaunchSeeds - scheduled, transparent token launches

LaunchSeeds is a Bun/TradJS application with SQLite repositories and a separately supervised worker. The launchpad presents tokens as cards and publishes each new launch's schedule, three protection wallets, exact allocations, sell target and profit destination.

New launches are scheduled2minutes to7days ahead. Users allocate100% of protection across three wallets (each at least0.03SOL), then fund a time-limited quote. Published quotes reserve capital; timely payments retain that reservation until execution. The worker cannot prepare/send creation before the chosen time. Network confirmation and available capital determine actual inclusion; late payment requires refund review instead of silently launching later.

Profit can go to a validated SOL wallet or buy back and burn the launched token. Wallet payouts keep0.00005SOL for fees; buy/burn keeps0.005SOL for fees/rent and requires0.002SOL left for the purchase. Small profits stay in the fund. Only finalized purchased-token deltas are burned, with signed intents persisted before submission. Scheduled trade profit excludes the separate launch-fee wallet. Cashback is unavailable while its loss definition awaits confirmation.

`/coin/<reserved-CA>` shows the coin before and after launch, with a live countdown, published plan and (after launch) price chart. Legacy `/schedule/<plan-hash>` links remain compatible. Choose minutes from now (3 minutes to 7 days) or an absolute local date/time; the quote locks the UTC timestamp. `/api/schedules/<plan-hash>` includes the canonical commitment object; SHA256 of its JSON is the displayed hash. This is a server-persisted public commitment, not an on-chain anti-tampering guarantee. Existing launches, claims and legacy reward histories remain supported. The new UI removes retired strategy, puzzle, liquidity and reward-fund choices.

Run `bun install`, `bun run check`, `bun test`, `bun run build`. Local web startup: `bun run dev`. Configuration and wallet keys stay in ignored `.config.toml`; worker/live operations require explicit configuration. See [scheduled launches](docs/SCHEDULED-LAUNCHES.md) and the existing operational notes below.

The launchpad uses database cursor pagination (24 cards per page), with server-side name/ticker/CA search and All/Scheduled/Live filters. Previous/Next links preserve the query and work without JavaScript. `/api/launch-catalog` returns card pages; `/api/tokens` returns a bounded live-token page plus pagination metadata. Cursors are bound to the search and domain scope.

Project descriptions support 4,000 characters and line breaks. Create and unfunded edits preserve the text in metadata and the published plan. New version-3 commitments include it; historical hashes keep their original format. Receiving funds locks edits. Protection wallets remain separate, while settled-profit buybacks use the shared capital wallet.

## Files

Bundle sweeps retain expired signed attempts in `bundleSweepAttempts`. A replacement
requires finalized expiry followed by fresh history-status and transaction absence;
RPC failures and observed transactions cannot authorize a replacement. Funded
launches persist capital wait reasons so the queue is visible to operators.

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

Automatic bundle exits use a pre-signed fixed-minimum sale (102% of each wallet's buy budget, before network fees), persisted at fill confirmation and checked on the fast launch loop. Unsent candidates renew before blockhash expiry. Automatic capital rotation respects this floor; explicit operator liquidation is separate.
Protection sizing is capped before payment using a worker-produced liquid-budget snapshot. Unsold positions and earmarked reward funds are excluded. The form offers smaller sizes or a launch without protection; the backend independently checks the ceiling before exposing payment details. This is a per-launch ceiling, not a reservation or a promise that rotating capital is immediately available. Existing funded requests remain unchanged.


BOOST buyback timing and owner-approved raffle delivery: [operator and behavior guide](docs/BOOST-REWARD-APPROVAL.md). A new `launchseeds.reward_approval_wallet` is required to approve future winner transfers; no historical owner-wallet fallback is used.

LaunchSeeds domain configuration, fixed history cutoff, public reserved CAs and creator-fee choice: [LaunchSeeds guide](docs/LAUNCHSEEDS.md).
