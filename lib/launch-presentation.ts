/** Pure view-state for launch availability: a temporary outage is not a clickable CTA. */
import { launchTotal, parseSol } from "./launch-ui";

export const DESIGN_LAUNCH_FEE_LAMPORTS = 20_000_000;

export interface PublicLaunchConfig {
  launchEnabled: boolean;
  baseFeeLamports: number | null;
  message?: string;
}

export interface LaunchAvailabilityView {
  showAction: boolean;
  showUnavailable: boolean;
  disabled: boolean;
  message: string;
  buttonLabel: string;
  fee: string;
  total: string;
}

export function fixedFeeText(lamports: number | null): string {
  if (lamports === null) lamports = DESIGN_LAUNCH_FEE_LAMPORTS;
  if (!Number.isSafeInteger(lamports) || lamports <= 0) return "Not configured";
  return `${(lamports / 1e9).toFixed(2)} SOL`;
}

export function launchAvailability(
  config: PublicLaunchConfig | null,
  devBuy: string,
  state: { checking: boolean; busy: boolean; connected: boolean },
): LaunchAvailabilityView {
  const fee = config?.baseFeeLamports ?? DESIGN_LAUNCH_FEE_LAMPORTS;
  const enabled = config?.launchEnabled === true;
  const showAction = !state.checking && enabled;
  const showUnavailable = !state.checking && !enabled;
  const entered = parseSol(devBuy);
  const total =
    fee === null
      ? entered === null
        ? "0"
        : (Number(entered) / 1e9).toString()
      : (launchTotal(devBuy, fee) ?? "0");
  return {
    showAction,
    showUnavailable: state.checking || showUnavailable,
    disabled: !enabled || state.busy,
    message: state.checking || config === null
      ? "Checking launch availability…"
      : enabled
        ? ""
        : "Launch connection is recovering. Retrying automatically...",
    buttonLabel: state.busy
      ? "Preparing payment…"
      : "Continue to Payment",
    fee: fixedFeeText(fee),
    total,
  };
}
