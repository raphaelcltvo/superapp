export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Provedores de WhatsApp: API oficial (Meta), conexão por QR code (Z-API, Evolution API) e teste. */
export type WaProviderId = "meta" | "zapi" | "evolution" | "fake";
export const QR_PROVIDERS: WaProviderId[] = ["zapi", "evolution"];
export const isQrProvider = (p?: string) => p === "zapi" || p === "evolution";

/** Configuração do WhatsApp por marca. Os campos da Meta só valem com provider "meta". */
export interface WhatsAppConfig {
  enabled: boolean;
  provider: WaProviderId;
  /* ---- Meta Cloud API ---- */
  phoneNumberId?: string;
  wabaId?: string;
  token?: string; // token permanente do usuário de sistema
  appSecret?: string; // valida a assinatura X-Hub-Signature-256
  verifyToken?: string; // usado na verificação do webhook (hub.verify_token)
  graphVersion?: string; // padrão v26.0 (vigente em out/2026)
  otpTemplate?: { name: string; language: string };
  costPerMessage?: number; // R$ estimado por conversa de marketing (relatórios)
  /* ---- QR code ---- */
  zapi?: { instanceId: string; instanceToken: string; clientToken?: string; baseUrl?: string };
  evolution?: { baseUrl: string; apiKey: string; instance: string };
  /** ?token= na URL do webhook dos provedores por QR code */
  webhookToken?: string;
  /** teto diário de mensagens de campanha pelo QR code (reduz risco de bloqueio do número) */
  dailyCap?: number;
  /** mensagens de campanha por rodada do agendador no QR code */
  perTick?: number;
}

/** Estado da conexão por QR code (guardado junto da configuração). */
export interface WaConnState { connected: boolean; phone?: string; connectedAt?: string; checkedAt?: string; scanned?: boolean }

export interface EmailConfig {
  enabled: boolean;
  provider: "resend" | "brevo" | "fake";
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  webhookToken?: string; // ?token= na URL de eventos do provedor
}

export interface SendResult { providerId: string; status: "sent" | "queued" | "failed"; error?: string }

export class ProviderError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export async function readJson(res: Response) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : {}; } catch { return { raw: t }; }
}
