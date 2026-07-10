import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ENDPOINT_URL: z.string().optional(),
  S3_BUCKET: z.string(),
  GLUE_DATABASE: z.string().default('fincard_loyalty'),
  GLUE_TABLE: z.string().default('transactions'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(10 * 1024 * 1024),
  CATALOG_MODE: z.enum(['file', 'glue']).default('file'),
  CATALOG_FILE: z.string().default('./data/catalog/catalog.json'),
});

export interface AppConfig {
  port: number;
  databaseUrl: string;
  awsRegion: string;
  awsEndpoint?: string;
  s3Bucket: string;
  glueDatabase: string;
  glueTable: string;
  maxUploadBytes: number;
  catalogMode: 'file' | 'glue';
  catalogFile: string;
}

export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const p = schema.parse(env);
  return {
    port: p.PORT,
    databaseUrl: p.DATABASE_URL,
    awsRegion: p.AWS_REGION,
    awsEndpoint: p.AWS_ENDPOINT_URL,
    s3Bucket: p.S3_BUCKET,
    glueDatabase: p.GLUE_DATABASE,
    glueTable: p.GLUE_TABLE,
    maxUploadBytes: p.MAX_UPLOAD_BYTES,
    catalogMode: p.CATALOG_MODE,
    catalogFile: p.CATALOG_FILE,
  };
}

export const loadEnv = (): AppConfig => parseEnv(process.env);
