import { r2 } from "./pricing";
import type { LedgerEntry, LoyaltyProgram } from "./types";

/** Saldo disponível: créditos não vencidos menos resgates/expirações (FIFO). */
export function walletBalance(entries: LedgerEntry[], now = new Date()) {
  const credits = entries.filter((e) => e.amount > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((e) => ({ ...e, left: e.amount }));
  let debits = -entries.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0);
  for (const c of credits) { const use = Math.min(c.left, debits); c.left -= use; debits -= use; }
  const live = credits.filter((c) => c.left > 0 && (!c.expiresAt || new Date(c.expiresAt) > now));
  const expiring = live.filter((c) => c.expiresAt && (new Date(c.expiresAt).getTime() - now.getTime()) < 7 * 864e5);
  const expired = credits.filter((c) => c.left > 0 && c.expiresAt && new Date(c.expiresAt) <= now);
  return {
    balance: r2(live.reduce((a, c) => a + c.left, 0)),
    expiringSoon: r2(expiring.reduce((a, c) => a + c.left, 0)),
    toExpire: expired.map((c) => ({ id: c.id, amount: r2(c.left) })),
  };
}

export function tierFor(p: LoyaltyProgram, spend90d: number) {
  const tiers = [...(p.tiers || [])].sort((a, b) => b.minSpend90d - a.minSpend90d);
  return tiers.find((t) => spend90d >= t.minSpend90d);
}

/** Cashback gerado por um pedido (sobre o subtotal elegível, depois do desconto). */
export function cashbackEarn(p: LoyaltyProgram, eligibleSubtotal: number, spend90d: number) {
  if (!p.active || eligibleSubtotal < p.minOrder) return 0;
  const pct = tierFor(p, spend90d)?.earnPercent ?? p.earnPercent;
  let v = (eligibleSubtotal * pct) / 100;
  if (p.maxEarnPerOrder) v = Math.min(v, p.maxEarnPerOrder);
  return r2(v);
}

/** Quanto do saldo pode ser usado neste pedido. */
export function cashbackRedeemable(p: LoyaltyProgram, balance: number, subtotalAfterDiscount: number) {
  if (!p.active || balance < p.minRedeem) return 0;
  return r2(Math.min(balance, (subtotalAfterDiscount * p.maxRedeemPercent) / 100));
}
