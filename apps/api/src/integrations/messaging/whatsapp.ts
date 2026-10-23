import { ProviderError, readJson, type Fetch, type SendResult, type WhatsAppConfig } from "./types";

export type WaPayload =
  | { kind: "template"; name: string; language: string; bodyParams: string[]; headerImage?: string }
  | { kind: "otp"; name: string; language: string; code: string }
  | { kind: "text"; body: string };

export interface WhatsAppProvider { send(to: string, p: WaPayload): Promise<SendResult> }

/** Corpo do POST /{phone-number-id}/messages da Cloud API. */
export function waBody(to: string, p: WaPayload) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (p.kind === "text") return { ...base, type: "text", text: { body: p.body, preview_url: true } };
  if (p.kind === "otp") // modelo de autenticação com botão "copiar código" (código até 15 caracteres)
    return { ...base, type: "template", template: { name: p.name, language: { code: p.language }, components: [
      { type: "body", parameters: [{ type: "text", text: p.code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: p.code }] },
    ] } };
  const components: unknown[] = [];
  if (p.headerImage) components.push({ type: "header", parameters: [{ type: "image", image: { link: p.headerImage } }] });
  if (p.bodyParams.length) components.push({ type: "body", parameters: p.bodyParams.map((text) => ({ type: "text", text })) });
  return { ...base, type: "template", template: { name: p.name, language: { code: p.language }, components } };
}

export class MetaWhatsApp implements WhatsAppProvider {
  constructor(private cfg: WhatsAppConfig, private http: Fetch = fetch) {}
  async send(to: string, p: WaPayload): Promise<SendResult> {
    const v = this.cfg.graphVersion || "v26.0";
    const res = await this.http(`https://graph.facebook.com/${v}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json" }, body: JSON.stringify(waBody(to, p)),
    });
    const j = (await readJson(res)) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok || !j.messages?.[0]?.id) throw new ProviderError(res.status, j.error?.message || `WhatsApp HTTP ${res.status}`, j);
    return { providerId: j.messages[0].id, status: "sent" };
  }
}

/** Provedor de teste: registra e devolve um id. Os status (entregue/lido) são simulados pelo serviço. */
export class FakeWhatsApp implements WhatsAppProvider {
  sent: { to: string; body: unknown }[] = [];
  async send(to: string, p: WaPayload): Promise<SendResult> {
    this.sent.push({ to, body: waBody(to, p) });
    return { providerId: "wamid.fake." + crypto.randomUUID().slice(0, 12), status: "sent" };
  }
}

/** Assinatura do webhook da Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo cru, App Secret) em hex. */
export async function verifyMetaSignature(appSecret: string, raw: string, header?: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const got = header.slice(7).toLowerCase();
  if (got.length !== hex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export interface MetaWebhook {
  entry?: { changes?: { value?: {
    statuses?: { id: string; status: "sent" | "delivered" | "read" | "played" | "failed"; recipient_id: string; timestamp?: string; errors?: { title?: string; message?: string }[] }[];
    messages?: { from: string; id: string; timestamp?: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }[];
    contacts?: { wa_id: string; profile?: { name?: string } }[];
  } }[] }[];
}
