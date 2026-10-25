import { mergeEngagement, type Category, type Coupon, type EngagementSettings, type Item } from "@cw/core";
import type { Db } from "../db/types";

/**
 * Primeira visita e topo por campanha da marca de exemplo.
 * Busca itens, categorias e cupom pelo nome/código (o cardápio pode ser reimportado com ids novos).
 */
export async function seedFirstVisit(db: Db, T: string) {
  const [items, cats, coupons] = await Promise.all([db.list<Item & { id: string }>("items", T), db.list<Category & { id: string }>("categories", T), db.list<Coupon & { id: string }>("coupons", T)]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const welcome = coupons.find((c) => /BEMVINDO/i.test(c.code || "")) || coupons.find((c) => c.firstOrderOnly && c.active);
  const combos = cats.find((c) => /combo/.test(norm(c.name)));
  const promo99 = items.find((i) => i.active && /r\$ ?99\b/.test(norm(i.name))) || items.find((i) => i.active && combos && i.categoryId === combos.id);
  const cur = await db.get<{ id: string; value: Partial<EngagementSettings> }>("settings", T, "engagement");
  const s = mergeEngagement(cur?.value);
  s.firstVisit = { ...s.firstVisit, enabled: true, mode: "reward", couponId: welcome?.id, source: "auto", segment: "pizza", maxQuestions: 3, afterCampaignSeconds: 0 };
  s.campaigns = [
    ...(promo99 ? [{ id: "cp_ig_99", active: true, source: "instagram", campaign: "pizza99", target: { kind: "item" as const, itemId: promo99.id }, kicker: "Você veio pelo anúncio", sub: "O mesmo do vídeo · até dois sabores" }] : []),
    ...(combos ? [{ id: "cp_ig_combos", active: true, source: "instagram", target: { kind: "category" as const, categoryId: combos.id }, kicker: "Ofertas do Instagram", sub: "Preço fechado, frete grátis acima de R$ 120" }] : []),
  ];
  await db.put("settings", T, { id: "engagement", value: s });
}
