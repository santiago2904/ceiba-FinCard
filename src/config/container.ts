import type { AppConfig } from './env.js';
import { createDb } from '../adapters/out/postgres/db.js';
import { PostgresTransactionRepository } from '../adapters/out/postgres/transaction.repository.js';
import { PostgresPartnerRepository } from '../adapters/out/postgres/partner.repository.js';
import { S3ObjectStorage } from '../adapters/out/s3/s3-object-storage.js';
import { GlueCatalog } from '../adapters/out/glue/glue-catalog.js';
import { FileDataCatalog } from '../adapters/out/catalog/file-data-catalog.js';
import type { DataCatalogPort } from '../application/ports/out/data-catalog.port.js';
import { UploadTransactionsService } from '../application/services/upload-transactions.service.js';
import { GetSettlementService } from '../application/services/get-settlement.service.js';
import { buildApp } from '../adapters/in/http/app.js';

export function buildContainer(config: AppConfig) {
  const db = createDb(config.databaseUrl);
  const repo = new PostgresTransactionRepository(db);
  const partners = new PostgresPartnerRepository(db);
  const storage = new S3ObjectStorage({ bucket: config.s3Bucket, region: config.awsRegion, endpoint: config.awsEndpoint });
  // RF-03: Glue is a LocalStack Pro feature, so local dev/test defaults to a file-based
  // catalog emulator; production (or a real AWS/LocalStack-Pro target) selects Glue via
  // CATALOG_MODE=glue.
  const catalog: DataCatalogPort = config.catalogMode === 'glue'
    ? new GlueCatalog({ region: config.awsRegion, endpoint: config.awsEndpoint })
    : new FileDataCatalog(config.catalogFile);
  const upload = new UploadTransactionsService(storage, catalog, repo);
  const settlement = new GetSettlementService(repo, partners);
  const app = buildApp({ upload, settlement, maxUploadBytes: config.maxUploadBytes });
  return { app, db };
}
