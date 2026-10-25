import type { Customer, GatewayId, OnlinePaymentStatus, Order } from "@cw/core";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Configuração de pagamento online da marca (Integrações › Pagamentos). Segredos nunca voltam ao navegador. */
export interface PaymentsConfig {
  enabled: boolean;
  gateway: GatewayId;
  env: "sandbox" | "production";
  accessToken?: string; // Mercado Pago (APP_USR-... / TEST-...)
  publicKey?: string; // Mercado Pago public key ou Pagar.me pk_...
  secretKey?: string; // Pagar.me sk_...
  apiKey?: string; // Asaas $aact_...
  webhookSecret?: string; // MP: chave de assinatura · Asaas: token do webhook · Pagar.me: usuário:senha da autenticação básica (opcional)
  webhookToken: string; // gerado por nós, vai na URL do webhook (?token=)
  methods: { pix: boolean; card: boolean };
  pixExpiresMinutes: number;
  maxInstallments: number;
  softDescriptor?: string;
  captureOnlyIfStoreOpen?: boolean;
  baseUrl?: string; // sobrescreve a URL da API (testes/proxy)
  fakeAutoPaySeconds?: number; // gateway de teste: Pix se paga sozinho depois de N segundos
  /** senha + CPF + data de nascimento para pagar online (padrão: sim) */
  requirePassword?: boolean;
}

export const DEFAULT_PAYMENTS_CONFIG: Omit<PaymentsConfig, "webhookToken"> = {
  enabled: false, gateway: "fake", env: "sandbox", methods: { pix: true, card: false }, pixExpiresMinutes: 15, maxInstallments: 1,
};

export interface ChargeCtx {
  order: Order;
  customer: Customer | null;
  cfg: PaymentsConfig;
  http: Fetch;
  notificationUrl: string;
  now: Date;
  description: string;
}

export interface CardInput { token: string; installments: number; brand?: string; last4?: string; issuerId?: string }
export interface PixCharge { chargeId: string; qrText: string; qrImage?: string; expiresAt: string; raw?: unknown }
export interface CardCharge { chargeId: string; status: "paid" | "pending" | "failed"; brand?: string; last4?: string; failureReason?: string; raw?: unknown }
export interface WebhookInput { headers: Record<string, string>; body: string; query: Record<string, string> }

export interface PublicPaymentsConfig {
  gateway: GatewayId;
  env: "sandbox" | "production";
  methods: { pix: boolean; card: boolean };
  maxInstallments: number;
  publicKey?: string;
  sdkUrl?: string;
  tokenizeUrl?: string;
  requiresDocument: boolean; // gateway exige CPF do pagador
  /** o cliente confirma senha, CPF e data de nascimento antes de pagar online */
  requirePassword?: boolean;
}

export interface Gateway {
  id: GatewayId;
  label: string;
  supports: { pix: boolean; card: boolean };
  createPix(c: ChargeCtx): Promise<PixCharge>;
  createCard(c: ChargeCtx, card: CardInput): Promise<CardCharge>;
  status(cfg: PaymentsConfig, http: Fetch, chargeId: string): Promise<OnlinePaymentStatus>;
  refund(cfg: PaymentsConfig, http: Fetch, chargeId: string, amount?: number): Promise<void>;
  /** valida a origem (assinatura/token) e devolve a cobrança afetada; null = ignorar */
  parseWebhook(req: WebhookInput, cfg: PaymentsConfig, http: Fetch): Promise<{ chargeId: string; status: OnlinePaymentStatus } | null>;
  test(cfg: PaymentsConfig, http: Fetch): Promise<string>;
  publicConfig(cfg: PaymentsConfig): PublicPaymentsConfig;
}

export class PaymentError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export const cents = (v: number) => Math.round(v * 100);
export const onlyDigits = (s?: string) => (s || "").replace(/\D/g, "");
/** Telefone salvo como 55DDDNUMERO → partes. */
export function phoneParts(p?: string) {
  let d = onlyDigits(p);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  return { country_code: "55", area_code: d.slice(0, 2), number: d.slice(2) };
}
export async function readJson(res: Response) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : {}; } catch { return { raw: t }; }
}
const enc = new TextEncoder();
export async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Data no formato que o Mercado Pago aceita: 2026-10-23T11:00:00.000-03:00 */
export function isoBrt(d: Date) {
  const t = new Date(+d - 3 * 3600e3).toISOString().replace("Z", "");
  return `${t}-03:00`;
}
