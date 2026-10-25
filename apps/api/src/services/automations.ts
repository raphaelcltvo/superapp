import { daysSince, inSegment, uid, walletBalance, type Automation, type Coupon, type Customer, type LedgerEntry, type Order, type Segment } from "@cw/core";
import type { Ctx } from "./ctx";
import type { MessageTemplate } from "@cw/core";
import { deliver, pickChannel, trackedLink } from "./messaging";

export interface Message { id: string; automationId: string; customerId: string; ref: string; group: "envio" | "controle"; text: string; status: string; createdAt: string; convertedOrderId?: string }

const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 100; };
const fill = (t: string, v: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? "");

/** Varre os gatilhos e gera mensagens (ou registros de grupo de controle). Idempotente por automação + cliente + referência. */
export async function runAutomations(ctx: Ctx) {
  const { db } = ctx.deps; const t = ctx.tenantId; const now = ctx.deps.now();
  const autos = (await db.list<Automation & { id: string }>("automations", t)).filter((a) => a.active);
  if (!autos.length) return { created: 0, controle: 0 };
  const [customers, orders, segments, messages, coupons, ledger] = await Promise.all([
    db.list<Customer & { id: string }>("customers", t), db.list<Order & { id: string }>("orders", t, { since: new Date(+now - 400 * 864e5).toISOString() }),
    db.list<Segment & { id: string }>("segments", t), db.list<Message & { id: string }>("messages", t, { since: new Date(+now - 30 * 864e5).toISOString() }),
    db.list<Coupon & { id: string }>("coupons", t), db.list<LedgerEntry & { id: string }>("ledger", t),
  ]);
  const tenant = await db.tenants.get(t);
  const templates = await db.list<MessageTemplate & { id: string }>("message_templates", t);
  const byCustomer = new Map<string, Order[]>();
  for (const o of orders) if (o.customerId && o.status !== "cancelled") { if (!byCustomer.has(o.customerId)) byCustomer.set(o.customerId, []); byCustomer.get(o.customerId)!.push(o); }
  const seen = new Set(messages.map((m) => `${m.automationId}|${m.customerId}|${m.ref}`));
  const weekCount = (cid: string) => messages.filter((m) => m.customerId === cid && m.group === "envio" && !(m as { transactional?: boolean }).transactional && +now - +new Date(m.createdAt) < 7 * 864e5).length;
  const hour = now.getHours();
  let created = 0, controle = 0;
  const events = await db.events.list(t, { since: new Date(+now - 2 * 864e5).toISOString() });

  for (const a of autos) {
    if (a.quietHours && (a.quietHours[0] <= a.quietHours[1] ? hour >= a.quietHours[0] && hour < a.quietHours[1] : hour >= a.quietHours[0] || hour < a.quietHours[1])) continue;
    const seg = a.segmentId ? segments.find((s) => s.id === a.segmentId) : undefined;
    const targets: { c: Customer; ref: string; vars?: Record<string, string> }[] = [];
    const tr = a.trigger;
    for (const c of customers) {
      if (!pickChannel(c, a.channel || "whatsapp")) continue;
      if (seg && !inSegment(seg, c, now)) continue;
      const list = (byCustomer.get(c.id) || []).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
      if (tr.kind === "no_order_cycle" && list.length >= 2) {
        const gaps = list.slice(1).map((o, i) => (+new Date(o.createdAt) - +new Date(list[i].createdAt)) / 864e5);
        const avg = gaps.reduce((x, y) => x + y, 0) / gaps.length;
        const d = daysSince(c.lastOrderAt, now) ?? 0;
        if (d >= Math.max(3, avg * tr.multiplier)) targets.push({ c, ref: `ciclo:${c.lastOrderAt}`, vars: { dias: String(d) } });
      }
      if (tr.kind === "days_after_first_order" && list.length === 1 && (daysSince(list[0].createdAt, now) ?? 0) >= tr.days) targets.push({ c, ref: `1o:${list[0].id}` });
      if (tr.kind === "birthday" && c.birthday && c.birthday.slice(5, 10) === now.toISOString().slice(5, 10)) targets.push({ c, ref: `aniv:${now.getFullYear()}` });
      if (tr.kind === "order_concluded") {
        const last = [...list].reverse().find((o) => o.status === "concluded");
        const at = last?.statusHistory.find((h) => h.status === "concluded")?.at;
        if (last && at && +now - +new Date(at) >= tr.afterMinutes * 60e3 && +now - +new Date(at) < 3 * 864e5) targets.push({ c, ref: `pos:${last.id}`, vars: { pedido: last.displayId } });
      }
      if (tr.kind === "cashback_expiring") {
        const w = walletBalance(ledger.filter((l) => l.customerId === c.id), now);
        if (w.expiringSoon > 0) targets.push({ c, ref: `cb:${now.toISOString().slice(0, 10)}`, vars: { cashback: w.expiringSoon.toFixed(2).replace(".", ",") } });
      }
    }
    if (tr.kind === "cart_abandoned") {
      const bySession = new Map<string, typeof events>();
      for (const e of events) { if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []); bySession.get(e.sessionId)!.push(e); }
      for (const [sid, ev] of bySession) {
        const cid = ev.find((e) => e.customerId)?.customerId;
        if (!cid || !ev.some((e) => e.name === "add_to_cart") || ev.some((e) => e.name === "order_placed")) continue;
        const last = ev[ev.length - 1];
        if (+now - +new Date(last.ts) < tr.afterMinutes * 60e3) continue;
        const c = customers.find((x) => x.id === cid);
        if (c && pickChannel(c, a.channel || "whatsapp") && (!seg || inSegment(seg, c, now))) targets.push({ c, ref: `cart:${sid}` });
      }
    }
    const coupon = a.couponId ? coupons.find((x) => x.id === a.couponId) : undefined;
    for (const tg of targets) {
      const key = `${a.id}|${tg.c.id}|${tg.ref}`;
      if (seen.has(key) || weekCount(tg.c.id) >= a.maxPerCustomerPerWeek) continue;
      seen.add(key);
      const group = hash(tg.c.id + a.id) < a.holdoutPercent ? "controle" : "envio";
      const channel = pickChannel(tg.c, a.channel || "whatsapp")!;
      const link = trackedLink(ctx.deps.publicUrl, String(tenant?.slug), a.pageId, channel, a.id);
      const vars = { nome: (tg.c.name || "").split(" ")[0], cupom: coupon?.code || "", link, marca: String(tenant?.name || ""), ...tg.vars };
      const tplId = channel === "email" ? a.emailTemplateId : a.templateId;
      const tpl = tplId ? templates.find((x) => x.id === tplId) || null : null;
      await deliver(ctx, { customer: tg.c, channel, template: tpl, text: fill(a.template, vars), vars, ref: tg.ref, group, automationId: a.id, couponId: a.couponId });
      if (group === "envio") created++; else controle++;
    }
  }
  return { created, controle };
}

/** Resultado por automação: conversão em 7 dias do grupo que recebeu vs grupo de controle (incremento real). */
export async function automationReport(ctx: Ctx) {
  const { db } = ctx.deps; const t = ctx.tenantId;
  const [autos, msgs, orders] = await Promise.all([db.list<Automation & { id: string }>("automations", t), db.list<Message & { id: string }>("messages", t), db.list<Order & { id: string }>("orders", t)]);
  return autos.map((a) => {
    const ms = msgs.filter((m) => m.automationId === a.id);
    const conv = (g: "envio" | "controle") => {
      const list = ms.filter((m) => m.group === g);
      const ok = list.filter((m) => orders.some((o) => o.customerId === m.customerId && o.status !== "cancelled" && +new Date(o.createdAt) > +new Date(m.createdAt) && +new Date(o.createdAt) - +new Date(m.createdAt) <= 7 * 864e5));
      return { n: list.length, conv: ok.length, rate: list.length ? Math.round((ok.length / list.length) * 1000) / 10 : 0 };
    };
    const envio = conv("envio"), ctrl = conv("controle");
    return { id: a.id, name: a.name, envio, controle: ctrl, incremento: ctrl.n ? Math.round((envio.rate - ctrl.rate) * 10) / 10 : null };
  });
}
