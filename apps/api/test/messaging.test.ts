import { describe, it, expect, beforeAll } from "vitest";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { dataUrlStorage, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import { fakeProviders } from "../src/services/messaging";
import type { Db } from "../src/db/types";

const T = "ten_forneria";
async function sign(secret: string, raw: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("Mensagens: WhatsApp e e-mail", () => {
  let app: ReturnType<typeof createApp>; let db: Db; let admin = "";
  const calls: { url: string; init: RequestInit }[] = [];
  const legacy: string[] = [];
  const mockFetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes("graph.facebook.com")) return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "1" }], messages: [{ id: "wamid.TESTE" + calls.length }] }), { status: 200 });
    if (url.includes("api.resend.com")) return new Response(JSON.stringify({ id: "re_" + calls.length }), { status: 200 });
    if (url.includes("api.brevo.com")) return new Response(JSON.stringify({ messageId: "<br" + calls.length + "@smtp>" }), { status: 201 });
    return new Response("{}", { status: 404 });
  };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(admin ? { authorization: "Bearer " + admin } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), redirect: "manual" });
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* texto */ }
    return { status: r.status, body: json, text, headers: r.headers };
  };
  beforeAll(async () => {
    db = memoryDb();
    const deps: Deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: { async send(_t, to, text) { legacy.push(to + ":" + text); return { id: "x", status: "sent" }; } }, sendOtp: async () => {}, demo: true, publicUrl: "https://api.test", messagingFetch: mockFetch, cronSecret: "cron123" };
    app = createApp(deps);
    await seedForneria(db, { photo: () => undefined, media: { cover: "https://img.test/capa.jpg", poster: "https://img.test/poster.jpg" }, history: true });
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    await call("POST", "/admin/publish", {});
  }, 60000);

  it("configura canais e mascara segredos", async () => {
    expect((await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "meta", phoneNumberId: "1099", token: "EAAtoken1234", appSecret: "appsecret99", verifyToken: "verifica", otpTemplate: { name: "codigo_acesso", language: "pt_BR" } })).status).toBe(200);
    expect((await call("PUT", "/admin/messaging/config/email", { enabled: true, provider: "resend", apiKey: "re_chave_5678", fromName: "Forneria", fromEmail: "oi@forneria.com.br" })).status).toBe(200);
    const cfg = (await call("GET", "/admin/messaging/config")).body;
    expect(cfg.whatsapp.token).toBe("••••1234"); expect(cfg.email.apiKey).toBe("••••5678");
    // salvar de novo com o valor mascarado mantém o segredo original
    await call("PUT", "/admin/messaging/config/whatsapp", { ...cfg.whatsapp, enabled: true });
    expect((await db.get<any>("integrations", T, "whatsapp")).config.token).toBe("EAAtoken1234");
  });

  it("webhook da Meta: verificação, assinatura, status e descadastro por palavra-chave", async () => {
    admin = "";
    expect((await call("GET", "/webhooks/whatsapp/forneria-original?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=42")).text).toBe("42");
    expect((await call("GET", "/webhooks/whatsapp/forneria-original?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42")).status).toBe(403);
    // uma mensagem enviada para receber status
    const cust = (await db.list<any>("customers", T)).find((c) => c.optinWhatsapp && c.phone);
    await db.put("messages", T, { id: "msg_x", channel: "whatsapp", customerId: cust.id, ref: "t", group: "envio", text: "oi", status: "sent", providerId: "wamid.ABC", createdAt: new Date().toISOString() });
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      statuses: [{ id: "wamid.ABC", status: "delivered", recipient_id: cust.phone, timestamp: String(Math.floor(Date.now() / 1000)) }, { id: "wamid.ABC", status: "read", recipient_id: cust.phone }],
      contacts: [{ wa_id: cust.phone, profile: { name: "Cliente" } }],
      messages: [{ from: cust.phone, id: "wamid.IN1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "PARAR" } }],
    } }] }] });
    expect((await call("POST", "/webhooks/whatsapp/forneria-original", payload, { "x-hub-signature-256": "sha256=00" })).status).toBe(401);
    const r = await call("POST", "/webhooks/whatsapp/forneria-original", payload, { "x-hub-signature-256": await sign("appsecret99", payload) });
    expect(r.body).toEqual({ statuses: 2, inbound: 1, optouts: 1 });
    const m = await db.get<any>("messages", T, "msg_x");
    expect(m.status).toBe("read"); expect(m.deliveredAt).toBeTruthy();
    // a Meta reenvia o mesmo aviso: nada é contado de novo
    const again = await call("POST", "/webhooks/whatsapp/forneria-original", payload, { "x-hub-signature-256": await sign("appsecret99", payload) });
    expect(again.body.inbound).toBe(0); expect(again.body.optouts).toBe(0);
    expect((await db.get<any>("messages", T, "msg_x")).events.length).toBe(m.events.length);
    expect((await db.get<any>("customers", T, cust.id)).optinWhatsapp).toBe(false);
  });

  it("formatos de envio: modelo da Cloud API, Resend e Brevo", async () => {
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    calls.length = 0;
    expect((await call("POST", "/admin/messaging/test", { channel: "whatsapp", to: "5521999990000", templateId: "tpl_wa_2pedido" })).body.ok).toBe(true);
    const wa = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://graph.facebook.com/v26.0/1099/messages");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer EAAtoken1234");
    expect(wa).toMatchObject({ messaging_product: "whatsapp", type: "template", template: { name: "segundo_pedido", language: { code: "pt_BR" } } });
    expect(wa.template.components[0].parameters.map((p: any) => p.text)).toEqual(["Teste", "Forneria Original", "TESTE10", "https://api.test/forneria-original"]);
    calls.length = 0;
    expect((await call("POST", "/admin/messaging/test", { channel: "email", to: "ana@exemplo.com.br", templateId: "tpl_em_bf" })).body.ok).toBe(true);
    const re = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(re.from).toBe("Forneria <oi@forneria.com.br>"); expect(re.to).toEqual(["ana@exemplo.com.br"]);
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(re.tags.every((t: any) => /^[A-Za-z0-9_-]+$/.test(t.name) && /^[A-Za-z0-9_-]+$/.test(t.value))).toBe(true);
    expect(re.subject).toContain("Black Friday"); expect(re.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(re.html).toContain("/t/o/"); expect(re.html).toContain("FRETEZAP");
    await call("PUT", "/admin/messaging/config/email", { enabled: true, provider: "brevo", apiKey: "xkeysib-1", fromName: "Forneria", fromEmail: "oi@forneria.com.br" });
    calls.length = 0;
    await call("POST", "/admin/messaging/test", { channel: "email", to: "ana@exemplo.com.br", templateId: "tpl_em_bf" });
    const br = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-1");
    expect(br).toMatchObject({ sender: { name: "Forneria", email: "oi@forneria.com.br" }, to: [{ email: "ana@exemplo.com.br" }] });
  });

  it("OTP sai pelo modelo de autenticação com botão de copiar", async () => {
    admin = ""; calls.length = 0;
    await call("POST", "/public/forneria-original/auth/otp", { phone: "21 98888-1111" });
    const b = JSON.parse(String(calls[0].init.body));
    expect(b.template.name).toBe("codigo_acesso");
    expect(b.template.components[1]).toMatchObject({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "1234" }] });
  });

  it("campanha de e-mail: lotes, grupo de controle, abertura, clique protegido e descadastro", async () => {
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    await call("PUT", "/admin/messaging/config/email", { enabled: true, provider: "fake", apiKey: "x", fromName: "Forneria", fromEmail: "oi@forneria.com.br" });
    const camp = (await call("POST", "/admin/campaigns", { name: "Teste geral", channel: "email", templateId: "tpl_em_bf", couponId: "cup_frete", holdoutPercent: 20, maxPerCustomerPerWeek: 3, status: "draft" })).body;
    const aud = (await call("GET", "/admin/messaging/audience?channel=email")).body;
    expect(aud.reachable).toBeGreaterThan(50);
    const s = (await call("POST", `/admin/messaging/campaigns/${camp.id}/send`)).body;
    expect(s.done).toBe(true); expect(s.controle).toBeGreaterThan(0); expect(s.sent + s.controle).toBe(aud.reachable);
    expect((await call("POST", `/admin/messaging/campaigns/${camp.id}/send`)).body.sent).toBe(0); // idempotente
    const fakeMail = fakeProviders(T).email.sent.at(-1)!;
    const mid = fakeMail.html.match(/\/t\/o\/([^"]+)\.gif/)![1];
    const msgId = mid.split("~")[1];
    admin = "";
    expect((await call("GET", `/t/o/${mid}.gif`)).headers.get("content-type")).toBe("image/gif");
    expect((await call("GET", `/t/c/${mid}?u=${encodeURIComponent("https://malicioso.example")}`)).status).toBe(400);
    const link = (fakeMail.html.match(/\/t\/c\/[^"?]+\?u=([^"]+)/)![1]);
    const click = await call("GET", `/t/c/${mid}?u=${link}`);
    expect(click.status).toBe(302); expect(click.headers.get("location")).toContain("utm_campaign=" + camp.id);
    const m = await db.get<any>("messages", T, msgId);
    expect(m.openedAt).toBeTruthy(); expect(m.clickedAt).toBeTruthy();
    const unsub = fakeMail.headers!["List-Unsubscribe"].slice(1, -1).replace("https://api.test", "");
    expect((await call("POST", unsub)).status).toBe(200);
    expect((await db.get<any>("customers", T, m.customerId)).optinEmail).toBe(false);
    expect((await call("GET", "/t/u/token.falso")).status).toBe(400);
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
    const rep = (await call("GET", `/admin/messaging/campaigns/${camp.id}/report`)).body;
    expect(rep.envio).toBe(s.sent); expect(rep.controle).toBe(s.controle);
    expect(rep.delivered).toBeGreaterThan(0); expect(rep.read).toBeGreaterThan(0); expect(rep.lift).not.toBeNull();
  });

  it("automação com WhatsApp e reserva por e-mail; agendador protegido", async () => {
    await call("PUT", "/admin/messaging/config/whatsapp", { enabled: true, provider: "fake", phoneNumberId: "1", token: "t", appSecret: "s", verifyToken: "v" });
    const cs = await db.list<any>("customers", T);
    const old = (c: any) => c.orders === 1 && c.firstOrderAt && Date.now() - +new Date(c.firstOrderAt) > 8 * 864e5;
    const target = cs.find((c) => old(c) && c.optinEmail && !c.optinWhatsapp) || cs.find(old);
    await db.patch("customers", T, target.id, { optinWhatsapp: false, optinEmail: true, emailStatus: "valid" });
    await call("PUT", "/admin/automations/au_2pedido", { ...(await call("GET", "/admin/automations/au_2pedido")).body, channel: "whatsapp_then_email", emailTemplateId: "tpl_em_bf", holdoutPercent: 0, maxPerCustomerPerWeek: 5, quietHours: [0, 0] });
    admin = "";
    expect((await call("POST", "/cron/tick", {}, { "x-cron-secret": "errado" })).status).toBe(401);
    const tk = await call("POST", "/cron/tick", {}, { "x-cron-secret": "cron123" });
    expect(tk.status).toBe(200);
    const msgs = await db.list<any>("messages", T, { where: { automationId: "au_2pedido" } });
    expect(msgs.some((m) => m.channel === "whatsapp")).toBe(true);
    expect(msgs.find((m) => m.customerId === target.id)?.channel).toBe("email");
  });
});
