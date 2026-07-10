import type { AppConfig } from './env.js';
import { createDb } from '../adapters/out/postgres/db.js';
import { PostgresTransactionRepository } from '../adapters/out/postgres/transaction.repository.js';
import { PostgresPartnerRepository } from '../adapters/out/postgres/partner.repository.js';
import { S3ObjectStorage } from '../adapters/out/s3/s3-object-storage.js';
import { GlueCatalog } from '../adapters/out/glue/glue-catalog.js';
import { UploadTransactionsService } from '../application/services/upload-transactions.service.js';
import { GetSettlementService } from '../application/services/get-settlement.service.js';
import { buildApp } from '../adapters/in/http/app.js';

export function buildContainer(config: AppConfig) {
  const db = createDb(config.databaseUrl);
  const repo = new PostgresTransactionRepository(db);
  const partners = new PostgresPartnerRepository(db);
  const storage = new S3ObjectStorage({ bucket: config.s3Bucket, region: config.awsRegion, endpoint: config.awsEndpoint });
  const catalog = new GlueCatalog({ region: config.awsRegion, endpoint: config.awsEndpoint });
  const upload = new UploadTransactionsService(storage, catalog, repo);
  const settlement = new GetSettlementService(repo, partners);
  const app = buildApp({ upload, settlement, maxUploadBytes: config.maxUploadBytes });
  return { app, db };
}
