export interface RowError { row: number; field: string; value: unknown; message: string }
export interface ProcessingManifest {
  batchId: string;
  validRows: number;
  rejectedRows: number;
  flaggedRows: number;
  errors: RowError[];
  processedAt: string;
  sourceSha256: string;
}
