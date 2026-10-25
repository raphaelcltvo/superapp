import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { dataUrlStorage, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import { fakeProviders } from "../src/services/messaging";
import type { Db } from "../src/db/types";

const T = "ten_forneria";
const SLUG = "forneria-original";

describe("WhatsApp por QR code (Z-API, Evolution) e avisos de pedido", () => {
  let app: ReturnType<typeof createApp>; let db: Db; let admin = "";
  const calls: { url: string; method: string; headers: Record<string, string>; body?: any }[] = [];
  const slept: number[] = [];
  let zConnected = false; let evoExists = false; let evoOpen = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const mockFetch = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method || "GET", headers: (init.headers || {}) as Record<string, string>, body });
    if (url.startsWith("https://api.z-api.io/instances/INST1/token/TOK1/")) {
      const path = url.split("/token/TOK1/")[1];
      if ((init.headers as Record<string, string>)?.["Client-Token"] !== "CLI1") return json({ error: "client-token inválido" }, 401);
      if (path === "status") return json({ connected: zConnected, smartphoneConnected: zConnected, phone: zConnected ? "5521911112222" : undefined });
      if (path === "qr-code/image") return json({ value: "data:image/png;base64,QRZAPI" });
      if (path === "send-text") return json({ zaapId: "z1", messageId: "ZMSG" + calls.length, id: "ZMSG" + calls.length });
      if (path === "update-webhook-received") return json({ value: true });
      if (path === "disconnect") return json({ value: true });
    }
    if (url.startsWith("https://evo.test/")) {
      if ((init.headers as Record<string, string>)?.apikey !== "EVOKEY") return json({ message: "unauthorized" }, 401);
      const path = url.slice("https://evo.test/".length);
      if (path === "instance/connect/forneria") return evoExists ? json({ pairingCode: "ABCD1234", code: "2@xyz", base64: "data:image/png;base64,QREVO" }) : json({ response: { message: ["instance does not exist"] } }, 404);
      if (path === "instance/create") { evoExists = true; return json({ instance: { instanceName: "forneria", status: "created" }, qrcode: { base64: "data:image/png;base64,QREVONEW", pairingCode: "WXYZ9876" } }, 201); }
      if (path === "instance/connectionState/forneria") return evoExists ? json({ instance: { instanceName: "forneria", state: evoOpen ? "open" : "connecting" } }) : json({}, 404);
      if (path === "message/sendText/forneria") return json({ key: { remoteJid: body.number + "@s.whatsapp.net", fromMe: true, id: "EVOMSG" + calls.length }, status: "PENDING" }, 201);
      if (path === "webhook/set/forneria") return json({ webhook: { enabled: true } }, 201);
      if (path === "instance/logout/forneria") return json({ status: "SUCCESS" });
    }
    return json({ error: "não mapeado " + url }, 404);
  };
  const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(auth && admin ? { authorization: "Bearer " + admin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch { /* texto */ }
    return { status: r.status, body: j, text };
  };
  const waDoc = async () => (await db.get<any>("integrations", T, "whatsapp"))!;

  beforeAll(async () => {
    db = memoryDb();
    const deps: Deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send() { return { id: "x", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://api.test", messagingFetch: mockFetch, sleep: async (ms) => { slept.push(ms); } };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: { cover: "https://img.test/capa.jpg", poster: "https://img.test/poster.jpg" }, history: true });
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    await call("POST", "/admin/publish", {});
  }, 60000);
  beforeEach(() => { calls.length = 0; });

  it("Z-API: salva com segredos mascarados, gera QR, aponta o webhook e conecta", async () => {
    expect((await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "zapi" })).status).toBe(422); // sem instância
    expect((await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "zapi", zapi: { instanceId: "INST1", instanceToken: "TOK1", clientToken: "CLI1" } })).status).toBe(200);
    const cfg = (await call("GET", "/admin/messaging/config")).body;
    expect(cfg.whatsapp.zapi.instanceToken).toBe("••••TOK1"); expect(cfg.whatsapp.zapi.clientToken).toBe("••••CLI1");
    expect(cfg.whatsapp.webhookToken).toBeUndefined();
    expect(cfg.webhooks.whatsappQr).toMatch(/^https:\/\/api\.test\/webhooks\/whatsapp-qr\/zapi\/forneria-original\?token=\w{20,}$/);
    // salvar de novo com o valor mascarado mantém o segredo e a conexão
    await call("PUT", "/admin/messaging/config/whatsapp", cfg.whatsapp);
    expect((await waDoc()).config.zapi.instanceToken).toBe("TOK1");

    const con = (await call("POST", "/admin/messaging/whatsapp/connect")).body;
    expect(con).toMatchObject({ status: "waiting_scan", connected: false, qr: "data:image/png;base64,QRZAPI" });
    const hook = calls.find((c) => c.url.endsWith("update-webhook-received"))!;
    expect(hook.method).toBe("PUT"); expect(hook.body.value).toBe(cfg.webhooks.whatsappQr);
    expect((await call("GET", "/admin/messaging/whatsapp/status")).body).toMatchObject({ connected: false, provider: "zapi" });
    zConnected = true;
    expect((await call("GET", "/admin/messaging/whatsapp/status")).body).toMatchObject({ connected: true, phone: "5521911112222" });
    expect((await waDoc()).state).toMatchObject({ connected: true, phone: "5521911112222" });
    expect((await call("POST", "/admin/messaging/whatsapp/connect")).body).toMatchObject({ connected: true, status: "connected" });
  });

  it("Z-API: envio de teste em texto livre e webhook de entrada com token", async () => {
    const r = (await call("POST", "/admin/messaging/test", { channel: "whatsapp", to: "+55 21 98888-7777" })).body;
    expect(r.ok).toBe(true);
    const send = calls.find((c) => c.url.endsWith("send-text"))!;
    expect(send.body.phone).toBe("5521988887777"); expect(send.body.message).toContain("Forneria");
    const url = (await call("GET", "/admin/messaging/config")).body.webhooks.whatsappQr.replace("https://api.test", "");
    const cust = (await db.list<any>("customers", T)).find((c) => c.phone && c.optinWhatsapp);
    expect((await call("POST", url.replace(/token=\w+/, "token=errado"), { phone: cust.phone, text: { message: "oi" } }, false)).status).toBe(401);
    expect((await call("POST", url.replace("/zapi/", "/evolution/"), { phone: cust.phone }, false)).status).toBe(401); // provedor diferente do configurado
    expect((await call("POST", url, { phone: cust.phone, fromMe: true, messageId: "M0", text: { message: "eco" } }, false)).body).toMatchObject({ inbound: 0, ignored: 1 });
    expect((await call("POST", url, { phone: "120363-grupo", isGroup: true, messageId: "M1", text: { message: "grupo" } }, false)).body).toMatchObject({ inbound: 0 });
    expect((await call("POST", url, { phone: cust.phone, messageId: "M2", senderName: "Cliente Z", text: { message: "Quero o cardápio" }, momment: Date.now() }, false)).body).toMatchObject({ inbound: 1 });
    expect((await call("POST", url, { phone: cust.phone, messageId: "M2", text: { message: "Quero o cardápio" } }, false)).body).toMatchObject({ inbound: 0 }); // reenvio
    const ib = (await db.list<any>("inbox", T)).find((x) => x.text === "Quero o cardápio")!;
    expect(ib.customerId).toBe(cust.id);
    // resposta pelo QR não tem a regra das 24h da Meta
    await db.patch("inbox", T, ib.id, { at: new Date(Date.now() - 3 * 864e5).toISOString() });
    expect((await call("POST", `/admin/messaging/inbox/${ib.id}/reply`, { text: "Segue o link!" })).status).toBe(200);
    // SAIR descadastra
    expect((await call("POST", url, { phone: cust.phone, messageId: "M3", text: { message: "SAIR" } }, false)).body).toMatchObject({ inbound: 1 });
    expect((await db.get<any>("customers", T, cust.id)).optinWhatsapp).toBe(false);
    await db.patch("customers", T, cust.id, { optinWhatsapp: true });
    // status de entrega
  });

  it("avisos de pedido: aceito e saiu para entrega vão pelo WhatsApp, uma vez cada, sem contar como marketing", async () => {
    const cust = (await db.list<any>("customers", T)).find((c) => c.phone)!;
    const store = (await db.list<any>("stores", T))[0];
    const order = { id: "ord_notif1", displayId: "9001", storeId: store.id, customerId: cust.id, mode: "DELIVERY", lines: [], subtotal: 100, discount: 0, deliveryFee: 0, fees: [], strategiesApplied: [], cashbackUsed: 0, total: 100, cashbackEarned: 0, payment: { code: "CASH" }, status: "created", statusHistory: [], createdAt: new Date().toISOString() };
    await db.put("orders", T, order as never);
    expect((await call("POST", "/admin/orders/ord_notif1/status", { status: "confirmed" })).status).toBe(200);
    expect((await call("POST", "/admin/orders/ord_notif1/status", { status: "ready" })).status).toBe(200); // entrega: "pronto" não avisa
    expect((await call("POST", "/admin/orders/ord_notif1/status", { status: "dispatched" })).status).toBe(200);
    const msgs = (await db.list<any>("messages", T, { where: { ref: "pedido:ord_notif1" } }));
    expect(msgs.map((m) => m.orderEvent).sort()).toEqual(["confirmed", "dispatched"]);
    expect(msgs.every((m) => m.transactional && m.status === "sent" && m.to === cust.phone)).toBe(true);
    const texts = calls.filter((c) => c.url.endsWith("send-text")).map((c) => c.body.message);
    expect(texts[0]).toMatch(/pedido #9001 na Forneria Original foi aceito/);
    expect(texts[1]).toMatch(/saiu para entrega.*forneria-original\?pedido=9001/);
    // status de leitura pelo webhook da Z-API
    const url = (await call("GET", "/admin/messaging/config")).body.webhooks.whatsappQr.replace("https://api.test", "");
    expect((await call("POST", url, { type: "MessageStatusCallback", status: "READ", ids: [msgs[0].providerId] }, false)).body.statuses).toBe(1);
    expect((await db.get<any>("messages", T, msgs[0].id)).readAt).toBeTruthy();
    // personalização: muda o texto do cancelado
    const s = (await call("GET", "/admin/messaging/notifications")).body;
    s.events.cancelled.text = "Pedido #{{pedido}} cancelado, {{nome}}.";
    expect((await call("PUT", "/admin/messaging/notifications", s)).status).toBe(200);
    calls.length = 0;
    await call("POST", "/admin/orders/ord_notif1/status", { status: "cancelled" });
    expect(calls.find((c) => c.url.endsWith("send-text"))!.body.message).toMatch(/^Pedido #9001 cancelado, /);
    // overview de marketing não conta os avisos
    const before = (await db.list<any>("messages", T)).filter((m) => m.group === "envio" && !m.transactional && m.channel === "whatsapp").length;
    expect((await call("GET", "/admin/messaging/overview")).body.whatsapp.sent).toBeLessThanOrEqual(before);
  });

  it("campanha pelo QR: ritmo de 4 a 8 s, lote por rodada, teto diário e aviso", async () => {
    await db.patch("integrations", T, "whatsapp", { config: { ...(await waDoc()).config, perTick: 3, dailyCap: 5 } });
    const tpl = (await call("POST", "/admin/message_templates", { name: "Volta QR", channel: "whatsapp", waBody: "Oi {{1}}, use {{2}}", waVars: [{ source: "nome" }, { source: "cupom" }] }));
    expect(tpl.status).toBe(201);
    const camp = (await call("POST", "/admin/campaigns", { name: "QR teste", channel: "whatsapp", templateId: tpl.body.id, holdoutPercent: 0, maxPerCustomerPerWeek: 5, status: "draft" }));
    expect(camp.status).toBe(201);
    slept.length = 0;
    const r1 = (await call("POST", `/admin/messaging/campaigns/${camp.body.id}/send`)).body;
    expect(r1).toMatchObject({ sent: 3, throttled: true, done: false });
    expect(r1.warning).toMatch(/ritmo humano/);
    expect(slept.length).toBe(2); expect(slept.every((ms) => ms >= 4000 && ms < 8000)).toBe(true);
    const r2 = (await call("POST", `/admin/messaging/campaigns/${camp.body.id}/send`)).body;
    expect(r2.sent).toBe(2); expect(r2.capLeft).toBe(0);
    const r3 = (await call("POST", `/admin/messaging/campaigns/${camp.body.id}/send`)).body;
    expect(r3).toMatchObject({ sent: 0, waiting: "limite diário do WhatsApp por QR code" });
    const sent = calls.filter((c) => c.url.endsWith("send-text")).map((c) => c.body.message);
    expect(sent[0]).toMatch(/^Oi \S+, use /);
  });

  it("Evolution: cria a instância se não existir, QR e código de pareamento, envio e webhook", async () => {
    expect((await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "evolution", evolution: { baseUrl: "https://evo.test", apiKey: "EVOKEY", instance: "forneria" } })).status).toBe(200);
    expect((await waDoc()).state).toEqual({ connected: false }); // trocou de provedor: conexão zerada
    const con = (await call("POST", "/admin/messaging/whatsapp/connect")).body;
    expect(con).toMatchObject({ connected: false, qr: "data:image/png;base64,QREVONEW", pairingCode: "WXYZ9876" });
    expect(calls.some((c) => c.url.endsWith("instance/create") && c.body.integration === "WHATSAPP-BAILEYS")).toBe(true);
    const hook = calls.find((c) => c.url.endsWith("webhook/set/forneria"))!;
    expect(hook.body.webhook.url).toMatch(/\/webhooks\/whatsapp-qr\/evolution\/forneria-original\?token=/);
    expect((await call("POST", "/admin/messaging/whatsapp/connect")).body.qr).toBe("data:image/png;base64,QREVO");
    evoOpen = true;
    expect((await call("GET", "/admin/messaging/whatsapp/status")).body).toMatchObject({ connected: true, provider: "evolution" });
    const r = (await call("POST", "/admin/messaging/test", { channel: "whatsapp", to: "5521977776666", text: "Olá" })).body;
    expect(r).toMatchObject({ ok: true }); expect(r.providerId).toMatch(/^EVOMSG/);
    expect(calls.find((c) => c.url.endsWith("message/sendText/forneria"))!.body).toEqual({ number: "5521977776666", text: "Olá" });
    const url = (await call("GET", "/admin/messaging/config")).body.webhooks.whatsappQr.replace("https://api.test", "");
    const up = (k: object) => ({ event: "messages.upsert", instance: "forneria", data: k });
    expect((await call("POST", url, up({ key: { remoteJid: "5521977776666@s.whatsapp.net", fromMe: true, id: "E0" }, message: { conversation: "eco" } }), false)).body).toMatchObject({ inbound: 0, ignored: 1 });
    expect((await call("POST", url, up({ key: { remoteJid: "1203630@g.us", fromMe: false, id: "E1" }, message: { conversation: "grupo" } }), false)).body).toMatchObject({ inbound: 0, ignored: 1 });
    expect((await call("POST", url, up({ key: { remoteJid: "5521977776666@s.whatsapp.net", fromMe: false, id: "E2" }, pushName: "Bia", message: { extendedTextMessage: { text: "Vocês entregam no Recreio?" } }, messageTimestamp: Math.floor(Date.now() / 1000) }), false)).body).toMatchObject({ inbound: 1 });
    expect((await db.list<any>("inbox", T)).some((x) => x.from === "5521977776666" && x.name === "Bia" && x.text === "Vocês entregam no Recreio?")).toBe(true);
    // status de leitura de uma mensagem gravada
    await db.put("messages", T, { id: "msg_evo", channel: "whatsapp", customerId: "c", ref: "t", group: "envio", text: "x", status: "sent", providerId: "EVOREAD", createdAt: new Date().toISOString() } as never);
    expect((await call("POST", url, { event: "MESSAGES_UPDATE", data: { keyId: "EVOREAD", status: "READ" } }, false)).body.statuses).toBe(1);
    expect((await db.get<any>("messages", T, "msg_evo"))!.readAt).toBeTruthy();
    expect((await call("POST", "/admin/messaging/whatsapp/disconnect")).body).toEqual({ ok: true });
    expect(calls.some((c) => c.url.endsWith("instance/logout/forneria") && c.method === "DELETE")).toBe(true);
    expect((await waDoc()).state.connected).toBe(false);
  });

  it("teste (demonstração): QR simulado conecta após a leitura e avisos são registrados", async () => {
    expect((await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "fake" })).status).toBe(200);
    const con = (await call("POST", "/admin/messaging/whatsapp/connect")).body;
    expect(con.qr).toMatch(/^data:image\/svg\+xml;base64,/); expect(con.connected).toBe(false);
    expect((await call("GET", "/admin/messaging/whatsapp/status")).body.connected).toBe(false);
    expect((await call("POST", "/admin/messaging/whatsapp/simulate-scan")).status).toBe(200);
    expect((await call("GET", "/admin/messaging/whatsapp/status")).body).toMatchObject({ connected: true, provider: "fake", phone: "5521999990000" });
    const before = fakeProviders(T).wa.sent.length;
    const cust = (await db.list<any>("customers", T)).find((c) => c.phone)!;
    const store = (await db.list<any>("stores", T))[0];
    await db.put("orders", T, { id: "ord_notif2", displayId: "9002", storeId: store.id, customerId: cust.id, mode: "TAKEOUT", lines: [], subtotal: 50, discount: 0, deliveryFee: 0, fees: [], strategiesApplied: [], cashbackUsed: 0, total: 50, cashbackEarned: 0, payment: { code: "CASH" }, status: "created", statusHistory: [], createdAt: new Date().toISOString() } as never);
    await call("POST", "/admin/orders/ord_notif2/status", { status: "ready" }); // retirada: avisa que está pronto
    expect(fakeProviders(T).wa.sent.length).toBe(before + 1);
    expect(JSON.stringify(fakeProviders(T).wa.sent.at(-1))).toContain("pronto para retirada");
    // simulação recusada fora do provedor de teste
    await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "meta", phoneNumberId: "1", token: "t", appSecret: "a", verifyToken: "v" });
    expect((await call("POST", "/admin/messaging/whatsapp/simulate-scan")).status).toBe(422);
    // API oficial sem modelo aprovado para o aviso: não envia
    await db.put("orders", T, { id: "ord_notif3", displayId: "9003", storeId: store.id, customerId: cust.id, mode: "DELIVERY", lines: [], subtotal: 50, discount: 0, deliveryFee: 0, fees: [], strategiesApplied: [], cashbackUsed: 0, total: 50, cashbackEarned: 0, payment: { code: "CASH" }, status: "created", statusHistory: [], createdAt: new Date().toISOString() } as never);
    await call("POST", "/admin/orders/ord_notif3/status", { status: "confirmed" });
    expect((await db.list<any>("messages", T, { where: { ref: "pedido:ord_notif3" } })).length).toBe(0);
  });
});
