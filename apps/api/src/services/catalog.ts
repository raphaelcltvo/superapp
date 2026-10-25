import { suggestBasePrice, uid, type Banner, type Category, type Coupon, type Item, type LoyaltyProgram, type MerchSettings, type OptionGroup, type Page, type Store, type Strategy, type Tenant } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";

export const DEFAULT_MERCH: MerchSettings = {
  categoryOrderByProfile: {}, mostOrdered: { enabled: true, auto: true, title: "Mais pedidos agora" }, heroRules: [], crossSell: [], hesitationHelpSeconds: 12, searchInHeader: true,
};
export const DEFAULT_LOYALTY: LoyaltyProgram = { active: false, kind: "cashback", earnPercent: 5, minOrder: 0, expiresInDays: 60, minRedeem: 5, maxRedeemPercent: 30 };

export async function getSetting<T>(ctx: Ctx, key: "merch" | "loyalty", fallback: T): Promise<T> {
  const d = await ctx.deps.db.get<{ id: string; value: T }>("settings", ctx.tenantId, key);
  return d ? { ...fallback, ...d.value } : fallback;
}
export async function putSetting<T>(ctx: Ctx, key: "merch" | "loyalty", value: T) {
  await ctx.deps.db.put("settings", ctx.tenantId, { id: key, value });
  return value;
}

export interface Snapshot {
  tenant: Pick<Tenant, "id" | "slug" | "name" | "branding" | "settings">;
  stores: Store[];
  categories: Category[];
  items: Item[];
  groups: OptionGroup[];
  banners: Banner[];
  pages: Pick<Page, "id" | "slug" | "title" | "active">[];
  strategies: Strategy[];
  coupons: Coupon[];
  merch: MerchSettings;
  loyalty: LoyaltyProgram;
}

/** Lê o rascunho completo (o que está sendo editado no painel). */
export async function draftSnapshot(ctx: Ctx): Promise<Snapshot> {
  const { db } = ctx.deps; const t = ctx.tenantId;
  const tenant = (await db.tenants.get(t)) as unknown as Tenant;
  if (!tenant) throw new HttpError(404, "Marca não encontrada");
  const [stores, categories, items, groups, banners, pages, strategies, coupons, merch, loyalty] = await Promise.all([
    db.list<Store & { id: string }>("stores", t), db.list<Category & { id: string }>("categories", t, { orderBy: { field: "position" } }), db.list<Item & { id: string }>("items", t, { orderBy: { field: "position" } }),
    db.list<OptionGroup & { id: string }>("option_groups", t), db.list<Banner & { id: string }>("banners", t), db.list<Page & { id: string }>("pages", t), db.list<Strategy & { id: string }>("strategies", t),
    db.list<Coupon & { id: string }>("coupons", t), getSetting(ctx, "merch", DEFAULT_MERCH), getSetting(ctx, "loyalty", DEFAULT_LOYALTY),
  ]);
  return { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, branding: tenant.branding, settings: tenant.settings }, stores, categories, items, groups, banners, pages: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, active: p.active })), strategies, coupons, merch, loyalty };
}

export interface CatalogIssue { level: "erro" | "aviso"; where: string; message: string; fix?: string; itemId?: string; groupId?: string }

/** Auditoria antes de publicar: preço base, grupos, fotos, códigos PDV, links de banner. */
export function auditCatalog(s: Snapshot, opts: { requirePdv?: boolean } = {}): CatalogIssue[] {
  const out: CatalogIssue[] = [];
  const G = Object.fromEntries(s.groups.map((g) => [g.id, g]));
  const C = Object.fromEntries(s.categories.map((c) => [c.id, c]));
  const I = Object.fromEntries(s.items.map((i) => [i.id, i]));
  for (const it of s.items) {
    const where = `Item · ${it.name}`;
    if (!C[it.categoryId]) out.push({ level: "erro", where, message: "Categoria inexistente", itemId: it.id });
    const groups = it.groupIds.map((g) => G[g]);
    if (groups.some((g) => !g)) out.push({ level: "erro", where, message: "Grupo de complemento removido ainda está vinculado", itemId: it.id });
    const valid = groups.filter(Boolean) as OptionGroup[];
    if (C[it.categoryId]?.pricingLocked && it.kind === "buildable") out.push({ level: "aviso", where, message: "Item montável em categoria de preço fechado: a regra de meio a meio não será aplicada", itemId: it.id, fix: "Mude o tipo para Combo ou Oferta" });
    if (it.kind === "buildable") {
      const sug = suggestBasePrice(it, valid);
      if (Math.abs(sug - it.price) > 0.009) out.push({ level: "erro", where, message: `Preço base R$ ${it.price.toFixed(2)} difere da combinação mais barata R$ ${sug.toFixed(2)}`, fix: "Usar a combinação mais barata", itemId: it.id });
    }
    if (!it.imageUrl && !it.heroOptionNames?.length && !it.isDrink) out.push({ level: "aviso", where, message: "Sem foto", itemId: it.id });
    if (opts.requirePdv && !it.integrationCode) out.push({ level: "erro", where, message: "Sem código PDV (SAIPOS)", itemId: it.id });
    for (const g of valid) {
      if (g.min > 0 && g.options.filter((o) => o.active).length < Math.min(g.min, 1)) out.push({ level: "erro", where, message: `Grupo obrigatório "${g.name}" sem opções ativas`, itemId: it.id, groupId: g.id });
      if (opts.requirePdv) for (const o of g.options) if (o.active && !o.integrationCode) out.push({ level: "erro", where: `${where} · ${g.name}`, message: `${o.name} sem código PDV`, itemId: it.id, groupId: g.id });
    }
  }
  for (const b of s.banners.filter((b) => b.active)) {
    const where = `Banner · ${b.name}`;
    if (b.link.kind === "item" && !I[b.link.itemId]) out.push({ level: "erro", where, message: "Aponta para item inexistente" });
    if (b.link.kind === "category" && !C[b.link.categoryId]) out.push({ level: "erro", where, message: "Aponta para categoria inexistente" });
    if (b.link.kind === "page" && !s.pages.find((p) => p.id === (b.link as { pageId: string }).pageId)) out.push({ level: "erro", where, message: "Aponta para página inexistente" });
    if (!b.media.alt) out.push({ level: "aviso", where, message: "Sem texto alternativo (acessibilidade)" });
  }
  for (const st of s.strategies.filter((x) => x.active && x.action.kind === "popup_coupon")) {
    const cid = (st.action as { couponId: string }).couponId;
    if (!s.coupons.find((c) => c.id === cid)) out.push({ level: "erro", where: `Estratégia · ${st.name}`, message: "Pop-up sem cupom vinculado" });
  }
  if (!s.stores.length) out.push({ level: "erro", where: "Lojas", message: "Cadastre ao menos uma loja" });
  for (const st of s.stores) {
    if (!st.zones.some((z) => z.active) && st.modes.delivery) out.push({ level: "erro", where: `Loja · ${st.name}`, message: "Entrega ligada sem área de entrega ativa" });
    if (!st.payments.some((p) => p.active)) out.push({ level: "erro", where: `Loja · ${st.name}`, message: "Nenhuma forma de pagamento ativa" });
    if (!st.hours.length) out.push({ level: "aviso", where: `Loja · ${st.name}`, message: "Sem horário de funcionamento" });
  }
  return out;
}

export interface MenuVersion { id: string; number: number; createdAt: string; createdBy: string; notes?: string; snapshot: Snapshot }

export async function publish(ctx: Ctx, by: string, notes?: string) {
  const snap = await draftSnapshot(ctx);
  const errors = auditCatalog(snap).filter((i) => i.level === "erro");
  if (errors.length) throw new HttpError(422, "Corrija os erros antes de publicar", errors);
  const n = (await ctx.deps.db.count("menu_versions", ctx.tenantId)) + 1;
  const v: MenuVersion = { id: uid("ver"), number: n, createdAt: ctx.deps.now().toISOString(), createdBy: by, notes, snapshot: snap };
  await ctx.deps.db.put("menu_versions", ctx.tenantId, v as never);
  const t = await ctx.deps.db.tenants.get(ctx.tenantId);
  await ctx.deps.db.tenants.put({ ...t!, publishedVersionId: v.id, publishedAt: v.createdAt });
  return { id: v.id, number: n, createdAt: v.createdAt };
}

const cache = new Map<string, { id: string; snap: Snapshot }>();
export async function publishedSnapshot(ctx: Ctx): Promise<Snapshot | null> {
  const t = await ctx.deps.db.tenants.get(ctx.tenantId);
  const vid = t?.publishedVersionId as string | undefined;
  if (!vid) return null;
  const hit = cache.get(ctx.tenantId);
  if (hit?.id === vid) return hit.snap;
  const v = await ctx.deps.db.get<MenuVersion & { id: string }>("menu_versions", ctx.tenantId, vid);
  if (!v) return null;
  cache.set(ctx.tenantId, { id: vid, snap: v.snapshot });
  return v.snapshot;
}
export function catalogOf(s: Snapshot) {
  return { items: Object.fromEntries(s.items.map((i) => [i.id, i])), groups: Object.fromEntries(s.groups.map((g) => [g.id, g])), categories: Object.fromEntries(s.categories.map((c) => [c.id, c])) };
}
