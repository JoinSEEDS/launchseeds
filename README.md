# LaunchSeeds

Free Pump.fun launches, paid for by the LaunchSeeds treasury.

## How a launch works

1. **Sign in.** The creator signs one message with a Solana wallet. One launch
   per wallet a day, and a daily limit for the whole site.
2. **Describe the coin.** Name, ticker, image, description and links.
3. **Launch.** The treasury creates the coin in a Jito bundle with four wallets,
   each buying in its own transaction. Together they spend what the treasury
   holds above a small reserve.
4. **Sell.** Once the buys are final, the wallets sell one at a time: the first
   at once, the others 3, 5 and 10 seconds later. The SOL goes back to the
   treasury for the next launch.

One launch runs at a time. The coin's creator fees collect in its own wallet.

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
The treasury is the Solard wallet named `launchseeds-treasury`; fund it with SOL.

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
