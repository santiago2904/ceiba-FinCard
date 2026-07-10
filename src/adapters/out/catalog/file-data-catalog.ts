import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DataCatalogPort, GlueColumn } from '../../../application/ports/out/data-catalog.port.js';

interface CatalogTable { columns: GlueColumn[] }
interface CatalogDatabase { tables: Record<string, CatalogTable> }
interface CatalogFile { databases: Record<string, CatalogDatabase> }

/**
 * Local, file-based emulation of a Glue-like Data Catalog for development/testing.
 * Community LocalStack does not support Glue (it's a LocalStack Pro feature), so this
 * adapter persists the same shape of information (databases -> tables -> columns) as a
 * JSON file on disk, giving RF-03 a working local path without requiring LocalStack Pro
 * or real AWS credentials. Not intended for concurrent/production use.
 */
export class FileDataCatalog implements DataCatalogPort {
  constructor(private readonly filePath: string) {}

  async ensureDatabase(name: string): Promise<void> {
    const data = await this.read();
    if (!data.databases[name]) {
      data.databases[name] = { tables: {} };
      await this.write(data);
    }
  }

  async upsertTable(db: string, table: string, columns: GlueColumn[]): Promise<void> {
    const data = await this.read();
    if (!data.databases[db]) {
      data.databases[db] = { tables: {} };
    }
    data.databases[db].tables[table] = { columns };
    await this.write(data);
  }

  private async read(): Promise<CatalogFile> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as CatalogFile;
      return parsed?.databases ? parsed : { databases: {} };
    } catch {
      return { databases: {} };
    }
  }

  private async write(data: CatalogFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
