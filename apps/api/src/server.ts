import { serve } from "@hono/node-server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app";
import { postgresDb } from "./db/postgres";
import { memoryDb } from "./db/memory";
import type { Storage } from "./deps";
import { logMessenger } from "./deps";

const port = Number(process.env.PORT || 8787);
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
const db = process.env.DATABASE_URL ? postgresDb(process.env.DATABASE_URL) : memoryDb();
const uploads = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");

/** Arquivos em disco no desenvolvimento. Em produção, troque por Supabase Storage/S3 (mesma interface). */
const disk: Storage = {
  async put(tenantId, name, bytes) { mkdirSync(join(uploads, tenantId), { recursive: true }); writeFileSync(join(uploads, tenantId, name), bytes); return `${publicUrl}/uploads/${tenantId}/${name}`; },
};

const app = createApp({
  db, jwtSecret: process.env.JWT_SECRET || "dev-secret-troque", now: () => new Date(), storage: disk, messenger: logMessenger, publicUrl,
  sendOtp: async (_t, phone, code) => console.log(`[otp] ${phone}: ${code}`), demo: process.env.DEMO === "1", cronSecret: process.env.CRON_SECRET, log: (m, x) => console.log(m, x ?? ""),
});
app.get("/uploads/*", async (c) => {
  const { readFile } = await import("node:fs/promises");
  const p = join(uploads, c.req.path.replace("/uploads/", ""));
  if (!p.startsWith(uploads)) return c.text("no", 400);
  try { return new Response(await readFile(p)); } catch { return c.text("Não encontrado", 404); }
});
serve({ fetch: app.fetch, port }, () => console.log(`API em ${publicUrl} (${db.kind})`));
