import { ProviderError, readJson, type EmailConfig, type Fetch, type SendResult } from "./types";

export interface EmailMessage { to: string; toName?: string; subject: string; html: string; text?: string; headers?: Record<string, string>; tags?: Record<string, string>; idempotencyKey?: string }
export interface EmailProvider { send(m: EmailMessage): Promise<SendResult> }

/** Resend: POST https://api.resend.com/emails (Bearer). */
export class ResendEmail implements EmailProvider {
  constructor(private cfg: EmailConfig, private http: Fetch = fetch) {}
  body(m: EmailMessage) {
    return { from: `${this.cfg.fromName} <${this.cfg.fromEmail}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: this.cfg.replyTo || undefined, headers: m.headers, tags: Object.entries(m.tags || {}).map(([name, value]) => ({ name: name.replace(/[^A-Za-z0-9_-]/g, "_"), value: value.replace(/[^A-Za-z0-9_-]/g, "_") })) };
  }
  async send(m: EmailMessage): Promise<SendResult> {
    const res = await this.http("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json", ...(m.idempotencyKey ? { "Idempotency-Key": m.idempotencyKey } : {}) }, body: JSON.stringify(this.body(m)) });
    const j = (await readJson(res)) as { id?: string; message?: string };
    if (!res.ok || !j.id) throw new ProviderError(res.status, j.message || `Resend HTTP ${res.status}`, j);
    return { providerId: j.id, status: "sent" };
  }
}

/** Brevo: POST https://api.brevo.com/v3/smtp/email (header api-key). */
export class BrevoEmail implements EmailProvider {
  constructor(private cfg: EmailConfig, private http: Fetch = fetch) {}
  body(m: EmailMessage) {
    return { sender: { name: this.cfg.fromName, email: this.cfg.fromEmail }, to: [{ email: m.to, name: m.toName }], subject: m.subject, htmlContent: m.html, textContent: m.text, replyTo: this.cfg.replyTo ? { email: this.cfg.replyTo } : undefined, headers: m.headers, tags: Object.values(m.tags || {}) };
  }
  async send(m: EmailMessage): Promise<SendResult> {
    const res = await this.http("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": this.cfg.apiKey, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(this.body(m)) });
    const j = (await readJson(res)) as { messageId?: string; messageIds?: string[]; message?: string };
    const id = j.messageId || j.messageIds?.[0];
    if (!res.ok || !id) throw new ProviderError(res.status, j.message || `Brevo HTTP ${res.status}`, j);
    return { providerId: id, status: "sent" };
  }
}

export class FakeEmail implements EmailProvider {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<SendResult> { this.sent.push(m); return { providerId: "fake-email-" + crypto.randomUUID().slice(0, 12), status: "sent" }; }
}
