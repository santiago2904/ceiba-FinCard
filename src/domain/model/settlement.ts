export interface DailyBreakdown { date: string; transactions: number; points_earned: number; points_redeemed: number }
export interface Settlement {
  partner_id: string;
  partner_name: string;
  period: { from: string; to: string };
  summary: {
    total_transactions: number;
    total_points_earned: number;
    total_points_redeemed: number;
    net_points_owed: number;
    unique_members: number;
  };
  daily_breakdown: DailyBreakdown[];
}
