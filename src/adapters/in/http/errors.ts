import type { FastifyInstance } from 'fastify';
import { ValidationError, NotFoundError } from '../../../domain/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.status(400).send({ error: 'VALIDATION_FAILED', field: err.field, message: err.message });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
    if ((err as any).statusCode === 400) return reply.status(422).send({ error: 'INVALID_PARAMS', message: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL_ERROR' });
  });
}
