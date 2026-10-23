import { schemas, type Deposit } from "../schema";
import { records, rows, change, type SqlDb } from "./util";
export function depositRepo(db: SqlDb) {
  return {
    insertIfNew(input: Deposit): boolean {
      const d = schemas.deposits.parse(input);
      return (
        rows(
          db,
          `INSERT INTO deposits
        (uid,tokenId,signature,lamports,confirmedSlot,confirmedAt,refundSignature)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(signature) DO NOTHING RETURNING uid`,
          d.uid,
          d.tokenId,
          d.signature,
          d.lamports,
          d.confirmedSlot,
          d.confirmedAt,
          d.refundSignature,
        ).length > 0
      );
    },
    listByToken(tokenId: string) {
      return records(
        db,
        "deposits",
        "tokenId = ? ORDER BY confirmedAt DESC",
        tokenId,
      );
    },
    sumLamports(tokenId: string) {
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
