const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** ULID-like: ordenável por tempo, seguro para URL. */
export function uid(prefix = ""): string {
  let t = Date.now(), ts = "";
  for (let i = 0; i < 10; i++) { ts = A[t % 32] + ts; t = Math.floor(t / 32); }
  const rnd = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rnd);
  let r = "";
  for (let i = 0; i < 16; i++) r += A[rnd[i] % 32];
  return (prefix ? prefix + "_" : "") + ts + r;
}
export const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
/** Normaliza telefone BR para 55DDDNUMERO. */
export function normPhone(s?: string) {
  let d = onlyDigits(s || "");
  if (!d) return undefined;
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d.length >= 12 ? d : undefined;
}
