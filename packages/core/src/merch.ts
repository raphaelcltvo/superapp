import type { Audience, Banner, BannerSlot, Customer, ProfileKey, Weekday } from "./types";
import { daysSince } from "./crm";

export interface VisitorContext {
  now: Date;
  source?: string; // utm_source ou referrer
  customer?: Pick<Customer, "orders" | "lastOrderAt" | "spent">;
  segmentIds: string[];
  partySize?: number;
}

/** Perfil usado para ordenar categorias e escolher o card do topo. */
export function detectProfile(v: VisitorContext): ProfileKey {
  const orders = v.customer?.orders ?? 0;
  const d = daysSince(v.customer?.lastOrderAt, v.now);
  if (orders >= 2 && d !== undefined && d > 45) return "em_risco";
  if (orders >= 2) return "recorrente";
  const weekend = [0, 6].includes(v.now.getDay());
  if (orders === 0 && weekend && v.now.getHours() < 20 && v.source === "google") return "familia";
  return "novo";
}

export function audienceMatches(a: Audience, v: VisitorContext, profile: ProfileKey) {
  if (a.newOnly && (v.customer?.orders ?? 0) > 0) return false;
  if (a.profiles?.length && !a.profiles.includes(profile) && !a.profiles.includes("qualquer")) return false;
  if (a.segmentIds?.length && !a.segmentIds.some((s) => v.segmentIds.includes(s))) return false;
  if (a.sources?.length && (!v.source || !a.sources.includes(v.source))) return false;
  if (a.weekdays?.length && !a.weekdays.includes(v.now.getDay() as Weekday)) return false;
  if (a.hours && !(v.now.getHours() >= a.hours[0] && v.now.getHours() < a.hours[1])) return false;
  return true;
}

/** Escolhe o banner de um slot: filtra por público e período, ordena por prioridade e sorteia por peso entre empatados (teste A/B). */
export function pickBanner(banners: Banner[], slot: BannerSlot, v: VisitorContext, profile: ProfileKey, rnd = Math.random): Banner | undefined {
  const live = banners.filter((b) => b.active && b.slot === slot && (!b.startsAt || v.now >= new Date(b.startsAt)) && (!b.endsAt || v.now <= new Date(b.endsAt)) && audienceMatches(b.audience, v, profile));
  if (!live.length) return undefined;
  const top = Math.min(...live.map((b) => b.priority));
  const tier = live.filter((b) => b.priority === top);
  const total = tier.reduce((a, b) => a + (b.weight ?? 1), 0);
  let x = rnd() * total;
  for (const b of tier) { x -= b.weight ?? 1; if (x <= 0) return b; }
  return tier[tier.length - 1];
}

/** Popularidade com prior bayesiano: evita que um item com 3 pedidos e 100% pareça melhor que um com 300. */
export function bayesScore(successes: number, trials: number, priorMean = 0.1, priorStrength = 20) {
  return (successes + priorMean * priorStrength) / (trials + priorStrength);
}
