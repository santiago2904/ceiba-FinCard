import type { Transaction } from '../model/transaction.js';
import type { FlaggedTransaction, FlagReason } from '../model/flagged-transaction.js';

const DAILY_NET_LIMIT = 10000;
const MAX_TXNS_PER_MEMBER_PARTNER_DAY = 5;
const MAX_REDEEM_RATIO = 0.3;

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    (m.get(k) ?? m.set(k, []).get(k)!).push(it);
  }
  return m;
}

export function applyBusinessRules(txns: Transaction[], now: Date): { clean: Transaction[]; flagged: FlaggedTransaction[] } {
  const reason = new Map<string, FlagReason>(); // transactionId -> first reason

  const setIfAbsent = (id: string, r: FlagReason) => { if (!reason.has(id)) reason.set(id, r); };
  const twoYearsAgo = new Date(now); twoYearsAgo.setUTCFullYear(now.getUTCFullYear() - 2);

  // RN-04
  for (const t of txns) {
    const d = new Date(`${t.transactionDate}T00:00:00.000Z`);
    if (d.getTime() > now.getTime() || d.getTime() < twoYearsAgo.getTime()) setIfAbsent(t.transactionId, 'RN-04');
  }

  // RN-02: per (partner, day)
  for (const group of groupBy(txns, (t) => `${t.partnerId}|${t.transactionDate}`).values()) {
    const redeemers = group.filter((t) => t.pointsRedeemed > 0).sort((a, b) => a.transactionId.localeCompare(b.transactionId));
    const allowed = Math.floor(group.length * MAX_REDEEM_RATIO);
    redeemers.slice(allowed).forEach((t) => setIfAbsent(t.transactionId, 'RN-02'));
  }

  // RN-01: per (member, day), cumulative net. Once cumulative net first exceeds the limit,
  // the breaching txn AND every subsequent txn in the group are flagged, unconditionally
  // (even if a later redemption brings the net back down).
  for (const group of groupBy(txns, (t) => `${t.memberId}|${t.transactionDate}`).values()) {
    let net = 0;
    let breached = false;
    for (const t of [...group].sort((a, b) => a.transactionId.localeCompare(b.transactionId))) {
      net += t.pointsEarned - t.pointsRedeemed;
      if (net > DAILY_NET_LIMIT) breached = true;
      if (breached) setIfAbsent(t.transactionId, 'RN-01');
    }
  }

  // RN-03: per (member, partner, day), 6th+
  for (const group of groupBy(txns, (t) => `${t.memberId}|${t.partnerId}|${t.transactionDate}`).values()) {
    [...group].sort((a, b) => a.transactionId.localeCompare(b.transactionId))
      .slice(MAX_TXNS_PER_MEMBER_PARTNER_DAY)
      .forEach((t) => setIfAbsent(t.transactionId, 'RN-03'));
  }

  const clean: Transaction[] = [];
  const flagged: FlaggedTransaction[] = [];
  for (const t of txns) {
    const r = reason.get(t.transactionId);
    if (r) flagged.push({ ...t, flagReason: r });
    else clean.push(t);
  }
  return { clean, flagged };
}
