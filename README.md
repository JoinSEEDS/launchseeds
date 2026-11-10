# LaunchSeeds

A launchpad for Pump.fun coins with scheduled, published launch plans.

A launcher picks a launch time and splits the launch buy across up to four
columns of wallets. Each column buys in the same Jito bundle that creates the
coin, so nobody can buy before them. The plan is published, with every wallet,
its buy and its sell rule, before the coin exists.

## How a launch works

1. **Plan.** Name, ticker, image, launch time, and the columns: how many wallets,
   what each buys, and when they sell. Optional tranches buy after the launch.
2. **Pay.** The form shows one deposit address and the exact amount: every buy,
   each wallet's network reserve, and the launch fee.
3. **Launch.** At the launch time the worker sends one Jito bundle: the coin's
   creation, then one buy transaction per column.
4. **Sell.** Each column sells all its wallets together on its own rule: a profit
   target, a time, at once, or a market-cap floor that the sale must leave
   behind. A tranche can also sell one wallet at a time.
5. **Pay out.** After a sale, the column's SOL goes to the proceeds wallet in
   the plan.

The coin's creator fees go to the creator-fee wallet in the plan.

## Run it

Requires [Bun](https://bun.sh) and a Solana RPC endpoint.

```sh
bun install
cp .env.example .env   # then fill it in
bun run dev            # the site on http://127.0.0.1:3010
bun run scripts/worker.ts   # the launch worker, in a second terminal
```

Nothing sends a transaction until `LAUNCHSEEDS_LIVE_OPERATIONS`,
`LAUNCHSEEDS_LAUNCH_ENABLED` and `LAUNCHSEEDS_WORKER_ENABLED` are all `true`.

## Check it

```sh
bun run check   # TypeScript
bun test
```

## Layout

- `app/` pages and API routes ([TradJS](https://www.npmjs.com/package/tradjs) file routing)
- `lib/` browser and shared helpers, including the launch form's columns
- `src/domain/` launch settings, columns and the published plan
- `src/server/` launch service, bundle building, column engine, worker
- `src/db/` SQLite schema and repositories
- `scripts/` web server, worker and the vanity mint pool
