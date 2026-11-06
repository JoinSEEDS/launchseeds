import { tokenVisible } from "./site-brand";
import { reservedMint } from "../domain/reserved-mint";
import { scheduledCommitment } from "../domain/scheduled-plan";
import type { Store } from "./store";
import { storedLaunchSettings } from "../domain/launch-settings";
import { bundleView } from "./bundle-view";
import type { BundleBuyer } from "./launch-bundle";
export function publicScheduledPlan(
  store: Store,
  planHash: string,
  now = Date.now(),
) {
  if (!/^[a-f0-9]{64}$/.test(planHash)) return null;
  const plan = store.repo.scheduledPlans.byHash(planHash);
  const token = plan && store.repo.tokens.get(plan.tokenId);
  if (!plan || !token || token.status === "preparing" || !tokenVisible(token)) return null;
  const settings = storedLaunchSettings(token.launchSettingsJson);
  if (settings.scheduledAt === null) return null;
  const funded =
    BigInt(token.fundingReceivedLamports) >= BigInt(token.requiredLamports) &&
    BigInt(token.requiredLamports) > 0n;
  const deadline = Math.min(
    settings.scheduledAt,
    token.quoteExpiresAt ?? settings.scheduledAt,
  );
  const confirmedInTime =
    store.repo.deposits
      .listByToken(token.id)
      .filter((d) => d.confirmedAt <= deadline)
      .reduce((n, d) => n + BigInt(d.lamports), 0n) >=
    BigInt(token.requiredLamports);
  const missed = !confirmedInTime && now >= deadline;
  const due = now >= settings.scheduledAt;
  const status =
    token.status === "live"
      ? "live"
      : token.status === "deploying"
        ? "launching"
        : token.status === "failed"
          ? "review"
          : missed
            ? "missed"
            : due
              ? funded
                ? "delayed"
                : "missed"
              : funded
                ? "scheduled"
                : "awaiting_payment";
  return {
    commitment: scheduledCommitment(
      token,
      settings,
      JSON.parse(plan.buyersJson) as BundleBuyer[],
    ),
    planHash,
    name: token.name,
    description: token.description,
    symbol: token.symbol,
    image: token.image,
    scheduledAt: settings.scheduledAt,
    status,
    funded,
    createdAt: token.createdAt,
    launchedAt: token.launchedAt,
    mint: token.status === "live" || settings.publishMint ? reservedMint(token) : null,
    holderRewards: settings.holderRewards,
    userBatches: settings.userBatches,
    batchRuns: settings.userBatches ? store.repo.userBatches.byToken(token.id).map(row=>{
      const state=JSON.parse(row.stateJson);
      return {batchIndex:row.batchIndex,status:String(state.status),buyCostLamports:String(state.buyCostLamports),netSaleLamports:state.netSaleLamports as string|null,paidLamports:state.paidLamports as string|null,buySignature:state.buy?.signature as string|undefined,soldWallets:Number(state.ladderIndex??0),saleSignature:state.sale?.signature as string|undefined,payoutSignature:state.payout?.signature as string|undefined};
    }) : [],
    feesTo: settings.feesTo,
    launchSignature: token.deploySignature,
    totalLamports: String(settings.bundleLamports),
    walletSharesBps: settings.walletSharesBps!,
    wallets: (JSON.parse(plan.buyersJson) as BundleBuyer[]).map((b) => ({
      batchIndex: b.batchIndex,
      tranche: b.tranche,
      role: b.role,
      // A signer's pool name (ace, art, ...) is public; fresh wallets need none.
      name: b.role === "signer" ? b.name : null,
      wallet: b.wallet,
      budgetLamports: b.budgetLamports,
    })),
    boost: settings.boost,
    exitPercent: settings.bundleExitPercent,
    profitPolicy: settings.profitPolicy!,
    bundle: bundleView(store, token.id),
    note:
      status === "delayed"
        ? "Launch time reached. Execution is delayed while capital or chain confirmation is pending."
        : status === "missed"
          ? "Payment deadline passed without timely confirmation. Do not send funds; late payments require refund review."
          : status === "awaiting_payment"
            ? "Payment is not confirmed; this launch is not yet funded."
            : status === "scheduled"
              ? "Payment confirmed. Creation will not be sent before the scheduled time."
              : "",
  };
}
export type ScheduledLaunchView = NonNullable<
  ReturnType<typeof publicScheduledPlan>
>;

/** Canonical public coin URL once a schedule publishes its reserved CA. */
export function scheduledCoinUrl(store: Store, planHash: string) {
  const plan = publicScheduledPlan(store, planHash);
  return plan?.mint ? `/coin/${plan.mint}` : null;
}

export function scheduledLaunches(store: Store) {
  return store.data.database.scheduledPlans
    .select()
    .orderBy("createdAt", "desc")
    .all()
    .map((p) => publicScheduledPlan(store, p.planHash))
    .filter((p): p is ScheduledLaunchView => p !== null);
}

export function publicPlanForMint(store: Store, mint: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const token = store.data.database.tokens.select().where({mintSignerRef:`launchseeds-mint-${mint}`}).get();
  if (!token || !tokenVisible(token)) return null;
  const plan = store.repo.scheduledPlans.byToken(token.id);
  return plan ? publicScheduledPlan(store,plan.planHash) : null;
}
