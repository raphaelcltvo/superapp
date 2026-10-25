import { Hono } from "hono";
import { z } from "zod";
import { suggestBasePrice, strategyTemplates, uid, slugify, breakEven, type Item, type OptionGroup } from "@cw/core";
import { body, ctxOf, type Env } from "../http";
import { HttpError } from "../services/ctx";
import { readToken, newApiKey, hashPassword, type AdminClaims } from "../auth";
import { schemas, loyaltySchema, merchSchema, brandSchema, type CrudTable } from "../schemas";
import { auditCatalog, draftSnapshot, getSetting, putSetting, publish, DEFAULT_LOYALTY, DEFAULT_MERCH, type MenuVersion } from "../services/catalog";
import { crmRoutes } from "./admin-crm";
import { opsRoutes } from "./admin-ops";
import { paymentsAdminRoutes } from "./admin-payments";
import { messagingAdminRoutes } from "./admin-messaging";
import { engageAdminRoutes } from "./engage";
import { boardRoutes } from "./admin-board";

const CRUD = Object.keys(schemas) as CrudTable[];
const slugTables = new Set(["categories", "stores"]);

export function adminRoutes() {
  const r = new Hono<Env>();
  r.use("*", async (c, next) => {
    const a = await readToken<AdminClaims>(c.req.header("authorization"), c.get("deps").jwtSecret);
    if (!a?.tid) throw new HttpError(401, "Faça login");
    c.set("admin", a); c.set("tenantId", a.tid);
    if (a.role === "analyst" && c.req.method !== "GET" && !c.req.path.includes("/crm/")) throw new HttpError(403, "Perfil analista só consulta");
    await next();
  });

  r.get("/me", async (c) => {
    const a = c.get("admin")!; const deps = c.get("deps");
    const user = await deps.db.get<{ id: string; email: string; name: string }>("users", a.tid, a.sub);
    return c.json({ user: user && { id: user.id, email: user.email, name: user.name, role: a.role }, tenant: await deps.db.tenants.get(a.tid) });
  });

  /* ---------- marca e configurações ---------- */
  r.get("/brand", async (c) => c.json(await c.get("deps").db.tenants.get(c.get("tenantId"))));
  r.put("/brand", async (c) => {
    const b = await body(c, brandSchema); const db = c.get("deps").db;
    const t = await db.tenants.get(c.get("tenantId"));
    return c.json(await db.tenants.put({ ...t!, ...b }));
  });
  r.get("/settings/merch", async (c) => c.json(await getSetting(ctxOf(c), "merch", DEFAULT_MERCH)));
  r.put("/settings/merch", async (c) => c.json(await putSetting(ctxOf(c), "merch", await body(c, merchSchema))));
  r.get("/settings/loyalty", async (c) => c.json(await getSetting(ctxOf(c), "loyalty", DEFAULT_LOYALTY)));
  r.put("/settings/loyalty", async (c) => c.json(await putSetting(ctxOf(c), "loyalty", await body(c, loyaltySchema))));

  /* ---------- rascunho, auditoria e publicação ---------- */
  r.get("/draft", async (c) => c.json(await draftSnapshot(ctxOf(c))));
  r.get("/audit", async (c) => {
    const ctx = ctxOf(c);
    const integ = await ctx.deps.db.list<{ id: string; config: { enabled: boolean } }>("integrations", ctx.tenantId);
    return c.json(auditCatalog(await draftSnapshot(ctx), { requirePdv: integ.some((i) => i.id.startsWith("saipos:") && i.config.enabled) }));
  });
  r.post("/publish", async (c) => {
    const i = await body(c, z.object({ notes: z.string().optional() }));
    return c.json(await publish(ctxOf(c), c.get("admin")!.sub, i.notes));
  });
  r.get("/versions", async (c) => {
    const vs = await c.get("deps").db.list<MenuVersion & { id: string }>("menu_versions", c.get("tenantId"), { limit: 30 });
    const t = await c.get("deps").db.tenants.get(c.get("tenantId"));
    return c.json(vs.map((v) => ({ id: v.id, number: v.number, createdAt: v.createdAt, createdBy: v.createdBy, notes: v.notes, current: v.id === t?.publishedVersionId, items: v.snapshot.items.length })));
  });
  r.post("/versions/:id/rollback", async (c) => {
    const db = c.get("deps").db; const v = await db.get("menu_versions", c.get("tenantId"), c.req.param("id"));
    if (!v) throw new HttpError(404, "Versão não encontrada");
    const t = await db.tenants.get(c.get("tenantId"));
    await db.tenants.put({ ...t!, publishedVersionId: v.id });
    return c.json({ ok: true });
  });

  /* ---------- ajudas do cardápio ---------- */
  r.post("/items/:id/fix-base", async (c) => {
    const ctx = ctxOf(c);
    const it = await ctx.deps.db.get<Item & { id: string }>("items", ctx.tenantId, c.req.param("id"));
    if (!it) throw new HttpError(404, "Item não encontrado");
    const groups = (await Promise.all(it.groupIds.map((g) => ctx.deps.db.get<OptionGroup & { id: string }>("option_groups", ctx.tenantId, g)))).filter(Boolean) as OptionGroup[];
    return c.json(await ctx.deps.db.patch("items", ctx.tenantId, it.id, { price: suggestBasePrice(it, groups) }));
  });
  r.post("/items/reorder", async (c) => {
    const i = await body(c, z.object({ ids: z.array(z.string()) }));
    await Promise.all(i.ids.map((id, pos) => c.get("deps").db.patch("items", c.get("tenantId"), id, { position: pos })));
    return c.json({ ok: true });
  });
  r.post("/categories/reorder", async (c) => {
    const i = await body(c, z.object({ ids: z.array(z.string()) }));
    await Promise.all(i.ids.map((id, pos) => c.get("deps").db.patch("categories", c.get("tenantId"), id, { position: pos })));
    return c.json({ ok: true });
  });
  r.get("/strategy-templates", (c) => c.json(strategyTemplates()));
  r.get("/break-even", (c) => c.json(breakEven(Number(c.req.query("discount")) / 100, Number(c.req.query("margin")) / 100)));

  /* ---------- mídia (imagem, GIF, vídeo) ---------- */
  r.post("/media", async (c) => {
    const form = await c.req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new HttpError(400, "Envie o arquivo no campo file");
    const okTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "video/webm"];
    if (!okTypes.includes(f.type)) throw new HttpError(415, "Formato não aceito (jpg, png, webp, gif, mp4, webm)");
    const max = f.type.startsWith("video/") ? 15e6 : 3e6;
    if (f.size > max) throw new HttpError(413, `Arquivo acima de ${max / 1e6} MB`);
    const deps = c.get("deps");
    const url = await deps.storage.put(c.get("tenantId"), `${uid("med")}-${slugify(f.name.replace(/\.[^.]+$/, ""))}.${f.name.split(".").pop()}`, new Uint8Array(await f.arrayBuffer()), f.type);
    const m = { id: uid("med"), url, name: f.name, type: f.type, size: f.size, createdAt: deps.now().toISOString() };
    await deps.db.put("media", c.get("tenantId"), m);
    return c.json(m, 201);
  });
  r.get("/media", async (c) => c.json(await c.get("deps").db.list("media", c.get("tenantId"), { limit: 200 })));

  /* ---------- chaves de API e usuários ---------- */
  r.get("/api-keys", async (c) => c.json((await c.get("deps").db.list<{ id: string; keyHash: string }>("api_keys", c.get("tenantId"))).map(({ keyHash: _h, ...k }) => k)));
  r.post("/api-keys", async (c) => {
    const i = await body(c, z.object({ name: z.string().min(1), scopes: z.array(z.enum(["customers:write", "orders:write", "menu:read", "events:write"])).min(1) }));
    const k = await newApiKey();
    const doc = { id: uid("key"), name: i.name, scopes: i.scopes, prefix: k.prefix, keyHash: k.hash, createdAt: c.get("deps").now().toISOString() };
    await c.get("deps").db.put("api_keys", c.get("tenantId"), doc);
    return c.json({ id: doc.id, name: doc.name, scopes: doc.scopes, prefix: doc.prefix, key: k.raw }, 201);
  });
  r.delete("/api-keys/:id", async (c) => c.json({ ok: await c.get("deps").db.remove("api_keys", c.get("tenantId"), c.req.param("id")) }));
  r.get("/users", async (c) => c.json((await c.get("deps").db.list<{ id: string; passwordHash: string }>("users", c.get("tenantId"))).map(({ passwordHash: _p, ...u }) => u)));
  r.post("/users", async (c) => {
    if (c.get("admin")!.role !== "owner") throw new HttpError(403, "Só o dono convida usuários");
    const i = await body(c, z.object({ name: z.string(), email: z.string().email(), password: z.string().min(8), role: z.enum(["owner", "manager", "analyst"]) }));
    const db = c.get("deps").db;
    if (await db.findGlobal("users", "email", i.email)) throw new HttpError(409, "E-mail já cadastrado");
    const u = { id: uid("usr"), name: i.name, email: i.email.toLowerCase(), role: i.role, passwordHash: await hashPassword(i.password), createdAt: c.get("deps").now().toISOString() };
    await db.put("users", c.get("tenantId"), u);
    return c.json({ id: u.id, name: u.name, email: u.email, role: u.role }, 201);
  });

  r.route("/crm", crmRoutes());
  r.route("/messaging", messagingAdminRoutes());
  r.route("/engagement", engageAdminRoutes());
  r.route("/", boardRoutes()); // antes de /orders/:id
  r.route("/", opsRoutes());
  r.route("/", paymentsAdminRoutes());

  /* ---------- CRUD genérico das entidades do painel ---------- */
  for (const table of CRUD) {
    const schema = schemas[table];
    r.get(`/${table}`, async (c) => c.json(await c.get("deps").db.list(table, c.get("tenantId"), table === "categories" || table === "items" ? { orderBy: { field: "position" } } : undefined)));
    r.get(`/${table}/:id`, async (c) => { const d = await c.get("deps").db.get(table, c.get("tenantId"), c.req.param("id")); if (!d) throw new HttpError(404, "Não encontrado"); return c.json(d); });
    r.post(`/${table}`, async (c) => {
      const raw = (await c.req.json()) as Record<string, unknown>;
      if (slugTables.has(table) && !raw.slug && raw.name) raw.slug = slugify(String(raw.name));
      const data = (schema as z.ZodTypeAny).parse(raw);
      const doc = { ...data, id: (raw.id as string) || uid(table.slice(0, 3)), createdAt: c.get("deps").now().toISOString() };
      await c.get("deps").db.put(table, c.get("tenantId"), doc);
      return c.json(doc, 201);
    });
    r.put(`/${table}/:id`, async (c) => {
      const db = c.get("deps").db; const prev = await db.get(table, c.get("tenantId"), c.req.param("id"));
      if (!prev) throw new HttpError(404, "Não encontrado");
      const data = (schema as z.ZodTypeAny).parse(await c.req.json());
      const doc = { ...prev, ...data, id: prev.id };
      await db.put(table, c.get("tenantId"), doc);
      return c.json(doc);
    });
    r.delete(`/${table}/:id`, async (c) => c.json({ ok: await c.get("deps").db.remove(table, c.get("tenantId"), c.req.param("id")) }));
  }
  return r;
}
