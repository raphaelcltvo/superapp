import type { OnlinePaymentStatus } from "@cw/core";
import { PaymentError, onlyDigits, readJson, safeEqual, type Gateway, type PaymentsConfig, type Fetch } from "./types";

/**
 * Asaas v3 — só Pix aqui (cartão no Asaas exige trafegar dados do cartão pelo servidor ou o checkout deles).
 * Cliente (CPF obrigatório) → cobrança PIX → GET /payments/{id}/pixQrCode {encodedImage, payload}.
 * Webhook: token secreto na URL; header asaas-access-token conferido quando o authToken foi cadastrado no Asaas.
 * Entrega pelo menos uma vez (pode repetir evt_…): o status é reconsultado na API e a baixa do pedido é idempotente.
 * Contas criadas desde 13/06/2024 exigem User-Agent.
 */
const base = (cfg: PaymentsConfig) => cfg.baseUrl || (cfg.env === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3"); // conferir na doc: URL do sandbox
async function call(cfg: PaymentsConfig, http: Fetch, path: string, init: RequestInit) {
  const res = await http(base(cfg) + path, { ...init, headers: { access_token: cfg.apiKey || "", "content-type": "application/json", "User-Agent": "superapp-cardapio", ...(init.headers || {}) } });
  const body = await readJson(res);
  if (!res.ok) throw new PaymentError(res.status, (body as { errors?: { description: string }[] }).errors?.[0]?.description || `Asaas HTTP ${res.status}`, body);
  return body as Record<string, unknown>;
}
export function asStatus(s: string): OnlinePaymentStatus {
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(s)) return "paid";
  if (["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE"].includes(s)) return "refunded";
  if (["OVERDUE", "DELETED"].includes(s)) return "expired";
  return "pending";
}

export const asaas: Gateway = {
  id: "asaas",
  label: "Asaas",
  supports: { pix: true, card: false },
  async createPix(c) {
    const doc = onlyDigits(c.customer?.document);
    if (doc.length !== 11 && doc.length !== 14) throw new PaymentError(422, "Para pagar com Pix pelo Asaas, informe o CPF");
    const cust = await call(c.cfg, c.http, "/customers", { method: "POST", body: JSON.stringify({ name: c.customer?.name || "Cliente", cpfCnpj: doc, mobilePhone: onlyDigits(c.customer?.phone).replace(/^55(?=\d{10,11}$)/, ""), email: c.customer?.email, externalReference: c.customer?.id, notificationDisabled: true }) });
    const pay = await call(c.cfg, c.http, "/payments", { method: "POST", body: JSON.stringify({ customer: cust.id, billingType: "PIX", value: c.order.total, dueDate: c.now.toISOString().slice(0, 10), description: c.description, externalReference: c.order.id }) });
    const qr = await call(c.cfg, c.http, `/payments/${pay.id}/pixQrCode`, { method: "GET" });
    // o QR do Asaas vale mais tempo; o cardápio impõe a própria validade e cancela a cobrança ao vencer
    return { chargeId: String(pay.id), qrText: String(qr.payload), qrImage: qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : undefined, expiresAt: new Date(+c.now + c.cfg.pixExpiresMinutes * 60e3).toISOString(), raw: { pay, qr } };
  },
  async createCard() { throw new PaymentError(422, "Cartão online não está disponível com o Asaas nesta versão. Use Pix ou outro gateway."); },
  async status(cfg, http, id) { return asStatus(String((await call(cfg, http, `/payments/${encodeURIComponent(id)}`, { method: "GET" })).status)); },
  async refund(cfg, http, id, amount) { await call(cfg, http, `/payments/${encodeURIComponent(id)}/refund`, { method: "POST", body: JSON.stringify(amount ? { value: amount } : {}) }); },
  async parseWebhook(req, cfg, http) {
    if (cfg.webhookSecret && !safeEqual(req.headers["asaas-access-token"] || "", cfg.webhookSecret)) throw new PaymentError(401, "Token do webhook Asaas inválido");
    let b: { id?: string; event?: string; payment?: { id?: string; status?: string } } = {};
    try { b = JSON.parse(req.body || "{}"); } catch { return null; }
    if (!b.payment?.id || !b.event?.startsWith("PAYMENT_")) return null;
    return { chargeId: b.payment.id, status: await this.status(cfg, http, b.payment.id) }; // PAYMENT_PARTIALLY_REFUNDED etc.: vale o status da API
  },
  async test(cfg, http) {
    if (!cfg.apiKey) throw new PaymentError(422, "Informe a chave de API");
    await call(cfg, http, "/customers?limit=1", { method: "GET" });
    return `Conectado ao Asaas (${cfg.env === "production" ? "produção" : "sandbox"})`;
  },
  publicConfig(cfg) { return { gateway: "asaas", env: cfg.env, methods: { pix: cfg.methods.pix, card: false }, maxInstallments: 1, requiresDocument: true }; },
};
