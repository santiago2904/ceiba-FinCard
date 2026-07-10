import type { Transaction } from './transaction.js';
export type FlagReason = 'RN-01' | 'RN-02' | 'RN-03' | 'RN-04';
export type FlaggedTransaction = Transaction & { flagReason: FlagReason };
