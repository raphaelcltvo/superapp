/** Backend local para desenvolver e testar o cardápio: API em memória + Forneria de exemplo + SAIPOS de mentira. */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../api/src/app";
import { memoryDb } from "../../api/src/db/memory";
import { dataUrlStorage, logMessenger } from "../../api/src/deps";
import { FakeSaipos } from "../../api/src/integrations/saipos/fake";
import { seedForneria } from "../../api/src/seed/forneria";

const port = Number(process.env.PORT || 8787);
const url = `http://localhost:${port}`;
const photos = join(dirname(fileURLToPath(import.meta.url)), "../../api/src/seed/photos");
const idx = JSON.parse(readFileSync(join(photos, "index.json"), "utf8")) as Record<string, string>;
const saipos = new FakeSaipos("https://saipos.dev", { forneria: "segredo" });
const db = memoryDb();
const app = createApp({ db, jwtSecret: "dev", now: () => new Date(), storage: dataUrlStorage, messenger: logMessenger, sendOtp: async (_t, p, c) => console.log(`[otp] ${p}: ${c}`), demo: true, publicUrl: url, saiposFetch: (u, i) => saipos.fetch(u, i) });
const types: Record<string, string> = { ".jpg": "image/jpeg", ".mp4": "video/mp4", ".gif": "image/gif", ".png": "image/png" };
app.get("/media/:f", (c) => { try { return new Response(readFileSync(join(photos, c.req.param("f").replace(/[^\w.-]/g, ""))), { headers: { "content-type": types[extname(c.req.param("f"))] || "application/octet-stream", "cache-control": "max-age=3600" } }); } catch { return c.text("404", 404); } });

const m = (f: string) => `${url}/media/${f}`;
await seedForneria(db, { photo: (n) => (idx[n] ? m(idx[n]) : undefined), media: { cover: m("capa.jpg"), logo: m("logo.jpg"), video: m("banner-99.mp4"), poster: m("poster.jpg"), gif: m("doces.gif") }, history: true });
const call = async (method: string, path: string, body?: unknown, token?: string) => (await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<Record<string, unknown>>;
const { token } = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })) as { token: string };
await call("PUT", "/admin/integrations/saipos/sto_leblon", { enabled: true, env: "homolog", idPartner: "forneria", secret: "segredo", codStore: "896", deliveryBy: "RESTAURANT", autoSend: true, payments: {}, baseUrl: "https://saipos.dev" }, token);
// loja sempre aberta no ambiente de desenvolvimento
const st = (await call("GET", "/admin/stores/sto_leblon", undefined, token)) as Record<string, unknown>;
await call("PUT", "/admin/stores/sto_leblon", { ...st, hours: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, open: "00:00", close: "23:59" })) }, token);
console.log("publicado:", await call("POST", "/admin/publish", { notes: "dev" }, token));
serve({ fetch: app.fetch, port }, () => console.log(`API de desenvolvimento em ${url} (admin: demo@forneria.com.br / forneria2026)`));
