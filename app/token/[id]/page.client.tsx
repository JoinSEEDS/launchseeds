import { mountScheduledPlan } from "../../../lib/scheduled-plan-mount";
import { mountAdminFinalize } from "../../../lib/admin-finalize";
import { mountChallenges } from "../../../lib/challenges-mount";

export default function mount() {
  const stopAdmin = mountAdminFinalize();
  if (!document.querySelector("[data-scheduled-plan]")) return stopAdmin;
  const stopPlan = mountScheduledPlan();
  const stopChallenges = mountChallenges();
  return () => { stopAdmin(); stopPlan?.(); stopChallenges(); };
}
