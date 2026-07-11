import {
  GlueClient, CreateDatabaseCommand, CreateTableCommand, UpdateTableCommand, GetTableCommand,
} from '@aws-sdk/client-glue';
import type { DataCatalogPort, GlueColumn } from '../../../application/ports/out/data-catalog.port.js';

export interface GlueConfig { region: string; endpoint?: string }

export class GlueCatalog implements DataCatalogPort {
  private readonly client: GlueClient;
  constructor(config: GlueConfig) {
    this.client = new GlueClient({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } } : {}),
    });
  }
  async ensureDatabase(name: string): Promise<void> {
    try { await this.client.send(new CreateDatabaseCommand({ DatabaseInput: { Name: name } })); }
    catch (e: unknown) { if ((e as { name?: string }).name !== 'AlreadyExistsException') throw e; }
  }
  async upsertTable(db: string, table: string, columns: GlueColumn[]): Promise<void> {
    const TableInput = { Name: table, StorageDescriptor: { Columns: columns.map((c) => ({ Name: c.name, Type: c.type })) } };
    const exists = await this.client.send(new GetTableCommand({ DatabaseName: db, Name: table })).then(() => true).catch(() => false);
    if (exists) await this.client.send(new UpdateTableCommand({ DatabaseName: db, TableInput }));
    else await this.client.send(new CreateTableCommand({ DatabaseName: db, TableInput }));
  }
}
