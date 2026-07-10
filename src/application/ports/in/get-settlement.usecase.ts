import type { Settlement } from '../../../domain/model/settlement.js';
export interface GetSettlementUseCase {
  execute(input: { partnerId: string; from: string; to: string }): Promise<Settlement>;
}
