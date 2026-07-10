import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { S3Client, GetObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { S3ObjectStorage } from './s3-object-storage.js';

let ls: StartedTestContainer;
let endpoint: string;
beforeAll(async () => {
  ls = await new GenericContainer('localstack/localstack:3').withEnvironment({ SERVICES: 's3' }).withExposedPorts(4566).start();
  endpoint = `http://${ls.getHost()}:${ls.getMappedPort(4566)}`;
  const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  await client.send(new CreateBucketCommand({ Bucket: 'fincard-transactions' }));
}, 120_000);
afterAll(async () => { await ls.stop(); });

describe('S3ObjectStorage', () => {
  it('puts an object retrievable at the expected key', async () => {
    const storage = new S3ObjectStorage({ bucket: 'fincard-transactions', region: 'us-east-1', endpoint });
    await storage.putObject('2026/07/PART01/b1.ndjson', Buffer.from('hello'), 'text/plain');
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    const res = await client.send(new GetObjectCommand({ Bucket: 'fincard-transactions', Key: '2026/07/PART01/b1.ndjson' }));
    expect(await res.Body!.transformToString()).toBe('hello');
  });
});
