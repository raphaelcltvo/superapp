import { Hono } from "hono";
import { z } from "zod";
import type { CuisineId } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { commitImport, createSession, fromRaw, fromUrl, getImport, receiveFromBookmarklet, receivePage } from "../services/menuimport";

const cuisine = z.enum(["pizza", "hamburguer", "japonesa", "acai", "confeitaria", "churrasco", "marmita", "arabe", "salgados", "poke", "padaria", "saudavel", "italiana", "mexicana", "bar", "generico"]);

/** Painel: /admin/menu-import */
export function menuImportAdminRoutes() {
  const r = new Hono<Env>();
  r.post("/ifood/session", async (c) => c.json(await createSession(ctxOf(c)), 201));
  r.post("/ifood/url", async (c) => { const i = await body(c, z.object({ url: z.string().min(10).max(500) })); return c.json(await fromUrl(ctxOf(c), i.url)); });
  r.post("/ifood/raw", async (c) => { const i = await body(c, z.object({ raw: z.unknown() })); if (i.raw == null) throw new HttpError(422, "Cole o JSON do cardápio"); return c.json(await fromRaw(ctxOf(c), typeof i.raw === "string" ? parse(i.raw) : i.raw)); });
  r.get("/:id", async (c) => c.json(await getImport(ctxOf(c), c.req.param("id"), (c.req.query("cuisine") as CuisineId) || undefined)));
  r.post("/:id/commit", async (c) => {
    const i = await body(c, z.object({ mode: z.enum(["replace", "merge"]), cuisine: cuisine.optional() }));
    return c.json(await commitImport(ctxOf(c), c.req.param("id"), i.mode, i.cuisine));
  });
  return r;
}
function parse(s: string) { try { return JSON.parse(s); } catch { throw new HttpError(422, "Esse texto não é um JSON válido"); } }

/** Rotas sem login usadas pelo bookmarklet (o token identifica marca, trabalho e segredo; vence em 30 min). */
export function mountMenuImportPublic(app: Hono<Env>) {
  app.post("/import/ifood/:token", async (c) => {
    const size = Number(c.req.header("content-length") || 0);
    if (size > 8 * 1024 * 1024) throw new HttpError(413, "Cardápio acima de 8 MB");
    const text = await c.req.text();
    return c.json(await receiveFromBookmarklet(c.get("deps"), c.req.param("token"), parse(text), text.length));
  });
  app.get("/import/ifood/:token/receive", (c) => c.html(receivePage(`${c.get("deps").publicUrl}/import/ifood/${c.req.param("token")}`)));
}
