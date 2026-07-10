export interface GlueColumn { name: string; type: string }
export interface DataCatalogPort {
  ensureDatabase(name: string): Promise<void>;
  upsertTable(db: string, table: string, columns: GlueColumn[]): Promise<void>;
}
