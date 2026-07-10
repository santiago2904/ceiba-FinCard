import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import type { PartnerRepositoryPort } from '../../../application/ports/out/partner-repository.port.js';

export class PostgresPartnerRepository implements PartnerRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async findName(partnerId: string): Promise<string | null> {
    const row = await this.db.selectFrom('partners').select('partner_name').where('partner_id', '=', partnerId).executeTakeFirst();
    return row?.partner_name ?? null;
  }
}
