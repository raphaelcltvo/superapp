export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Configuração do WhatsApp Cloud API (Meta) por marca. */
export interface WhatsAppConfig {
  enabled: boolean;
  provider: "meta" | "fake";
  phoneNumberId: string;
  wabaId?: string;
  token: string; // token permanente do usuário de sistema
  appSecret: string; // valida a assinatura X-Hub-Signature-256
  verifyToken: string; // usado na verificação do webhook (hub.verify_token)
  graphVersion?: string; // padrão v26.0 (vigente em out/2026)
  otpTemplate?: { name: string; language: string };
  costPerMessage?: number; // R$ estimado por conversa de marketing (relatórios)
}

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
