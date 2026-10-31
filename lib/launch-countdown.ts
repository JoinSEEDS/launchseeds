export function launchCountdown(at: number, status: string, now = Date.now()) {
  if (status === "live") return "Launched";
  if (status === "missed") return "Schedule missed · payment deadline passed";
  if (status === "review") return "Launch needs review";
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  if (!seconds) return "Launch time reached · awaiting execution and confirmation";
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return `Launch in ${hours ? String(hours).padStart(2, "0") + ":" : ""}${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}${status === "awaiting_payment" ? " · awaiting payment" : ""}`;
}
export function mountLaunchCountdown(root: ParentNode = document) {
  const update = () => root.querySelectorAll<HTMLElement>("[data-launch-at]").forEach(element => {
    const at = Number(element.dataset.launchAt);
    if (Number.isFinite(at)) element.textContent = launchCountdown(at, element.dataset.launchStatus ?? "scheduled");
  });
  update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
}
