import { Hono } from "hono";
import { z } from "zod";
import { funnel, funnelBy, inSegment, kpis, rfm, RFM_LABEL, uid, walletBalance, r2, daysSince, type Customer, type LedgerEntry, type Order, type Page, type PageResponse, type Segment, type TrackEvent } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { runAutomations, automationReport } from "../services/automations";
import { ledgerOf } from "../services/customers";

type O = Order & { id: string };
type C = Customer & { id: string };

export function crmRoutes() {
  const r = new Hono<Env>();
  const period = (c: import("hono").Context<Env>) => {
    const now = c.get("deps").now(); const days = Math.min(365, Number(c.req.query("days") || 30));
    const from = new Date(+now - days * 864e5), prevFrom = new Date(+from - days * 864e5);
    return { now, days, from: from.toISOString(), prevFrom: prevFrom.toISOString() };
  };

  /** Visão geral: período atual vs anterior, sempre comparando o mesmo perfil (novos com novos, recorrentes com recorrentes). */
  r.get("/overview", async (c) => {
    const { db } = c.get("deps"); const t = c.get("tenantId"); const p = period(c);
    const [orders, customers, events] = await Promise.all([db.list<O>("orders", t, { since: p.prevFrom }), db.list<C>("customers", t), db.events.list(t, { since: p.prevFrom })]);
    const allOrders = await db.list<O>("orders", t);
    const firstAt = new Map<string, string>();
    for (const o of [...allOrders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (o.customerId && o.status !== "cancelled" && !firstAt.has(o.customerId)) firstAt.set(o.customerId, o.createdAt);
    const isFirst = (o: O) => !!o.customerId && firstAt.get(o.customerId) === o.createdAt;
    const win = (from: string, to: string) => {
      const os = orders.filter((o) => o.createdAt >= from && o.createdAt < to);
      const ev = events.filter((e) => e.ts >= from && e.ts < to) as TrackEvent[];
      const lite = (l: O[]) => l.map((o) => ({ customerId: o.customerId, total: o.total, createdAt: o.createdAt, items: o.lines.reduce((a, x) => a + x.qty, 0) || ((o as unknown as { itemsCount?: number }).itemsCount ?? 1), status: o.status }));
      const k = kpis(lite(os), customers, ev, new Date(to));
      // 2º pedido e intervalo usam todo o histórico até o fim da janela (a coorte precisa de 60+ dias)
      const hist = kpis(lite(allOrders.filter((o) => o.createdAt < to)), customers, [], new Date(to));
      Object.assign(k, { secondOrderRate60d: hist.secondOrderRate60d, secondOrderCohort: hist.secondOrderCohort, avgIntervalDays: hist.avgIntervalDays, repeatCustomers: hist.repeatCustomers });
      const seg = (f: (o: O) => boolean) => { const l = os.filter((o) => o.status !== "cancelled" && f(o)); const rev = l.reduce((a, o) => a + o.total, 0); return { orders: l.length, revenue: r2(rev), avgTicket: l.length ? r2(rev / l.length) : 0, discount: r2(l.reduce((a, o) => a + o.discount + o.cashbackUsed, 0)) }; };
      return { ...k, novos: seg(isFirst), recorrentes: seg((o) => !isFirst(o) && !!o.customerId), cancelled: os.filter((o) => o.status === "cancelled").length, couponCost: r2(os.reduce((a, o) => a + o.discount, 0)), cashbackIssued: r2(os.reduce((a, o) => a + o.cashbackEarned, 0)), freeDeliveryCost: r2(os.reduce((a, o) => a + Math.max(0, (o.baseDeliveryFee ?? o.deliveryFee) - o.deliveryFee), 0)), serviceFees: r2(os.reduce((a, o) => a + (o.fees || []).reduce((x, f) => x + f.amount, 0), 0)) };
    };
    const cur = win(p.from, p.now.toISOString()), prev = win(p.prevFrom, p.from);
    // série diária
    const series: { day: string; visits: number; orders: number; revenue: number }[] = [];
    for (let d = 0; d < p.days; d++) {
      const a = new Date(+new Date(p.from) + d * 864e5).toISOString().slice(0, 10);
      const os = orders.filter((o) => o.createdAt.slice(0, 10) === a && o.status !== "cancelled");
      series.push({ day: a, visits: new Set(events.filter((e) => e.name === "visit" && e.ts.slice(0, 10) === a).map((e) => e.sessionId)).size, orders: os.length, revenue: r2(os.reduce((x, o) => x + o.total, 0)) });
    }
    return c.json({ days: p.days, current: cur, previous: prev, series });
  });

  r.get("/funnel", async (c) => {
    const { db } = c.get("deps"); const p = period(c);
    const events = (await db.events.list(c.get("tenantId"), { since: p.from })) as TrackEvent[];
    const by = c.req.query("by");
    if (!by) return c.json({ total: funnel(events) });
    const key = (e: TrackEvent) => by === "source" ? e.source || "direto" : by === "device" ? e.device || "?" : by === "profile" ? String(e.props?.profile || "?") : by === "hour" ? String(new Date(e.ts).getHours()).padStart(2, "0") + "h" : undefined;
    return c.json({ total: funnel(events), by: funnelBy(events, key).sort((a, b) => b.rows[0].sessions - a.rows[0].sessions) });
  });

  /** Onde a pessoa trava: itens abertos sem adicionar, tempo médio por etapa, cupons recusados. */
  r.get("/friction", async (c) => {
    const { db } = c.get("deps"); const p = period(c);
    const ev = await db.events.list(c.get("tenantId"), { since: p.from });
    const opened = new Map<string, number>(), added = new Map<string, number>();
    for (const e of ev) { const id = String(e.props?.itemId || ""); if (!id) continue; if (e.name === "item_view") opened.set(id, (opened.get(id) || 0) + 1); if (e.name === "add_to_cart") added.set(id, (added.get(id) || 0) + 1); }
    const items = [...opened.entries()].map(([id, n]) => ({ itemId: id, views: n, adds: added.get(id) || 0, rate: r2(((added.get(id) || 0) / n) * 100) })).sort((a, b) => a.rate - b.rate);
    const names = (n: string) => ev.filter((e) => e.name === n).length;
    return c.json({ items, signals: { hesitations: names("hesitation"), popupsShown: names("popup_shown"), popupsUsed: names("popup_coupon_applied"), couponErrors: names("coupon_error"), outOfArea: names("out_of_area"), searchNoResult: names("search_no_result") } });
  });

  r.get("/rfm", async (c) => {
    const now = c.get("deps").now();
    const cs = await c.get("deps").db.list<C>("customers", c.get("tenantId"));
    const dist: Record<string, { label: string; customers: number; spent: number }> = {};
    for (const k of Object.keys(RFM_LABEL)) dist[k] = { label: RFM_LABEL[k as keyof typeof RFM_LABEL], customers: 0, spent: 0 };
    for (const x of cs) { const s = rfm(x, now); dist[s].customers++; dist[s].spent = r2(dist[s].spent + x.spent); }
    return c.json(dist);
  });

  r.get("/customers", async (c) => {
    const { db, now } = c.get("deps"); const q = (c.req.query("q") || "").toLowerCase(); const seg = c.req.query("segment"); const rf = c.req.query("rfm");
    let cs = await db.list<C>("customers", c.get("tenantId"));
    if (q) cs = cs.filter((x) => (x.name || "").toLowerCase().includes(q) || (x.phone || "").includes(q.replace(/\D/g, "") || "§") || (x.email || "").toLowerCase().includes(q));
    if (seg) { const s = await db.get<Segment & { id: string }>("segments", c.get("tenantId"), seg); if (s) cs = cs.filter((x) => inSegment(s, x, now())); }
    if (rf) cs = cs.filter((x) => rfm(x, now()) === rf);
    const total = cs.length; const off = Number(c.req.query("offset") || 0), lim = Math.min(200, Number(c.req.query("limit") || 50));
    cs.sort((a, b) => (b.lastOrderAt || "").localeCompare(a.lastOrderAt || ""));
    return c.json({ total, rows: cs.slice(off, off + lim).map((x) => ({ ...x, rfm: rfm(x, now()), avgTicket: x.orders ? r2(x.spent / x.orders) : 0, daysSinceLastOrder: daysSince(x.lastOrderAt, now()) })) });
  });

  r.get("/customers/:id", async (c) => {
    const ctx = ctxOf(c); const { db } = ctx.deps; const now = ctx.deps.now();
    const x = await db.get<C>("customers", ctx.tenantId, c.req.param("id")); if (!x) throw new HttpError(404, "Cliente não encontrado");
    const [orders, ledger, events, segs, msgs] = await Promise.all([db.list<O>("orders", ctx.tenantId, { where: { customerId: x.id } }), ledgerOf(ctx, x.id), db.events.list(ctx.tenantId, { customerId: x.id, limit: 300 }), db.list<Segment & { id: string }>("segments", ctx.tenantId), db.list("messages", ctx.tenantId, { where: { customerId: x.id } })]);
    const valid = orders.filter((o) => o.status !== "cancelled").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const gaps = valid.slice(1).map((o, i) => (+new Date(o.createdAt) - +new Date(valid[i].createdAt)) / 864e5);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const fav = new Map<string, number>(); for (const o of valid) for (const l of o.lines) for (const ch of [l.name, ...l.choices.map((x) => x.name)]) fav.set(ch, (fav.get(ch) || 0) + 1);
    return c.json({
      customer: x, rfm: rfm(x, now), segments: segs.filter((s) => inSegment(s, x, now)).map((s) => ({ id: s.id, name: s.name })),
      wallet: walletBalance(ledger, now), ledger, orders, messages: msgs, timeline: events,
      prediction: avgGap ? { avgIntervalDays: r2(avgGap), nextOrderAround: new Date(+new Date(x.lastOrderAt!) + avgGap * 864e5).toISOString().slice(0, 10), overdue: (daysSince(x.lastOrderAt, now) || 0) > avgGap * 1.5 } : null,
      favorites: [...fav.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n })),
    });
  });
  r.patch("/customers/:id", async (c) => {
    const i = await body(c, z.object({ name: z.string().optional(), tags: z.array(z.string()).optional(), optinWhatsapp: z.boolean().optional(), birthday: z.string().optional() }));
    return c.json(await c.get("deps").db.patch("customers", c.get("tenantId"), c.req.param("id"), i));
  });
  r.post("/customers/:id/ledger", async (c) => {
    const i = await body(c, z.object({ amount: z.number(), note: z.string().min(3), expiresInDays: z.number().int().optional() }));
    const now = c.get("deps").now();
    const e: LedgerEntry = { id: uid("led"), customerId: c.req.param("id"), type: i.amount > 0 ? "bonus" : "adjust", amount: i.amount, note: `${i.note} (${c.get("admin")!.sub})`, createdAt: now.toISOString(), expiresAt: i.expiresInDays ? new Date(+now + i.expiresInDays * 864e5).toISOString() : undefined };
    await c.get("deps").db.put("ledger", c.get("tenantId"), e as never);
    return c.json(e, 201);
  });

  r.get("/segments/:id/preview", async (c) => {
    const { db, now } = c.get("deps");
    const s = await db.get<Segment & { id: string }>("segments", c.get("tenantId"), c.req.param("id")); if (!s) throw new HttpError(404, "Segmento não encontrado");
    const cs = (await db.list<C>("customers", c.get("tenantId"))).filter((x) => inSegment(s, x, now()));
    return c.json({ count: cs.length, optin: cs.filter((x) => x.optinWhatsapp).length, spent: r2(cs.reduce((a, x) => a + x.spent, 0)), sample: cs.slice(0, 10).map((x) => ({ id: x.id, name: x.name, orders: x.orders, lastOrderAt: x.lastOrderAt })) });
  });

  r.post("/automations/run", async (c) => c.json(await runAutomations(ctxOf(c))));
  r.get("/automations/report", async (c) => c.json(await automationReport(ctxOf(c))));
  r.get("/messages", async (c) => c.json(await c.get("deps").db.list("messages", c.get("tenantId"), { limit: 200 })));

  /** Respostas das páginas (LP) com NPS calculado: % promotores (9–10) − % detratores (0–6). */
  r.get("/pages/:id/responses", async (c) => {
    const { db } = c.get("deps"); const t = c.get("tenantId");
    const p = await db.get<Page & { id: string }>("pages", t, c.req.param("id")); if (!p) throw new HttpError(404, "Página não encontrada");
    const rs = await db.list<PageResponse & { id: string }>("page_responses", t, { where: { pageId: p.id } });
    const summary = p.blocks.filter((b) => "id" in b).map((b) => {
      const id = (b as { id: string }).id; const vals = rs.map((r) => r.answers[id]).filter((v) => v !== undefined && v !== "");
      if (b.kind === "nps") { const n = vals.map(Number); const pro = n.filter((x) => x >= 9).length, det = n.filter((x) => x <= 6).length; return { id, kind: b.kind, question: b.question, n: n.length, nps: n.length ? Math.round(((pro - det) / n.length) * 100) : null, promoters: pro, detractors: det }; }
      if (b.kind === "rating") { const n = vals.map(Number); return { id, kind: b.kind, question: b.question, n: n.length, avg: n.length ? r2(n.reduce((a, x) => a + x, 0) / n.length) : null }; }
      if (b.kind === "choice") { const cnt: Record<string, number> = {}; for (const v of vals) for (const x of ([] as string[]).concat(v as string)) cnt[x] = (cnt[x] || 0) + 1; return { id, kind: b.kind, question: b.question, n: vals.length, counts: cnt }; }
      return { id, kind: b.kind, question: (b as { question: string }).question, n: vals.length, last: vals.slice(0, 20) };
    });
    return c.json({ page: { id: p.id, title: p.title, slug: p.slug }, responses: rs.length, summary });
  });
  return r;
}
