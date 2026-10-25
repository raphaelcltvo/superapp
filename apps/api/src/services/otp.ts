import { HttpError } from "./ctx";

/** Códigos de verificação em memória do processo (com mais de uma instância: mover para Redis ou o banco). */
const otps = new Map<string, { code: string; exp: number; tries: number }>();

export function issueOtp(tenantId: string, phone: string, demo?: boolean) {
  const code = demo ? "1234" : String(Math.floor(1000 + Math.random() * 9000));
  otps.set(`${tenantId}|${phone}`, { code, exp: Date.now() + 10 * 60e3, tries: 0 });
  return code;
}

/** Confere e consome o código; lança erro com a mensagem para o cliente. */
export function consumeOtp(tenantId: string, phone: string, code: string) {
  const key = `${tenantId}|${phone}`; const o = otps.get(key);
  if (!o || o.exp < Date.now()) throw new HttpError(422, "Código expirado, peça outro");
  if (++o.tries > 5) { otps.delete(key); throw new HttpError(429, "Muitas tentativas"); }
  if (o.code !== code) throw new HttpError(422, "Código incorreto");
  otps.delete(key);
}
