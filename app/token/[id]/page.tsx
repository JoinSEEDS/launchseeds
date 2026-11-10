import { ScheduledCoin } from "../../components/scheduled-coin";
import { publicPlanForMint, publicScheduledPlan } from "../../../src/server/scheduled-launches";
import { getStore } from "../../../src/server/runtime";

/** A coin's page: its launch plan before launch, then the live coin. Found by its
 * CA, or by its plan hash while the CA is unpublished. */
export default function TokenPage({ params }: { params: { id: string } }) {
  const store = getStore();
  const byMint = store.repo.tokens.getByMint(params.id);
  const saved = byMint ? store.repo.scheduledPlans.byToken(byMint.id) : null;
  const plan = (saved ? publicScheduledPlan(store, saved.planHash) : null) ?? publicPlanForMint(store, params.id) ?? publicScheduledPlan(store, params.id);
  if (plan) return <ScheduledCoin plan={plan} />;
  return (
    <main className="page">
      <h1 className="page-title">Coin not found</h1>
      <a href="/">Launchpad</a>
    </main>
  );
}
