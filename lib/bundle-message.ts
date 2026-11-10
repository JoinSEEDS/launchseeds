/** The exact text an admin wallet signs to finalize a coin: every column and
 * bundle still holding sells at market, and stuck ones are recovered. Proceeds
 * go where the launch published (the admin chooses nothing). */
export function finalizeMessage(
  mint: string,
  wallet: string,
  issuedAt: number,
  action: "finalize" | "liquidate" = "finalize",
): string {
  return `LaunchSeeds admin ${action === "liquidate" ? "liquidate everything" : "finalize"}
Coin: ${mint}
By: ${wallet}
Issued: ${new Date(issuedAt).toISOString()}`;
}
