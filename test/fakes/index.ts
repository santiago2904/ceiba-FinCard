import type { ObjectStoragePort } from '../../src/application/ports/out/object-storage.port.js';
import type { DataCatalogPort } from '../../src/application/ports/out/data-catalog.port.js';
import type { TransactionRepositoryPort, SaveMeta } from '../../src/application/ports/out/transaction-repository.port.js';
import type { Transaction } from '../../src/domain/model/transaction.js';
import type { FlaggedTransaction } from '../../src/domain/model/flagged-transaction.js';

export class FakeStorage implements ObjectStoragePort {
  puts: { key: string; body: Buffer }[] = [];
  async putObject(key: string, body: Buffer) { this.puts.push({ key, body }); }
}
export class FakeCatalog implements DataCatalogPort {
  dbs: string[] = []; tables: string[] = [];
  async ensureDatabase(n: string) { this.dbs.push(n); }
  async upsertTable(db: string, t: string) { this.tables.push(`${db}.${t}`); }
}
export class FakeRepo implements TransactionRepositoryPort {
  saved: Transaction[] = []; flagged: FlaggedTransaction[] = [];
  async saveMany(txns: Transaction[], _m: SaveMeta) { this.saved.push(...txns); }
  async saveFlagged(f: FlaggedTransaction[], _m: SaveMeta) { this.flagged.push(...f); }
  async findForSettlement(partnerId: string, from: string, to: string) {
    return this.saved.filter((t) => t.partnerId === partnerId && t.transactionDate >= from && t.transactionDate <= to);
  }
}
