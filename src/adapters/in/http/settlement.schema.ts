import { z } from 'zod';
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD');
export const settlementQuery = z.object({ from: DATE, to: DATE }).refine((q) => q.from <= q.to, { message: 'from debe ser <= to', path: ['from'] });
export const partnerParam = z.object({ partnerId: z.string().regex(/^PART\d{2}$/, 'partner_id inválido') });
