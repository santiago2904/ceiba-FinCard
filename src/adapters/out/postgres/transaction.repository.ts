import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import type { Transaction } from '../../../domain/model/transaction.js';
import type { FlaggedTransaction } from '../../../domain/model/flagged-transaction.js';
import type { TransactionRepositoryPort, SaveMeta } from '../../../application/ports/out/transaction-repository.port.js';

export class PostgresTransactionRepository implements TransactionRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async saveMany(txns: Transaction[], meta: SaveMeta): Promise<void> {
    if (txns.length === 0) return;
    await this.db
      .insertInto('transactions')
      .values(
        txns.map((t) => ({
          transaction_id: t.transactionId,
          member_id: t.memberId,
          partner_id: t.partnerId,
          points_earned: t.pointsEarned,
          points_redeemed: t.pointsRedeemed,
          transaction_date: t.transactionDate,
          partner_name: t.partnerName,
          processed_at: meta.processedAt,
          batch_id: meta.batchId,
        })),
      )
      .onConflict((oc) => oc.column('transaction_id').doNothing())
      .execute();
  }
  async saveFlagged(flagged: FlaggedTransaction[], meta: SaveMeta): Promise<void> {
    if (flagged.length === 0) return;
    await this.db
      .insertInto('transactions_flagged')
      .values(
        flagged.map((t) => ({
          transaction_id: t.transactionId,
          member_id: t.memberId,
          partner_id: t.partnerId,
          points_earned: t.pointsEarned,
          points_redeemed: t.pointsRedeemed,
          transaction_date: t.transactionDate,
          partner_name: t.partnerName,
          flag_reason: t.flagReason,
          batch_id: meta.batchId,
          processed_at: meta.processedAt,
        })),
      )
      .execute();
  }
  async findForSettlement(partnerId: string, from: string, to: string): Promise<Transaction[]> {
    const rows = await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('partner_id', '=', partnerId)
      .where('transaction_date', '>=', from)
      .where('transaction_date', '<=', to)
      .execute();
    return rows.map((r) => ({
      transactionId: r.transaction_id,
      memberId: r.member_id,
      partnerId: r.partner_id,
      pointsEarned: r.points_earned,
      pointsRedeemed: r.points_redeemed,
      transactionDate: String(r.transaction_date).slice(0, 10),
      partnerName: r.partner_name,
    }));
  }
}
