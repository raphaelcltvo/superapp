import type { OnlinePaymentStatus } from "@cw/core";
import { PaymentError, cents, onlyDigits, phoneParts, readJson, safeEqual, type Gateway, type PaymentsConfig, type Fetch, type ChargeCtx } from "./types";

/**
 * Pagar.me v5 (core/v5). Autenticação básica com a chave secreta (sk_) como usuário e senha vazia.
 * Pix e cartão via POST /orders; a cobrança (charge) é o que estornamos e o que os webhooks citam.
 * Cartão: o navegador cria o token em POST /core/v5/tokens?appId=<pk_> e só o token chega aqui.
 * Webhook: a Pagar.me não documenta assinatura. Autenticamos pelo token secreto na URL, opcionalmente pela autenticação
 * básica configurada no painel (conferir na doc se a conta oferece) e sempre reconsultamos GET /charges/{id} com a sk_.
 * Mesmo endereço base em teste e produção: a chave (sk_test_/sk_) decide. /tokens só leva Content-Type e exige domínio cadastrado.
 */
const base = (cfg: PaymentsConfig) => cfg.baseUrl || "https://api.pagar.me/core/v5";
const auth = (cfg: PaymentsConfig) => "Basic " + btoa(`${cfg.secretKey || ""}:`);
async function call(cfg: PaymentsConfig, http: Fetch, path: string, init: RequestInit) {
  const res = await http(base(cfg) + path, { ...init, headers: { Authorization: auth(cfg), "content-type": "application/json", accept: "application/json", ...(init.headers || {}) } });
  const body = await readJson(res);
  if (!res.ok) {
    const b = body as { message?: string; errors?: Record<string, string[]> };
    const detail = b.errors ? Object.values(b.errors).flat()[0] : undefined;
    throw new PaymentError(res.status, [b.message, detail].filter(Boolean).join(": ") || `Pagar.me HTTP ${res.status}`, body);
  }
  return body as Record<string, unknown>;
}
export function pgStatus(s: string): OnlinePaymentStatus {
  if (s === "paid") return "paid";
  if (s === "failed" || s === "not_authorized") return "failed";
  if (s === "canceled" || s === "refunded" || s === "chargedback") return "refunded";
  return "pending"; // pending, processing, waiting_payment, authorized_pending_capture
}
function customer(c: ChargeCtx) {
  const doc = onlyDigits(c.customer?.document);
  return {
    name: c.customer?.name || "Cliente",
    email: c.customer?.email || `pedido-${c.order.id.toLowerCase()}@cardapio.superapp.com.br`,
    type: doc.length === 14 ? "company" : "individual",
    ...(doc ? { document: doc, document_type: doc.length === 14 ? "CNPJ" : "CPF" } : {}),
    phones: { mobile_phone: phoneParts(c.customer?.phone) },
  };
}
/** Um item com o total do pedido: descontos, frete e taxas já estão no total (evita divergência de centavos). */
const items = (c: ChargeCtx) => [{ amount: cents(c.order.total), description: c.description, quantity: 1, code: c.order.id }];
type Charge = { id: string; status: string; last_transaction?: { status?: string; qr_code?: string; qr_code_url?: string; expires_at?: string; card?: { brand?: string; last_four_digits?: string }; acquirer_message?: string; gateway_response?: { errors?: { message: string }[] } } };

export const pagarme: Gateway = {
  id: "pagarme",
  label: "Pagar.me",
  supports: { pix: true, card: true },
  async createPix(c) {
    const r = await call(c.cfg, c.http, "/orders", { method: "POST", headers: { "Idempotency-Key": `${c.order.id}:pix:${+c.now}` }, body: JSON.stringify({ code: c.order.displayId, items: items(c), customer: customer(c), payments: [{ payment_method: "pix", pix: { expires_in: c.cfg.pixExpiresMinutes * 60 } }], metadata: { order_id: c.order.id } }) });
    const ch = (r.charges as Charge[] | undefined)?.[0];
    const lt = ch?.last_transaction;
    if (!ch || !lt?.qr_code) throw new PaymentError(502, (lt?.gateway_response?.errors?.[0]?.message) || "Pagar.me não devolveu o QR code do Pix (confira se a conta tem Pix habilitado e se o CPF foi informado)", r);
    return { chargeId: ch.id, qrText: lt.qr_code, qrImage: lt.qr_code_url, expiresAt: lt.expires_at || new Date(+c.now + c.cfg.pixExpiresMinutes * 60e3).toISOString(), raw: r };
  },
  async createCard(c, card) {
    const addr = c.order.address;
    const billing = addr ? { line_1: `${addr.number}, ${addr.street}, ${addr.district}`, line_2: addr.complement, zip_code: onlyDigits(addr.postalCode), city: addr.city, state: addr.state, country: "BR" } : undefined;
    const r = await call(c.cfg, c.http, "/orders", { method: "POST", headers: { "Idempotency-Key": `${c.order.id}:card:${card.token.slice(-12)}` }, body: JSON.stringify({ code: c.order.displayId, items: items(c), customer: customer(c), payments: [{ payment_method: "credit_card", credit_card: { installments: card.installments, statement_descriptor: (c.cfg.softDescriptor || "").slice(0, 13) || undefined, card_token: card.token, ...(billing ? { card: { billing_address: billing } } : {}) } }], metadata: { order_id: c.order.id } }) });
    const ch = (r.charges as Charge[] | undefined)?.[0];
    if (!ch) throw new PaymentError(502, "Pagar.me não devolveu a cobrança", r);
    const st = pgStatus(ch.status);
    const lt = ch.last_transaction || {};
    return { chargeId: ch.id, status: st === "paid" ? "paid" : st === "failed" || st === "refunded" ? "failed" : "pending", brand: lt.card?.brand || card.brand, last4: lt.card?.last_four_digits || card.last4, failureReason: st === "failed" ? lt.acquirer_message || lt.gateway_response?.errors?.[0]?.message || "Cartão recusado" : undefined, raw: r };
  },
  async status(cfg, http, id) { return pgStatus(String((await call(cfg, http, `/charges/${encodeURIComponent(id)}`, { method: "GET" })).status)); },
  async refund(cfg, http, id, amount) { await call(cfg, http, `/charges/${encodeURIComponent(id)}`, { method: "DELETE", ...(amount ? { body: JSON.stringify({ amount: cents(amount) }) } : {}) }); },
  async parseWebhook(req, cfg, http) {
    if (cfg.webhookSecret) {
      const expected = "Basic " + btoa(cfg.webhookSecret);
      if (!safeEqual(req.headers.authorization || "", expected)) throw new PaymentError(401, "Autenticação do webhook Pagar.me inválida");
    }
    let b: { type?: string; data?: { id?: string; status?: string; charges?: Charge[]; object?: string } } = {};
    try { b = JSON.parse(req.body || "{}"); } catch { return null; }
    const t = b.type || "";
    const chargeId = t.startsWith("charge.") ? b.data?.id : t.startsWith("order.") ? b.data?.charges?.[0]?.id : undefined;
    if (!chargeId) return null;
    return { chargeId, status: await this.status(cfg, http, chargeId) }; // confirma na API em vez de confiar só no corpo
  },
  async test(cfg, http) {
    if (!cfg.secretKey) throw new PaymentError(422, "Informe a chave secreta (sk_)");
    await call(cfg, http, "/customers?size=1", { method: "GET" });
    return `Conectado ao Pagar.me (${cfg.secretKey.startsWith("sk_test") ? "teste" : "produção"})`;
  },
  publicConfig(cfg) {
    return { gateway: "pagarme", env: cfg.env, methods: cfg.methods, maxInstallments: cfg.maxInstallments, publicKey: cfg.publicKey, tokenizeUrl: `${cfg.baseUrl || "https://api.pagar.me/core/v5"}/tokens?appId=${encodeURIComponent(cfg.publicKey || "")}`, requiresDocument: true };
  },
};
