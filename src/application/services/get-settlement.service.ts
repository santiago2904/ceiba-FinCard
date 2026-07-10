import { calculateSettlement } from '../../domain/services/settlement-calculator.js';
import { NotFoundError } from '../../domain/errors.js';
import type { TransactionRepositoryPort } from '../ports/out/transaction-repository.port.js';
import type { PartnerRepositoryPort } from '../ports/out/partner-repository.port.js';
import type { GetSettlementUseCase } from '../ports/in/get-settlement.usecase.js';
import type { Settlement } from '../../domain/model/settlement.js';

export class GetSettlementService implements GetSettlementUseCase {
  constructor(private readonly repo: TransactionRepositoryPort, private readonly partners: PartnerRepositoryPort) {}
  async execute({ partnerId, from, to }: { partnerId: string; from: string; to: string }): Promise<Settlement> {
    const partnerName = await this.partners.findName(partnerId);
    if (!partnerName) throw new NotFoundError(`partner ${partnerId} no existe`);
    const transactions = await this.repo.findForSettlement(partnerId, from, to);
    return calculateSettlement({ partnerId, partnerName, from, to, transactions });
  }
}
