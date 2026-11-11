/** What an admin signs to launch a queued coin now, or remove it from the queue. */
export type QueueDecision = { wallet: string; key: string; decision: "approve" | "reject"; issuedAt: number; nonce: string };
export const queueDecisionMessage = (r: QueueDecision) =>
  `LaunchSeeds ${r.decision === "approve" ? "launch now" : "remove from queue"}
Launch: ${r.key}
Wallet: ${r.wallet}
Nonce: ${r.nonce}
Issued: ${new Date(r.issuedAt).toISOString()}`;
