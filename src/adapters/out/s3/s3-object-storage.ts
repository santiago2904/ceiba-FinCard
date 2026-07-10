import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { ObjectStoragePort } from '../../../application/ports/out/object-storage.port.js';

export interface S3Config { bucket: string; region: string; endpoint?: string }

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;
  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } } : {}),
    });
  }
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}
