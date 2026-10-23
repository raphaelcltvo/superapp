/**
 * Cartão online: o número é digitado aqui e vira token no próprio gateway. Só o token sai para a nossa API.
 * Nada aqui pode ir para console, analytics ou storage.
 */
export interface OnlineCfg { gateway: "mercadopago" | "pagarme" | "asaas" | "fake"; env: string; methods: { pix: boolean; card: boolean }; maxInstallments: number; publicKey?: string; sdkUrl?: string; tokenizeUrl?: string; requiresDocument: boolean }
export interface CardFields { number: string; name: string; expiry: string; cvv: string; document?: string }
export interface CardToken { token: string; brand: string; last4: string; issuerId?: string }

export class CardError extends Error {}

export function detectBrand(n: string): string {
  const d = n.replace(/\D/g, "");
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "mastercard";
  if (/^3[47]/.test(d)) return "amex";
  if (/^(4011(78|79)|43(1274|8935)|45(1416|7393|763[12])|50(4175|6699|67[0-7]\d|9\d{3})|627780|63(6297|6368)|650(0[3-5]|4[0-9]|5[0-2])|6516(5[2-9]|[6-7]\d)|6550([0-1]\d|2[0-5]))/.test(d)) return "elo";
  if (/^(606282|3841)/.test(d)) return "hipercard";
  if (/^3(0[0-5]|[68])/.test(d)) return "diners";
  return "";
}
const luhn = (d: string) => { let s = 0; for (let i = 0; i < d.length; i++) { let x = +d[d.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; } return s % 10 === 0; };

export function validateCard(c: CardFields): string | null {
  const n = c.number.replace(/\D/g, "");
  if (n.length < 13 || n.length > 19 || !luhn(n)) return "Confira o número do cartão";
  if (c.name.trim().length < 3) return "Informe o nome impresso no cartão";
  const m = c.expiry.match(/^(\d{2})\/?(\d{2})$/);
  if (!m || +m[1] < 1 || +m[1] > 12) return "Validade no formato MM/AA";
  const now = new Date(); const y = 2000 + +m[2];
  if (y < now.getFullYear() || (y === now.getFullYear() && +m[1] < now.getMonth() + 1)) return "Cartão vencido";
  if (!/^\d{3,4}$/.test(c.cvv)) return "Código de segurança com 3 ou 4 dígitos";
  return null;
}

declare global { interface Window { MercadoPago?: new (pk: string, o?: { locale?: string }) => MpSdk } }
interface MpSdk {
  createCardToken(d: { cardNumber: string; cardholderName: string; cardExpirationMonth: string; cardExpirationYear: string; securityCode: string; identificationType?: string; identificationNumber?: string }): Promise<{ id: string }>;
  getPaymentMethods?(d: { bin: string }): Promise<{ results?: { id: string; issuer?: { id: number | string } }[] }>;
}
let mpLoad: Promise<void> | null = null;
function loadScript(src: string) {
  if (window.MercadoPago) return Promise.resolve();
  return (mpLoad ||= new Promise<void>((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => { mpLoad = null; rej(new CardError("Não conseguimos carregar o pagamento com cartão. Verifique a conexão.")); };
    document.head.appendChild(s);
  }));
}

export async function tokenizeCard(cfg: OnlineCfg, c: CardFields): Promise<CardToken> {
  const number = c.number.replace(/\D/g, ""); const ex = c.expiry.replace(/\D/g, ""); const mm = ex.slice(0, 2), yy = ex.slice(2, 4);
  const brand = detectBrand(number); const last4 = number.slice(-4);
  if (cfg.gateway === "fake") return { token: `fake_tok_${last4}_${brand || "visa"}_${Math.random().toString(36).slice(2, 10)}`, brand: brand || "visa", last4 };
  if (cfg.gateway === "mercadopago") {
    if (!cfg.publicKey) throw new CardError("Pagamento com cartão indisponível nesta loja");
    await loadScript(cfg.sdkUrl || "https://sdk.mercadopago.com/js/v2");
    const mp = new window.MercadoPago!(cfg.publicKey, { locale: "pt-BR" });
    let issuerId: string | undefined; let mpBrand = brand;
    try { const pm = await mp.getPaymentMethods?.({ bin: number.slice(0, 8) }); const r = pm?.results?.[0]; if (r) { mpBrand = r.id === "master" ? "mastercard" : r.id; if (r.issuer?.id) issuerId = String(r.issuer.id); } } catch { /* segue sem emissor */ } // conferir na doc: issuer_id obrigatório?
    try {
      const t = await mp.createCardToken({ cardNumber: number, cardholderName: c.name.trim(), cardExpirationMonth: mm, cardExpirationYear: "20" + yy, securityCode: c.cvv, identificationType: c.document ? "CPF" : undefined, identificationNumber: c.document?.replace(/\D/g, "") || undefined });
      return { token: t.id, brand: mpBrand, last4, issuerId };
    } catch { throw new CardError("Não conseguimos validar o cartão. Confira os dados."); }
  }
  if (cfg.gateway === "pagarme") {
    if (!cfg.tokenizeUrl) throw new CardError("Pagamento com cartão indisponível nesta loja");
    const r = await fetch(cfg.tokenizeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "card", card: { number, holder_name: c.name.trim(), exp_month: +mm, exp_year: +yy, cvv: c.cvv } }) }).catch(() => null);
    if (!r || !r.ok) throw new CardError("Não conseguimos validar o cartão. Confira os dados.");
    const j = (await r.json()) as { id: string; card?: { brand?: string; last_four_digits?: string } };
    return { token: j.id, brand: (j.card?.brand || brand).toLowerCase(), last4: j.card?.last_four_digits || last4 };
  }
  throw new CardError("Esta loja não aceita cartão online");
}

export const fmtCardNumber = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
export const fmtExpiry = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };
export const fmtCpf = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 11); return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); };
export function validCpf(v: string) {
  const d = v.replace(/\D/g, ""); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}
