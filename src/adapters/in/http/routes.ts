import type { FastifyInstance } from 'fastify';
import { settlementQuery, partnerParam } from './settlement.schema.js';
import type { UploadTransactionsUseCase } from '../../../application/ports/in/upload-transactions.usecase.js';
import type { GetSettlementUseCase } from '../../../application/ports/in/get-settlement.usecase.js';

export function registerRoutes(app: FastifyInstance, deps: { upload: UploadTransactionsUseCase; settlement: GetSettlementUseCase }): void {
  app.post('/api/v1/transactions/upload', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.status(422).send({ error: 'INVALID_PARAMS', message: 'archivo requerido en campo "file"' });
    const buffer = await file.toBuffer();
    const result = await deps.upload.execute({ fileBuffer: buffer, filename: file.filename });
    if (result.validRows === 0 && result.errors.length > 0) {
      return reply.status(400).send({ error: 'VALIDATION_FAILED', totalRows: result.validRows + result.rejectedRows, invalidRows: result.rejectedRows, errors: result.errors });
    }
    return reply.status(201).send(result);
  });

  app.get('/api/v1/settlements/:partnerId', async (req, reply) => {
    const params = partnerParam.safeParse(req.params);
    if (!params.success) return reply.status(422).send({ error: 'INVALID_PARAMS', message: params.error.issues[0]?.message ?? 'parámetro inválido' });
    const query = settlementQuery.safeParse(req.query);
    if (!query.success) return reply.status(422).send({ error: 'INVALID_PARAMS', message: query.error.issues[0]?.message ?? 'parámetro inválido' });
    const result = await deps.settlement.execute({ partnerId: params.data.partnerId, from: query.data.from, to: query.data.to });
    return reply.status(200).send(result);
  });
}
