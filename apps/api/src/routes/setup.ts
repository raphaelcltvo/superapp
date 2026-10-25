import { Hono } from "hono";
import { z } from "zod";
import { CUISINES, SETUP_STEPS, applyTemplate, brandPalette, cuisineById, paymentsFromSetup, slugify, uid, type CuisineId, type PaymentCode, type SetupStepId, type Store, type Tenant } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError, type Ctx } from "../services/ctx";
import { auditCatalog, draftSnapshot } from "../services/catalog";

const CUISINE_IDS = CUISINES.map((c) => c.id) as [CuisineId, ...CuisineId[]];
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

type SetupState = { id: "setup"; value: { menuSource?: "ifood" | "modelo" | "zero"; ordersMode?: "manager" | "pdv"; seen?: SetupStepId[]; skipped?: SetupStepId[] } };
async function state(ctx: Ctx) { return (await ctx.deps.db.get<SetupState>("settings", ctx.tenantId, "setup"))?.value || {}; }
async function patchState(ctx: Ctx, v: Partial<SetupState["value"]>) { const cur = await state(ctx); await ctx.deps.db.put("settings", ctx.tenantId, { id: "setup", value: { ...cur, ...v } }); }

/** Situação de cada passo, calculada pelos dados (não por cliques): o Setup reflete o que está de fato pronto. */
export async function setupStatus(ctx: Ctx) {
  const { db } = ctx.deps; const t = ctx.tenantId;
  const tenant = (await db.tenants.get(t)) as unknown as Tenant & { publishedVersionId?: string };
  const snap = await draftSnapshot(ctx);
  const st = await state(ctx);
  const store = snap.stores[0];
  const integ = await db.list<{ id: string; config: { enabled?: boolean; provider?: string; connected?: boolean } }>("integrations", t);
  const wa = integ.find((i) => i.id === "whatsapp")?.config;
  const saipos = integ.some((i) => i.id.startsWith("saipos:") && i.config.enabled);
  const ordersCfg = await db.get<{ id: string }>("settings", t, "orders");
  const customers = await db.count("customers", t);
  const issues = auditCatalog(snap);
  const itemErrors = issues.filter((i) => i.level === "erro" && i.where.startsWith("Item")).length;
  const done: Record<SetupStepId, { done: boolean; detail: string }> = {
    marca: { done: !!tenant.name && !!tenant.branding?.logoUrl && !!tenant.settings?.whatsapp, detail: [tenant.branding?.logoUrl ? "" : "falta o logo", tenant.settings?.whatsapp ? "" : "falta o WhatsApp de atendimento"].filter(Boolean).join(" · ") || `cardápio em /${tenant.slug}` },
    culinaria: { done: !!tenant.settings?.cuisine, detail: tenant.settings?.cuisine ? cuisineById(tenant.settings.cuisine).label : "escolha a culinária principal" },
    loja: { done: !!store && !!store.address.street && !!store.address.number && store.hours.length > 0 && (store.modes.takeout || store.zones.some((z) => z.active)), detail: store ? `${store.hours.length} dias com horário · ${store.zones.filter((z) => z.active).length} área(s) de entrega` : "cadastre a loja" },
    cardapio: { done: snap.items.length > 0 && itemErrors === 0, detail: `${snap.categories.length} categorias · ${snap.items.length} itens · ${snap.groups.length} grupos${itemErrors ? ` · ${itemErrors} erro(s)` : ""}` },
    pagamento: { done: !!store?.payments.some((p) => p.active), detail: store ? store.payments.filter((p) => p.active).map((p) => p.label).join(", ") || "nenhuma forma ativa" : "cadastre a loja antes" },
    pedidos: { done: !!ordersCfg || saipos || !!st.ordersMode, detail: saipos ? "PDV SAIPOS ligado" : st.ordersMode === "pdv" ? "PDV escolhido (falta conectar)" : "gestor de pedidos do SuperApp" },
    whatsapp: { done: !!wa?.enabled && (wa.provider === "meta" || wa.connected !== false), detail: wa?.enabled ? `${wa.provider === "meta" ? "API oficial" : wa.provider === "fake" ? "teste" : "QR code"}${wa.connected === false ? " · desconectado" : " · conectado"}` : "não conectado" },
    base: { done: customers > 0, detail: customers ? `${customers} clientes na base` : "opcional: suba a base para achar os perfis" },
    publicar: { done: !!tenant.publishedVersionId, detail: tenant.publishedVersionId ? "no ar" : `${issues.filter((i) => i.level === "erro").length} pendência(s)` },
  };
  const steps = SETUP_STEPS.map((s) => ({ ...s, ...done[s.id], skipped: !!st.skipped?.includes(s.id) }));
  const required = steps.filter((s) => !s.optional);
  return { steps, progress: { done: required.filter((s) => s.done).length, total: required.length }, cuisine: tenant.settings?.cuisine || null, slug: tenant.slug, menuUrl: `${ctx.deps.publicUrl}/${tenant.slug}`, state: st, counts: { categories: snap.categories.length, items: snap.items.length, groups: snap.groups.length } };
}

export function setupRoutes() {
  const r = new Hono<Env>();
  r.get("/", async (c) => c.json(await setupStatus(ctxOf(c))));
  r.get("/cuisines", (c) => c.json(CUISINES.map((t) => ({ id: t.id, label: t.label, pitch: t.pitch, features: t.features, tips: t.tips, categories: t.categories.map((x) => x.name), groups: t.groups.map((g) => ({ name: g.name, role: g.role, min: g.min, max: g.max, rule: g.rule || "sum", freeQuota: g.freeQuota, options: g.options.length })), items: t.items.map((i) => ({ name: i.name, price: i.price, category: t.categories[i.cat].name, leadTimeHours: i.leadTimeHours, measure: i.measure, serves: i.serves, tags: i.tags })) }))));
  r.put("/state", async (c) => { await patchState(ctxOf(c), await body(c, z.object({ menuSource: z.enum(["ifood", "modelo", "zero"]).optional(), ordersMode: z.enum(["manager", "pdv"]).optional(), skipped: z.array(z.string()).optional() })) as never); return c.json({ ok: true }); });

  /** Passo 1: marca. O endereço do cardápio só muda enquanto nada foi publicado. */
  r.put("/brand", async (c) => {
    const i = await body(c, z.object({ name: z.string().min(2).max(60), slug: z.string().min(2).max(40).optional(), logoUrl: z.string().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), whatsapp: z.string().max(20).optional(), instagram: z.string().max(60).optional(), legalName: z.string().max(120).optional(), cnpj: z.string().max(20).optional() }));
    const ctx = ctxOf(c); const db = ctx.deps.db;
    const t = (await db.tenants.get(ctx.tenantId)) as unknown as Tenant & { publishedVersionId?: string };
    let slug = t.slug;
    if (i.slug && slugify(i.slug) !== t.slug) {
      if (t.publishedVersionId) throw new HttpError(409, "O cardápio já foi publicado: o endereço não muda mais por aqui");
      slug = slugify(i.slug);
      const other = await db.tenants.bySlug(slug); if (other && other.id !== t.id) throw new HttpError(409, "Esse endereço já está em uso");
    }
    const colors = i.color ? brandPalette(i.color) : t.branding.colors;
    const next = { ...t, slug, name: i.name, branding: { ...t.branding, name: i.name, colors, ...(i.logoUrl !== undefined ? { logoUrl: i.logoUrl || undefined } : {}) }, settings: { ...t.settings, whatsapp: i.whatsapp?.replace(/\D/g, "") || t.settings.whatsapp, instagram: i.instagram ?? t.settings.instagram, legalName: i.legalName ?? t.settings.legalName, cnpj: i.cnpj ?? t.settings.cnpj } };
    await db.tenants.put(next as never);
    return c.json(await setupStatus(ctx));
  });

  /** Passo 2: culinária principal (e secundárias). */
  r.put("/cuisine", async (c) => {
    const i = await body(c, z.object({ cuisine: z.enum(CUISINE_IDS), others: z.array(z.enum(CUISINE_IDS)).max(5).optional() }));
    const ctx = ctxOf(c); const t = (await ctx.deps.db.tenants.get(ctx.tenantId)) as unknown as Tenant;
    await ctx.deps.db.tenants.put({ ...t, settings: { ...t.settings, cuisine: i.cuisine, cuisines: i.others?.filter((x) => x !== i.cuisine) } } as never);
    return c.json(await setupStatus(ctx));
  });

  /** Passo 3: loja com raio de entrega simples (as áreas desenhadas no mapa ficam em Lojas e entrega). */
  r.put("/store", async (c) => {
    const i = await body(c, z.object({
      name: z.string().min(2), phone: z.string().optional(),
      address: z.object({ street: z.string().min(2), number: z.string().min(1), district: z.string().min(2), city: z.string().min(2), state: z.string().length(2), postalCode: z.string(), lat: z.number().optional(), lng: z.number().optional() }),
      hours: z.array(z.object({ weekday: z.number().int().min(0).max(6), open: hhmm, close: hhmm })),
      modes: z.object({ delivery: z.boolean(), takeout: z.boolean() }),
      delivery: z.object({ radiusKm: z.number().min(0.5).max(50), fee: z.number().min(0).max(100), etaMin: z.number().int().min(5), etaMax: z.number().int().min(5) }).optional(),
    }));
    const ctx = ctxOf(c); const db = ctx.deps.db;
    const cur = (await db.list<Store & { id: string }>("stores", ctx.tenantId))[0];
    if (i.address.lat == null && ctx.deps.geocode) { const g = await ctx.deps.geocode(i.address).catch(() => null); if (g) Object.assign(i.address, g); }
    const zones = cur?.zones?.length && !i.delivery ? cur.zones : i.delivery ? [{ id: cur?.zones.find((z) => z.kind === "radius")?.id || uid("zon"), name: `Até ${i.delivery.radiusKm} km`, kind: "radius" as const, radiusKm: i.delivery.radiusKm, color: "#2F6B3F", fee: i.delivery.fee, etaMin: i.delivery.etaMin, etaMax: i.delivery.etaMax, active: true }, ...(cur?.zones || []).filter((z) => z.kind !== "radius")] : [];
    const store: Store = {
      id: cur?.id || uid("sto"), tenantId: ctx.tenantId, name: i.name, slug: slugify(i.name), address: i.address, phone: i.phone?.replace(/\D/g, ""), hours: i.hours as Store["hours"], zones, modes: i.modes,
      payments: cur?.payments?.length ? cur.payments : paymentsFromSetup([], ["CREDIT_ON_DELIVERY", "DEBIT_ON_DELIVERY", "CASH"], {}), status: cur?.status === "paused" ? "paused" : "live",
    };
    await db.put("stores", ctx.tenantId, store as never);
    return c.json({ store, status: await setupStatus(ctx) });
  });

  /** Passo 5: formas de pagamento na entrega. Online (Pix/cartão) é configurado em Pagamentos. */
  r.put("/payments", async (c) => {
    const i = await body(c, z.object({ methods: z.array(z.enum(["CREDIT_ON_DELIVERY", "DEBIT_ON_DELIVERY", "VR_VA", "CASH", "CARD_ON_DELIVERY"])), cardBrands: z.array(z.string().max(30)).max(10).optional(), voucherBrands: z.array(z.string().max(30)).max(10).optional() }));
    const ctx = ctxOf(c); const db = ctx.deps.db;
    const cur = (await db.list<Store & { id: string }>("stores", ctx.tenantId))[0];
    if (!cur) throw new HttpError(422, "Cadastre a loja antes do pagamento");
    await db.put("stores", ctx.tenantId, { ...cur, payments: paymentsFromSetup(cur.payments, i.methods as PaymentCode[], { card: i.cardBrands, voucher: i.voucherBrands }) } as never);
    return c.json(await setupStatus(ctx));
  });

  /** Passo 4 (modelo): cria categorias, grupos e itens de exemplo da culinária. */
  r.post("/template", async (c) => {
    const i = await body(c, z.object({ cuisine: z.enum(CUISINE_IDS), mode: z.enum(["replace", "merge"]).default("merge"), withSamples: z.boolean().default(true) }));
    const ctx = ctxOf(c); const db = ctx.deps.db; const t = ctx.tenantId;
    const m = applyTemplate(cuisineById(i.cuisine), { withSamples: i.withSamples });
    if (i.mode === "replace") {
      for (const table of ["items", "option_groups", "categories"] as const) for (const d of await db.list<{ id: string }>(table, t)) await db.remove(table, t, d.id);
    }
    const existing = new Set((await db.list<{ id: string }>("categories", t)).map((x) => x.id));
    const offset = existing.size;
    let pos = 0;
    for (const cat of m.categories) if (!existing.has(cat.id)) await db.put("categories", t, { ...cat, position: offset + pos++ } as never);
    for (const g of m.groups) if (!(await db.get("option_groups", t, g.id))) await db.put("option_groups", t, g as never);
    let added = 0;
    for (const it of m.items) if (!(await db.get("items", t, it.id))) { await db.put("items", t, it as never); added++; }
    const ten = (await db.tenants.get(t)) as unknown as Tenant;
    if (!ten.settings.cuisine) await db.tenants.put({ ...ten, settings: { ...ten.settings, cuisine: i.cuisine } } as never);
    await patchState(ctx, { menuSource: "modelo" });
    return c.json({ categories: m.categories.length, groups: m.groups.length, items: added, status: await setupStatus(ctx) });
  });
  return r;
}
