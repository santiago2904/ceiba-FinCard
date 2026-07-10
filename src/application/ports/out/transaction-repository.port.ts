import type { Transaction } from '../../../domain/model/transaction.js';
import type { FlaggedTransaction } from '../../../domain/model/flagged-transaction.js';
export interface SaveMeta { batchId: string; processedAt: string }
export interface TransactionRepositoryPort {
  saveMany(txns: Transaction[], meta: SaveMeta): Promise<void>;
  saveFlagged(flagged: FlaggedTransaction[], meta: SaveMeta): Promise<void>;
  findForSettlement(partnerId: string, from: string, to: string): Promise<Transaction[]>;
}
