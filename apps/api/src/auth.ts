import { sign, verify } from "hono/jwt";

const enc = new TextEncoder();
const b64 = (u: ArrayBuffer | Uint8Array) => { const a = u instanceof Uint8Array ? u : new Uint8Array(u); let s = ""; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PBKDF2-SHA256 com 120 mil iterações (WebCrypto: roda em Node, Edge e navegador). */
export async function hashPassword(pw: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120_000 }, key, 256);
  return `pbkdf2$${b64(salt)}$${b64(bits)}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [, salt] = stored.split("$");
  return (await hashPassword(pw, salt)) === stored;
}
export async function sha256(s: string) { return b64(await crypto.subtle.digest("SHA-256", enc.encode(s))); }

export type Role = "owner" | "manager" | "analyst";
export interface AdminClaims { sub: string; tid: string; role: Role; exp: number; [k: string]: unknown }
export interface CustomerClaims { cid: string; tid: string; kind: "customer"; exp: number; [k: string]: unknown }

export const signAdmin = (c: Omit<AdminClaims, "exp">, secret: string) => sign({ ...c, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }, secret, "HS256");
export const signCustomer = (c: Omit<CustomerClaims, "exp" | "kind">, secret: string) => sign({ ...c, kind: "customer", exp: Math.floor(Date.now() / 1000) + 180 * 86400 }, secret, "HS256");
export async function readToken<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  try { return (await verify(token.replace(/^Bearer\s+/i, ""), secret, "HS256")) as T; } catch { return null; }
}

/** Gera chave de API: cw_live_<32 chars>. Guardamos só o hash. */
export async function newApiKey() {
  const raw = "cw_live_" + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, prefix: raw.slice(0, 14), hash: await sha256(raw) };
}

/** Assinatura HMAC dos webhooks que enviamos para sistemas do cliente. */
export async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}
