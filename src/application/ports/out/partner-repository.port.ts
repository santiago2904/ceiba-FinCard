export interface PartnerRepositoryPort {
  findName(partnerId: string): Promise<string | null>;
}
