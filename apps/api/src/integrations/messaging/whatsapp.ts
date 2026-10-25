import { ProviderError, readJson, type Fetch, type SendResult, type WhatsAppConfig } from "./types";

export type WaPayload =
  | { kind: "template"; name: string; language: string; bodyParams: string[]; headerImage?: string; /** texto já preenchido, usado pelos provedores por QR code */ text?: string }
  | { kind: "otp"; name: string; language: string; code: string }
  | { kind: "text"; body: string };

export interface WhatsAppProvider { send(to: string, p: WaPayload): Promise<SendResult> }

/** Provedor conectado por QR code: o número do lojista vira um "WhatsApp Web" controlado pela API. */
export interface QrProvider extends WhatsAppProvider {
  /** pede o QR (ou o código de pareamento) para escanear; já conectado devolve connected */
  connect(): Promise<{ connected: boolean; qr?: string; pairingCode?: string }>;
  status(): Promise<{ connected: boolean; phone?: string }>;
  disconnect(): Promise<void>;
  /** aponta os avisos de mensagens recebidas para a nossa URL */
  setWebhook(url: string): Promise<void>;
}

/** Texto puro de qualquer payload (QR code não tem modelo aprovado: o modelo vira texto). */
export function plainText(p: WaPayload) {
  if (p.kind === "text") return p.body;
  if (p.kind === "otp") return `Seu código de acesso é ${p.code}. Não compartilhe com ninguém.`;
  return p.text || p.bodyParams.join(" ");
}
const digits = (s: string) => s.replace(/\D/g, "");
const asDataUrl = (v?: string) => (!v ? undefined : v.startsWith("data:") ? v : `data:image/png;base64,${v}`);

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

/**
 * Z-API (z-api.io): instância paga por número, conectada por QR code.
 * ATENÇÃO: formatos conferidos pela documentação pública; validar com credenciais reais antes de produção.
 */
export class ZApiWhatsApp implements QrProvider {
  constructor(private cfg: NonNullable<WhatsAppConfig["zapi"]>, private http: Fetch = fetch) {}
  private url(path: string) { return `${(this.cfg.baseUrl || "https://api.z-api.io").replace(/\/$/, "")}/instances/${this.cfg.instanceId}/token/${this.cfg.instanceToken}/${path}`; }
  private async call(path: string, init: RequestInit = {}) {
    const res = await this.http(this.url(path), { ...init, headers: { "content-type": "application/json", ...(this.cfg.clientToken ? { "Client-Token": this.cfg.clientToken } : {}), ...(init.headers || {}) } });
    const j = (await readJson(res)) as Record<string, unknown>;
    if (!res.ok || j.error) throw new ProviderError(res.status, String(j.message || j.error || `Z-API HTTP ${res.status}`), j);
    return j;
  }
  async send(to: string, p: WaPayload): Promise<SendResult> {
    const j = await this.call("send-text", { method: "POST", body: JSON.stringify({ phone: digits(to), message: plainText(p) }) });
    const id = String(j.messageId || j.id || j.zaapId || "");
    if (!id) throw new ProviderError(502, "Z-API não devolveu o id da mensagem", j);
    return { providerId: id, status: "sent" };
  }
  async status() { const j = await this.call("status"); return { connected: !!j.connected, phone: (j.phone as string) || undefined }; }
  async connect() {
    const st = await this.status();
    if (st.connected) return { connected: true };
    const j = await this.call("qr-code/image");
    return { connected: false, qr: asDataUrl(j.value as string) };
  }
  async disconnect() { await this.call("disconnect"); }
  async setWebhook(url: string) { await this.call("update-webhook-received", { method: "PUT", body: JSON.stringify({ value: url }) }); }
}

/**
 * Evolution API v2 (código aberto, hospedada pela marca ou pela agência). Conexão Baileys por QR code.
 * ATENÇÃO: formatos conferidos pela documentação pública da v2; validar com uma instância real antes de produção.
 */
export class EvolutionWhatsApp implements QrProvider {
  constructor(private cfg: NonNullable<WhatsAppConfig["evolution"]>, private http: Fetch = fetch) {}
  private base() { return this.cfg.baseUrl.replace(/\/$/, ""); }
  private async call(path: string, init: RequestInit = {}, okStatus: number[] = []) {
    const res = await this.http(`${this.base()}/${path}`, { ...init, headers: { "content-type": "application/json", apikey: this.cfg.apiKey, ...(init.headers || {}) } });
    const j = (await readJson(res)) as Record<string, unknown>;
    if (!res.ok && !okStatus.includes(res.status)) throw new ProviderError(res.status, String((j.response as { message?: unknown })?.message || j.message || j.error || `Evolution HTTP ${res.status}`), j);
    return { status: res.status, j };
  }
  async send(to: string, p: WaPayload): Promise<SendResult> {
    const { j } = await this.call(`message/sendText/${encodeURIComponent(this.cfg.instance)}`, { method: "POST", body: JSON.stringify({ number: digits(to), text: plainText(p) }) });
    const id = (j.key as { id?: string })?.id;
    if (!id) throw new ProviderError(502, "Evolution não devolveu o id da mensagem", j);
    return { providerId: id, status: "sent" };
  }
  async status() {
    const { status, j } = await this.call(`instance/connectionState/${encodeURIComponent(this.cfg.instance)}`, {}, [404]);
    if (status === 404) return { connected: false };
    const inst = (j.instance || j) as { state?: string; owner?: string; ownerJid?: string };
    const owner = inst.ownerJid || inst.owner;
    return { connected: inst.state === "open", phone: owner ? digits(owner.split("@")[0]) : undefined };
  }
  async connect() {
    let r = await this.call(`instance/connect/${encodeURIComponent(this.cfg.instance)}`, {}, [404]);
    if (r.status === 404) { // instância ainda não existe: cria já pedindo o QR
      const c = await this.call("instance/create", { method: "POST", body: JSON.stringify({ instanceName: this.cfg.instance, integration: "WHATSAPP-BAILEYS", qrcode: true }) });
      const qr = (c.j.qrcode || {}) as { base64?: string; pairingCode?: string };
      if (qr.base64) return { connected: false, qr: asDataUrl(qr.base64), pairingCode: qr.pairingCode || undefined };
      r = await this.call(`instance/connect/${encodeURIComponent(this.cfg.instance)}`);
    }
    const j = r.j as { base64?: string; code?: string; pairingCode?: string; instance?: { state?: string } };
    if (j.instance?.state === "open") return { connected: true };
    if (!j.base64 && !j.pairingCode) return { connected: (await this.status()).connected };
    return { connected: false, qr: asDataUrl(j.base64), pairingCode: j.pairingCode || undefined };
  }
  async disconnect() { await this.call(`instance/logout/${encodeURIComponent(this.cfg.instance)}`, { method: "DELETE" }); }
  async setWebhook(url: string) {
    await this.call(`webhook/set/${encodeURIComponent(this.cfg.instance)}`, { method: "POST", body: JSON.stringify({ webhook: { enabled: true, url, byEvents: false, base64: false, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"] } }) });
  }
}

/** QR de mentira (SVG) para treinar a equipe e mostrar a conexão na demonstração. */
export function fakeQrSvg(seed: string) {
  let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const n = 25, cell = 8; let rects = "";
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on: boolean;
    if (finder(x, y)) { const fx = x >= n - 7 ? x - (n - 7) : x, fy = y >= n - 7 ? y - (n - 7) : y; on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4); }
    else { h = Math.imul(h ^ (x * 31 + y), 16777619); on = ((h >>> 0) & 3) === 0 || ((h >>> 0) % 7) === 1; }
    if (on) rects += `<rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${cell}" height="${cell}"/>`;
  }
  const size = (n + 4) * cell;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">${rects}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
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
