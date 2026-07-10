import type { ProcessingManifest } from '../../../domain/model/manifest.js';
export interface UploadResult extends ProcessingManifest { s3Prefixes: string[] }
export interface UploadTransactionsUseCase {
  execute(input: { fileBuffer: Buffer; filename: string }): Promise<UploadResult>;
}
