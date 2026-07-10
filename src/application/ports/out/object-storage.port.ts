export interface ObjectStoragePort {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
}
