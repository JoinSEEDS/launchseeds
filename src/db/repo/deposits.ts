import { schemas, type NewRows } from "../schema";
import { record, records, rows, change, type SqlDb } from "./util";
export function depositRepo(db: SqlDb) {
  return {
    record(input: NewRows["deposits"]): boolean {
      const existing = record(db, "deposits", "signature = ?", input.signature);
      if (existing) {
        if (
          existing.tokenId !== input.tokenId ||
          existing.lamports !== input.lamports
        )
          throw new Error("Deposit already assigned or inconsistent");
        return false;
      }
      return this.insertIfNew(input);
    },
    insertIfNew(input: NewRows["deposits"]): boolean {
      const d = schemas.deposits.parse(input);
      return (
        rows(
          db,
          `INSERT INTO deposits
        (tokenId,signature,lamports,confirmedSlot,confirmedAt,refundSignature)
        VALUES (?,?,?,?,?,?) ON CONFLICT(signature) DO NOTHING RETURNING id`,
          d.tokenId,
          d.signature,
          d.lamports,
          d.confirmedSlot,
          d.confirmedAt,
          d.refundSignature,
        ).length > 0
      );
    },
    listByToken(tokenId: number) {
      return records(
        db,
        "deposits",
        "tokenId = ? ORDER BY confirmedAt DESC",
        tokenId,
      );
    },
    sumLamports(tokenId: number) {
      return records(db, "deposits", "tokenId = ?", tokenId).reduce(
        (sum, x) => sum + BigInt(x.lamports),
        0n,
      );
    },
    setRefund(signature: string, refundSignature: string) {
      return change(
        db,
        "UPDATE deposits SET refundSignature = ? WHERE signature = ? AND refundSignature IS NULL",
        refundSignature,
        signature,
      );
    },
  };
}
