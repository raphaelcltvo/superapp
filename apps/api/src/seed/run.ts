import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { postgresDb } from "../db/postgres";
import { seedForneria } from "./forneria";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) { console.error("Defina DATABASE_URL"); process.exit(1); }
const publicUrl = process.env.PUBLIC_URL || "http://localhost:8787";
const uploads = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
mkdirSync(join(uploads, "seed"), { recursive: true });
cpSync(join(here, "photos"), join(uploads, "seed"), { recursive: true });
const idx = JSON.parse(readFileSync(join(here, "photos/index.json"), "utf8")) as Record<string, string>;
const u = (f: string) => `${publicUrl}/uploads/seed/${f}`;
const db = postgresDb(url);
await seedForneria(db, { photo: (n) => (idx[n] ? u(idx[n]) : undefined), media: { cover: u("capa.jpg"), logo: u("logo.jpg"), video: u("banner-99.mp4"), poster: u("poster.jpg"), gif: u("doces.gif") }, history: process.env.HISTORY !== "0", email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD });
console.log("Forneria Original criada. Login: " + (process.env.SEED_EMAIL || "demo@forneria.com.br") + " / " + (process.env.SEED_PASSWORD || "forneria2026"));
await db.close?.();
