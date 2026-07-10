import { describe, it, expect } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('parses valid env', () => {
    const cfg = parseEnv({ PORT: '3000', DATABASE_URL: 'postgres://x', AWS_REGION: 'us-east-1', S3_BUCKET: 'b', GLUE_DATABASE: 'd', GLUE_TABLE: 't' });
    expect(cfg.port).toBe(3000);
    expect(cfg.s3Bucket).toBe('b');
  });
  it('throws on missing DATABASE_URL', () => {
    expect(() => parseEnv({ PORT: '3000' } as any)).toThrow();
  });
});
