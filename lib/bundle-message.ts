/** The exact text the fund owner signs to liquidate a coin's bundle now and
 * choose where its profit goes. */
export function liquidateMessage(
  mint: string,
  wallet: string,
  issuedAt: number,
  profitTo: "owner" | "holders",
): string {
  return `LaunchSeeds liquidate sniper protection\nCoin: ${mint}\nProfit to: ${profitTo}\nBy: ${wallet}\nIssued: ${new Date(issuedAt).toISOString()}`;
}

/** The exact text the launcher signs to close their coin's sniper protection:
 * the bundle sells at market now, and the proceeds return to the fund. */
export function closeMessage(
  mint: string,
  wallet: string,
  issuedAt: number,
): string {
  return `LaunchSeeds close sniper protection
Coin: ${mint}
By: ${wallet}
Issued: ${new Date(issuedAt).toISOString()}`;
}

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
