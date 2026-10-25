import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { dataUrlStorage, type Deps } from "../src/deps";
import { FakeSaipos } from "../src/integrations/saipos/fake";
import { seedForneria } from "../src/seed/forneria";
import { hmacHex } from "../src/integrations/payments/types";

/** Gateway simulado por URL: registra as chamadas e responde no formato documentado de cada API. */
function gatewayMock() {
  const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  const mp = new Map<string, string>(); const pg = new Map<string, string>(); const as = new Map<string, string>();
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const h = Object.fromEntries(Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method || "GET", headers: h, body });
    const u = new URL(url);
    if (u.host === "mp.test") {
      if (h.authorization !== "Bearer TEST-token") return json(401, { message: "invalid access token" });
      if (u.pathname === "/v1/payments" && init.method === "POST") {
        const id = String(1000 + mp.size);
        if (body.payment_method_id === "pix") { mp.set(id, "pending"); return json(201, { id: Number(id), status: "pending", point_of_interaction: { transaction_data: { qr_code: "00020126PIXMP" + id, qr_code_base64: "iVBORw0KGgo=" } } }); }
        const ok = body.token !== "tok_recusado"; mp.set(id, ok ? "approved" : "rejected");
        return json(201, { id: Number(id), status: ok ? "approved" : "rejected", status_detail: ok ? "accredited" : "cc_rejected_insufficient_amount", payment_method_id: body.payment_method_id, card: { last_four_digits: "4242" } });
      }
      const m = u.pathname.match(/^\/v1\/payments\/(\d+)(\/refunds)?$/);
      if (m && m[2]) { mp.set(m[1], "refunded"); return json(201, { id: 1, status: "approved" }); }
      if (m) return json(200, { id: Number(m[1]), status: mp.get(m[1]) || "pending" });
      if (u.pathname === "/v1/payment_methods") return json(200, []);
    }
    if (u.host === "pg.test") {
      if (h.authorization !== "Basic " + btoa("sk_test_123:")) return json(401, { message: "Authorization has been denied" });
      if (u.pathname === "/core/v5/orders") {
        const id = "ch_" + (pg.size + 1);
        if (body.payments[0].payment_method === "pix") { pg.set(id, "pending"); return json(200, { id: "or_1", status: "pending", charges: [{ id, status: "pending", last_transaction: { status: "waiting_payment", qr_code: "00020126PIXPG", qr_code_url: "https://pg.test/qr.png", expires_at: "2099-01-01T00:00:00Z" } }] }); }
        pg.set(id, "paid");
        return json(200, { id: "or_2", status: "paid", charges: [{ id, status: "paid", last_transaction: { status: "captured", card: { brand: "Mastercard", last_four_digits: "5454" } } }] });
      }
      const m = u.pathname.match(/^\/core\/v5\/charges\/(ch_\d+)$/);
      if (m && init.method === "DELETE") { pg.set(m[1], "canceled"); return json(200, { id: m[1], status: "canceled" }); }
      if (m) return json(200, { id: m[1], status: pg.get(m[1]) || "pending" });
    }
    if (u.host === "as.test") {
      if (h.access_token !== "$aact_teste" || !h["user-agent"]) return json(401, { errors: [{ description: "invalid" }] });
      if (u.pathname === "/v3/customers" && init.method === "POST") return json(200, { id: "cus_1" });
      if (u.pathname === "/v3/payments" && init.method === "POST") { const id = "pay_" + (as.size + 1); as.set(id, "PENDING"); return json(200, { id, status: "PENDING" }); }
      const m = u.pathname.match(/^\/v3\/payments\/(pay_\d+)(\/pixQrCode|\/refund)?$/);
      if (m && m[2] === "/pixQrCode") return json(200, { encodedImage: "iVBORw0KGgo=", payload: "00020126PIXAS", expirationDate: "2099-01-01 23:59:59" });
      if (m && m[2] === "/refund") { as.set(m[1], "REFUNDED"); return json(200, { id: m[1], status: "REFUNDED" }); }
      if (m) return json(200, { id: m[1], status: as.get(m[1]) || "PENDING" });
    }
    return json(404, { message: "rota inexistente no mock" });
  };
  return { fetch, calls, mp, pg, as };
}

describe("pagamento online", () => {
  const gw = gatewayMock();
  const saipos = new FakeSaipos("https://saipos.test", { p1: "s" });
  let app: ReturnType<typeof createApp>; let admin = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(admin ? { authorization: "Bearer " + admin } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  };
  const asAdmin = async () => { admin = ""; admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token; };
  const order = (payment: Record<string, unknown>, phone: string, extra: Record<string, unknown> = {}) => call("POST", "/public/forneria-original/orders", {
    storeId: "sto_leblon", mode: "DELIVERY", address: { street: "Rua Dias Ferreira", number: "100", district: "Leblon", city: "Rio de Janeiro", state: "RJ", postalCode: "22431050", lat: -22.984, lng: -43.225 },
    lines: [{ itemId: "c1", qty: 1, selection: { g_massa40: { gourmet: 1 }, g_sab99: { marguerita: 1, mucarela: 1 } } }], payment, customer: { name: "Paga Online", phone, optinWhatsapp: true }, ...extra,
  });
  const configure = async (cfg: Record<string, unknown>) => { await asAdmin(); const r = await call("PUT", "/admin/integrations/payments", { enabled: true, env: "sandbox", pixExpiresMinutes: 15, maxInstallments: 3, methods: { pix: true, card: true }, requirePassword: false, ...cfg }); admin = ""; return r; };
  const webhookToken = async () => { await asAdmin(); const u = (await call("GET", "/admin/integrations/payments")).body.webhookUrl as string; admin = ""; return u.split("token=")[1]; };

  beforeAll(async () => {
    const db = memoryDb();
    const deps: Deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send() { return { id: "m", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://cardapio.test", saiposFetch: (u, i) => saipos.fetch(u, i), paymentsFetch: gw.fetch };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: {}, history: false });
    await asAdmin();
    await call("POST", "/admin/publish", {});
    await call("PUT", "/admin/integrations/saipos/sto_leblon", { enabled: true, env: "homolog", idPartner: "p1", secret: "s", codStore: "896", deliveryBy: "RESTAURANT", autoSend: true, payments: {}, baseUrl: "https://saipos.test" });
    admin = "";
  }, 60000);

  it("gateway de teste: Pix fica aguardando, não vai à SAIPOS e libera ao pagar; cancelar estorna", async () => {
    expect((await configure({ gateway: "fake" })).status).toBe(200);
    const menu = await call("GET", "/public/forneria-original/menu");
    expect(menu.body.store.payments.map((p: any) => p.code)).toContain("CARD_ONLINE");
    expect(menu.body.onlinePayments.gateway).toBe("fake");
    const r = await order({ code: "PIX_ONLINE" }, "21911110001");
    expect(r.status).toBe(201);
    const o = r.body.order;
    expect(o.status).toBe("awaiting_payment");
    expect(o.payment.online.pix.qrImage).toMatch(/^data:image\/svg\+xml/);
    expect(saipos.orders.has(o.id)).toBe(false);
    const tok = { "x-customer-token": r.body.customerToken };
    expect((await call("POST", `/public/forneria-original/payments/fake/${o.payment.online.chargeId}/pay`)).body.status).toBe("sent_to_pos");
    expect(saipos.orders.get(o.id)!.payload.payment_types[0]).toMatchObject({ code: "PARTNER_PAYMENT", complement: "pix", type: "ONLINE" });
    const t = await call("GET", `/public/forneria-original/orders/${o.id}`, undefined, tok);
    expect(t.body.payment.online.status).toBe("paid");
    await asAdmin();
    const c = await call("POST", `/admin/orders/${o.id}/status`, { status: "cancelled" });
    expect(c.status).toBe(200);
    const d = await call("GET", `/admin/orders/${o.id}`);
    expect(d.body.payment.online.status).toBe("refunded");
    const rep = await call("GET", "/admin/payments");
    expect(rep.body.totals.refunded.count).toBe(1);
    admin = "";
  });

  it("gateway de teste: cartão recusado não vira pedido; aprovado vai direto para a cozinha", async () => {
    const no = await order({ code: "CARD_ONLINE", cardToken: "fake_tok_0002_visa_x", installments: 1, cardBrand: "visa", cardLast4: "0002" }, "21911110002");
    expect(no.status).toBe(402);
    expect(no.body.error).toMatch(/recusado/);
    const ok = await order({ code: "CARD_ONLINE", cardToken: "fake_tok_1111_visa_x", installments: 2, cardBrand: "visa", cardLast4: "1111" }, "21911110003");
    expect(ok.body.order.status).toBe("sent_to_pos");
    expect(saipos.orders.get(ok.body.order.id)!.payload.payment_types[0]).toMatchObject({ code: "PARTNER_PAYMENT", complement: "VISA", type: "ONLINE" });
  });

  it("Mercado Pago: Pix com QR real, webhook assinado e consulta de status", async () => {
    expect((await configure({ gateway: "mercadopago", accessToken: "TEST-token", publicKey: "TEST-pk", webhookSecret: "segredo-mp", baseUrl: "https://mp.test" })).status).toBe(200);
    const r = await order({ code: "PIX_ONLINE" }, "21911110004");
    const o = r.body.order;
    expect(o.payment.online.pix.qrText).toMatch(/^00020126PIXMP/);
    expect(o.payment.online.pix.qrImage).toBe("data:image/png;base64,iVBORw0KGgo=");
    const req = gw.calls.find((c) => c.url === "https://mp.test/v1/payments" && c.body.payment_method_id === "pix")!;
    expect(req.headers["x-idempotency-key"]).toBeTruthy();
    expect(req.body.notification_url).toMatch(/\/webhooks\/payments\/mercadopago\/forneria-original\?token=/);
    expect(req.body.date_of_expiration).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-03:00$/);
    expect(+new Date(req.body.date_of_expiration) - Date.now()).toBeGreaterThan(29 * 60e3); // mínimo de 30 min no Mercado Pago, mesmo com 15 configurado
    const id = o.payment.online.chargeId; gw.mp.set(id, "approved");
    const tok = await webhookToken();
    const ts = String(Date.now()); const rid = "req-123";
    const sig = await hmacHex("segredo-mp", `id:${id};request-id:${rid};ts:${ts};`);
    const bad = await call("POST", `/webhooks/payments/mercadopago/forneria-original?token=${tok}&data.id=${id}&type=payment`, JSON.stringify({ type: "payment", action: "payment.updated", data: { id } }), { "x-signature": `ts=${ts},v1=errado`, "x-request-id": rid });
    expect(bad.status).toBe(401);
    const good = await call("POST", `/webhooks/payments/mercadopago/forneria-original?token=${tok}&data.id=${id}&type=payment`, JSON.stringify({ type: "payment", action: "payment.updated", data: { id } }), { "x-signature": `ts=${ts},v1=${sig}`, "x-request-id": rid });
    expect(good.body.status).toBe("paid");
    expect(saipos.orders.has(o.id)).toBe(true);
    // sem x-request-id o par sai do manifesto
    const sig2 = await hmacHex("segredo-mp", `id:${id};ts:${ts};`);
    expect((await call("POST", `/webhooks/payments/mercadopago/forneria-original?token=${tok}&data.id=${id}&type=payment`, "{}", { "x-signature": `ts=${ts},v1=${sig2}` })).status).toBe(200);
  });

  it("Mercado Pago: cartão recusado devolve o motivo em português", async () => {
    const r = await order({ code: "CARD_ONLINE", cardToken: "tok_recusado", installments: 1, cardBrand: "mastercard", cardLast4: "9999" }, "21911110005", { customerDocument: "529.982.247-25" });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe("Saldo ou limite insuficiente");
    const req = gw.calls.filter((c) => c.url === "https://mp.test/v1/payments").pop()!;
    expect(req.body).toMatchObject({ token: "tok_recusado", payment_method_id: "master", payer: { identification: { type: "CPF", number: "52998224725" } } });
  });

  it("Pagar.me: autenticação básica, cartão aprovado com bandeira e webhook de cobrança", async () => {
    expect((await configure({ gateway: "pagarme", secretKey: "sk_test_123", publicKey: "pk_test_123", baseUrl: "https://pg.test/core/v5" })).status).toBe(200);
    const pc = await call("GET", "/public/forneria-original/payments/config");
    expect(pc.body.tokenizeUrl).toBe("https://pg.test/core/v5/tokens?appId=pk_test_123");
    expect(JSON.stringify(pc.body)).not.toContain("sk_test");
    const ok = await order({ code: "CARD_ONLINE", cardToken: "token_abc", installments: 3, cardBrand: "mastercard", cardLast4: "5454" }, "21911110006", { customerDocument: "52998224725" });
    expect(ok.body.order.payment.online).toMatchObject({ status: "paid", card: { brand: "Mastercard", last4: "5454", installments: 3 } });
    const req = gw.calls.filter((c) => c.url === "https://pg.test/core/v5/orders").pop()!;
    expect(req.body.payments[0].credit_card).toMatchObject({ card_token: "token_abc", installments: 3 });
    expect(req.body.items[0].amount).toBe(Math.round(ok.body.order.total * 100));
    const pix = await order({ code: "PIX_ONLINE" }, "21911110007", { customerDocument: "52998224725" });
    const ch = pix.body.order.payment.online.chargeId; gw.pg.set(ch, "paid");
    const tok = await webhookToken();
    const w = await call("POST", `/webhooks/payments/pagarme/forneria-original?token=${tok}`, JSON.stringify({ id: "hook_1", type: "charge.paid", data: { id: ch, status: "paid" } }));
    expect(w.body.status).toBe("paid");
    expect((await call("POST", `/webhooks/payments/pagarme/forneria-original?token=errado`, "{}")).status).toBe(401);
    const secrets = await (async () => { await asAdmin(); const g = await call("GET", "/admin/integrations/payments"); admin = ""; return g.body.config; })();
    expect(secrets.secretKey).toBe("••••_123");
    // estorno total: DELETE sem corpo
    await asAdmin(); expect((await call("POST", `/admin/orders/${ok.body.order.id}/refund`, {})).status).toBe(200); admin = "";
    const del = gw.calls.filter((c) => c.method === "DELETE").pop()!;
    expect(del.body).toBeUndefined();
  });

  it("Asaas: Pix com CPF, User-Agent e webhook reconsultando o status", async () => {
    expect((await configure({ gateway: "asaas", apiKey: "$aact_teste", baseUrl: "https://as.test/v3", methods: { pix: true, card: false } })).status).toBe(200);
    expect((await order({ code: "PIX_ONLINE" }, "21911110010")).status).toBe(422); // sem CPF
    const r = await order({ code: "PIX_ONLINE" }, "21911110011", { customerDocument: "52998224725" });
    expect(r.body.order.payment.online.pix).toMatchObject({ qrText: "00020126PIXAS", qrImage: "data:image/png;base64,iVBORw0KGgo=" });
    const id = r.body.order.payment.online.chargeId; gw.as.set(id, "RECEIVED");
    const tok = await webhookToken();
    const evt = JSON.stringify({ id: "evt_1", event: "PAYMENT_RECEIVED", dateCreated: "2026-10-23 10:00:00", payment: { id, status: "RECEIVED" } });
    expect((await call("POST", `/webhooks/payments/asaas/forneria-original?token=${tok}`, evt)).body.status).toBe("paid");
    expect((await call("POST", `/webhooks/payments/asaas/forneria-original?token=${tok}`, evt)).body.status).toBe("paid"); // reentrega do mesmo evento não duplica
    expect(saipos.orders.has(r.body.order.id)).toBe(true);
  });

  it("sem gateway configurado o Pix continua como antes", async () => {
    await asAdmin(); await call("PUT", "/admin/integrations/payments", { enabled: false, gateway: "fake", env: "sandbox", methods: { pix: true, card: false }, pixExpiresMinutes: 15, maxInstallments: 1 }); admin = "";
    const r = await order({ code: "PIX_ONLINE" }, "21911110008");
    expect(r.body.order.status).toBe("sent_to_pos");
    expect((await order({ code: "CARD_ONLINE", cardToken: "x" }, "21911110009")).status).toBe(422);
  });
});
