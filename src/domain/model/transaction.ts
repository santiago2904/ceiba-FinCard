export interface RawTransactionRow {
  transaction_id: string;
  member_id: string;
  partner_id: string;
  points_earned: string;
  points_redeemed: string;
  transaction_date: string;
  partner_name: string;
}
export interface Transaction {
  transactionId: string;
  memberId: string;
  partnerId: string;
  pointsEarned: number;
  pointsRedeemed: number;
  transactionDate: string;
  partnerName: string;
}
export function toTransaction(row: RawTransactionRow): Transaction {
  return {
    transactionId: row.transaction_id,
    memberId: row.member_id,
    partnerId: row.partner_id,
    pointsEarned: Number(row.points_earned),
    pointsRedeemed: Number(row.points_redeemed),
    transactionDate: row.transaction_date,
    partnerName: row.partner_name,
  };
}
