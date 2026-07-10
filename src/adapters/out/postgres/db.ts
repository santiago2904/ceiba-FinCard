import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

export interface DB {
  partners: { partner_id: string; partner_name: string };
  members: { member_id: string; member_name: string };
  transactions: {
    transaction_id: string;
    member_id: string;
    partner_id: string;
    points_earned: number;
    points_redeemed: number;
    transaction_date: string;
    partner_name: string;
    processed_at: string;
    batch_id: string;
  };
  transactions_flagged: {
    id?: number;
    transaction_id: string;
    member_id: string;
    partner_id: string;
    points_earned: number;
    points_redeemed: number;
    transaction_date: string;
    partner_name: string;
    flag_reason: string;
    batch_id: string;
    processed_at: string;
  };
}

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }) });
}
