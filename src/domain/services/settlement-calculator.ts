import type { Transaction } from '../model/transaction.js';
import type { Settlement, DailyBreakdown } from '../model/settlement.js';

export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Callers must pre-filter `transactions` to the [from, to] range before calling this
// function (the Postgres repository does this); transactions outside the range would
// inflate summary totals without appearing in daily_breakdown.
export function calculateSettlement(input: {
  partnerId: string; partnerName: string; from: string; to: string; transactions: Transaction[];
}): Settlement {
  const { partnerId, partnerName, from, to, transactions } = input;
  const totalEarned = transactions.reduce((a, t) => a + t.pointsEarned, 0);
  const totalRedeemed = transactions.reduce((a, t) => a + t.pointsRedeemed, 0);
  const net = totalEarned - totalRedeemed;
  const members = new Set(transactions.map((t) => t.memberId));

  const byDate = new Map<string, DailyBreakdown>();
  for (const d of enumerateDates(from, to)) byDate.set(d, { date: d, transactions: 0, points_earned: 0, points_redeemed: 0 });
  for (const t of transactions) {
    const row = byDate.get(t.transactionDate);
    if (!row) continue;
    row.transactions += 1;
    row.points_earned += t.pointsEarned;
    row.points_redeemed += t.pointsRedeemed;
  }

  return {
    partner_id: partnerId,
    partner_name: partnerName,
    period: { from, to },
    summary: {
      total_transactions: transactions.length,
      total_points_earned: totalEarned,
      total_points_redeemed: totalRedeemed,
      net_points_owed: net < 0 ? 0 : net,
      unique_members: members.size,
    },
    daily_breakdown: [...byDate.values()],
  };
}
