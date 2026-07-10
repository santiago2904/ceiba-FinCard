import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { parseCsv } from './csv-parser.js';
import { validateRows } from '../../domain/services/field-validator.js';
import { applyBusinessRules } from '../../domain/services/business-rules.js';
import type { Transaction } from '../../domain/model/transaction.js';
import type { ObjectStoragePort } from '../ports/out/object-storage.port.js';
import type { DataCatalogPort } from '../ports/out/data-catalog.port.js';
import type { TransactionRepositoryPort } from '../ports/out/transaction-repository.port.js';
import type { UploadTransactionsUseCase, UploadResult } from '../ports/in/upload-transactions.usecase.js';

const GLUE_COLUMNS = [
  { name: 'transaction_id', type: 'string' }, { name: 'member_id', type: 'string' },
  { name: 'partner_id', type: 'string' }, { name: 'points_earned', type: 'int' },
  { name: 'points_redeemed', type: 'int' }, { name: 'transaction_date', type: 'date' },
  { name: 'partner_name', type: 'string' }, { name: 'processed_at', type: 'timestamp' },
  { name: 'batch_id', type: 'string' },
];

export class UploadTransactionsService implements UploadTransactionsUseCase {
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly catalog: DataCatalogPort,
    private readonly repo: TransactionRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute({ fileBuffer }: { fileBuffer: Buffer; filename: string }): Promise<UploadResult> {
    const now = this.clock();
    const processedAt = now.toISOString();
    const batchId = randomUUID();
    const sourceSha256 = createHash('sha256').update(fileBuffer).digest('hex');

    const rows = parseCsv(fileBuffer);
    const { valid, errors } = validateRows(rows);
    const { clean, flagged } = applyBusinessRules(valid, now);

    const s3Prefixes: string[] = [];
    const groups = new Map<string, Transaction[]>();
    for (const t of clean) {
      const [y, m] = t.transactionDate.split('-');
      const prefix = `${y}/${m}/${t.partnerId}`;
      (groups.get(prefix) ?? groups.set(prefix, []).get(prefix)!).push(t);
    }
    for (const [prefix, txns] of groups) {
      const body = Buffer.from(txns.map((t) => JSON.stringify({ ...t, processed_at: processedAt, batch_id: batchId })).join('\n'));
      await this.storage.putObject(`${prefix}/${batchId}.ndjson`, body, 'application/x-ndjson');
      s3Prefixes.push(prefix);
    }

    const manifest = {
      batchId, validRows: clean.length, rejectedRows: new Set(errors.map((e) => e.row)).size,
      flaggedRows: flagged.length, errors, processedAt, sourceSha256,
    };
    await this.storage.putObject(`manifests/${batchId}.manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');

    await this.catalog.ensureDatabase('fincard_loyalty');
    await this.catalog.upsertTable('fincard_loyalty', 'transactions', GLUE_COLUMNS);

    await this.repo.saveMany(clean, { batchId, processedAt });
    await this.repo.saveFlagged(flagged, { batchId, processedAt });

    return { ...manifest, s3Prefixes };
  }
}
