import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerRoutes } from './routes.js';
import { registerErrorHandler } from './errors.js';
import type { UploadTransactionsUseCase } from '../../../application/ports/in/upload-transactions.usecase.js';
import type { GetSettlementUseCase } from '../../../application/ports/in/get-settlement.usecase.js';

export function buildApp(deps: { upload: UploadTransactionsUseCase; settlement: GetSettlementUseCase; maxUploadBytes?: number }): FastifyInstance {
  const app = Fastify({ logger: true });
  app.register(helmet);
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.register(multipart, { limits: { fileSize: deps.maxUploadBytes ?? 10 * 1024 * 1024, files: 1 } });
  registerErrorHandler(app);
  app.register(async (instance) => registerRoutes(instance, deps));
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
