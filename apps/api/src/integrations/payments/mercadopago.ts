import type { OnlinePaymentStatus } from "@cw/core";
import { PaymentError, hmacHex, isoBrt, onlyDigits, readJson, safeEqual, type Gateway, type PaymentsConfig, type Fetch } from "./types";

/**
 * Mercado Pago — API de Pagamentos (v1/payments).
 * Pix: payment_method_id "pix" devolve point_of_interaction.transaction_data.{qr_code, qr_code_base64}.
 * Cartão: o navegador gera o token com MercadoPago.js v2; aqui só recebemos o token.
 * Webhook: x-signature "ts=…,v1=…" com HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 * (data.id cru da query string, sem mudar maiúsculas; par ausente sai do manifesto). Status sempre reconsultado em GET /v1/payments/{id}.
 * X-Idempotency-Key obrigatório em POST /v1/payments e nos estornos. Pix: date_of_expiration entre 30 min e 30 dias.
 */
const base = (cfg: PaymentsConfig) => cfg.baseUrl || "https://api.mercadopago.com";
const headers = (cfg: PaymentsConfig, idem?: string) => ({ Authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json", ...(idem ? { "X-Idempotency-Key": idem } : {}) });

const MP_REASON: Record<string, string> = {
  cc_rejected_insufficient_amount: "Saldo ou limite insuficiente",
  cc_rejected_bad_filled_security_code: "Código de segurança inválido",
  cc_rejected_bad_filled_date: "Validade do cartão incorreta",
  cc_rejected_bad_filled_card_number: "Número do cartão incorreto",
  cc_rejected_bad_filled_other: "Confira os dados do cartão",
  cc_rejected_call_for_authorize: "O banco pediu autorização: ligue para o emissor",
  cc_rejected_card_disabled: "Cartão desabilitado: ligue para o emissor",
  cc_rejected_duplicated_payment: "Pagamento duplicado",
  cc_rejected_high_risk: "Pagamento recusado pela análise de risco",
  cc_rejected_max_attempts: "Limite de tentativas atingido",
  cc_rejected_blacklist: "Pagamento recusado",
  cc_rejected_other_reason: "Cartão recusado pelo banco emissor",
};
export function mpStatus(s: string): OnlinePaymentStatus {
  if (s === "approved") return "paid";
  if (s === "rejected") return "failed";
  if (s === "cancelled") return "expired";
  if (s === "refunded" || s === "charged_back") return "refunded";
  return "pending"; // pending, in_process, authorized, in_mediation
}
async function call(cfg: PaymentsConfig, http: Fetch, path: string, init: RequestInit) {
  const res = await http(base(cfg) + path, init);
  const body = await readJson(res);
  if (!res.ok) throw new PaymentError(res.status, (body as { message?: string }).message || `Mercado Pago HTTP ${res.status}`, body);
  return body as Record<string, unknown>;
}
const BRAND_TO_MP: Record<string, string> = { visa: "visa", mastercard: "master", master: "master", amex: "amex", elo: "elo", hipercard: "hipercard" };

export const mercadopago: Gateway = {
  id: "mercadopago",
  label: "Mercado Pago",
  supports: { pix: true, card: true },
  async createPix(c) {
    const exp = new Date(+c.now + Math.min(30 * 1440, Math.max(30, c.cfg.pixExpiresMinutes)) * 60e3); // o Mercado Pago aceita de 30 min a 30 dias
    const doc = onlyDigits(c.customer?.document);
    const body = {
      transaction_amount: c.order.total,
      description: c.description,
      payment_method_id: "pix",
      external_reference: c.order.id,
      notification_url: c.notificationUrl,
      date_of_expiration: isoBrt(exp),
      payer: {
        // o Mercado Pago exige e-mail do pagador; sem e-mail usamos um endereço técnico do pedido (conferir na doc se a conta aceita)
        email: c.customer?.email || `pedido-${c.order.id.toLowerCase()}@cardapio.superapp.com.br`,
        first_name: (c.customer?.name || "Cliente").split(" ")[0],
        ...(doc.length === 11 ? { identification: { type: "CPF", number: doc } } : {}),
      },
    };
    const r = await call(c.cfg, c.http, "/v1/payments", { method: "POST", headers: headers(c.cfg, `${c.order.id}:pix:${+c.now}`), body: JSON.stringify(body) });
    const td = (r.point_of_interaction as { transaction_data?: { qr_code?: string; qr_code_base64?: string } })?.transaction_data || {};
    if (!td.qr_code) throw new PaymentError(502, "Mercado Pago não devolveu o QR code do Pix", r);
    return { chargeId: String(r.id), qrText: td.qr_code, qrImage: td.qr_code_base64 ? `data:image/png;base64,${td.qr_code_base64}` : undefined, expiresAt: exp.toISOString(), raw: r };
  },
  async createCard(c, card) {
    const doc = onlyDigits(c.customer?.document);
    const body = {
      transaction_amount: c.order.total,
      token: card.token,
      installments: card.installments,
      payment_method_id: BRAND_TO_MP[(card.brand || "").toLowerCase()] || card.brand,
      ...(card.issuerId ? { issuer_id: card.issuerId } : {}),
      description: c.description,
      external_reference: c.order.id,
      notification_url: c.notificationUrl,
      statement_descriptor: c.cfg.softDescriptor,
      payer: { email: c.customer?.email || `pedido-${c.order.id.toLowerCase()}@cardapio.superapp.com.br`, ...(doc.length === 11 ? { identification: { type: "CPF", number: doc } } : {}) },
    };
    const r = await call(c.cfg, c.http, "/v1/payments", { method: "POST", headers: headers(c.cfg, `${c.order.id}:card:${card.token.slice(-12)}`), body: JSON.stringify(body) });
    const st = mpStatus(String(r.status));
    const cd = (r.card as { last_four_digits?: string }) || {};
    return { chargeId: String(r.id), status: st === "paid" ? "paid" : st === "failed" ? "failed" : "pending", brand: String(r.payment_method_id || card.brand || ""), last4: cd.last_four_digits || card.last4, failureReason: st === "failed" ? MP_REASON[String(r.status_detail)] || "Cartão recusado" : undefined, raw: r };
  },
  async status(cfg, http, id) {
    const r = await call(cfg, http, `/v1/payments/${encodeURIComponent(id)}`, { method: "GET", headers: headers(cfg) });
    return mpStatus(String(r.status));
  },
  async refund(cfg, http, id, amount) {
    await call(cfg, http, `/v1/payments/${encodeURIComponent(id)}/refunds`, { method: "POST", headers: headers(cfg, `refund:${id}:${amount ?? "total"}`), ...(amount ? { body: JSON.stringify({ amount }) } : {}) });
  },
  async parseWebhook(req, cfg, http) {
    let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
    try { body = JSON.parse(req.body || "{}"); } catch { /* corpo vazio */ }
    const type = body.type || req.query.type || req.query.topic;
    const qid = req.query["data.id"]; // a assinatura usa o data.id cru da query string
    const dataId = String(qid ?? body.data?.id ?? req.query.id ?? "");
    if (!dataId || (type && type !== "payment")) return null;
    if (cfg.webhookSecret) {
      const sig = req.headers["x-signature"] || "";
      const parts = Object.fromEntries(sig.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
      const rid = req.headers["x-request-id"];
      const manifest = `${qid ? `id:${qid};` : ""}${rid ? `request-id:${rid};` : ""}ts:${parts.ts || ""};`;
      if (!parts.v1 || !safeEqual(await hmacHex(cfg.webhookSecret, manifest), parts.v1)) throw new PaymentError(401, "Assinatura do Mercado Pago inválida");
    }
    return { chargeId: dataId, status: await this.status(cfg, http, dataId) }; // a notificação só traz o id: consultamos o status
  },
  async test(cfg, http) {
    if (!cfg.accessToken) throw new PaymentError(422, "Informe o Access Token");
    await call(cfg, http, "/v1/payment_methods", { method: "GET", headers: headers(cfg) });
    return `Conectado ao Mercado Pago (${cfg.accessToken.startsWith("TEST-") ? "teste" : "produção"})`;
  },
  publicConfig(cfg) {
    return { gateway: "mercadopago", env: cfg.env, methods: cfg.methods, maxInstallments: cfg.maxInstallments, publicKey: cfg.publicKey, sdkUrl: "https://sdk.mercadopago.com/js/v2", requiresDocument: cfg.methods.card };
  },
};
