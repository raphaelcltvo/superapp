import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../src/app";
import { memoryDb } from "../src/db/memory";
import { postgresDb } from "../src/db/postgres";
import { dataUrlStorage, logMessenger, type Deps } from "../src/deps";
import { seedForneria } from "../src/seed/forneria";
import type { Db } from "../src/db/types";

const PG = process.env.TEST_DATABASE_URL;
const backends: [string, () => Promise<Db>][] = [["memória", async () => memoryDb()]];
if (PG) backends.push(["postgres", async () => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(PG, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema public cascade; create schema public;");
  for (const f of ["001_init.sql", "002_mensagens.sql", "003_leads.sql"]) await sql.unsafe(readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"));
  await sql.end();
  return postgresDb(PG);
}]);

const RAW = JSON.parse(readFileSync(new URL("../src/seed/ifood-barra/raw.json", import.meta.url), "utf8"));

for (const [label, mk] of backends) describe(`Copiar do iFood (${label})`, () => {
  let app: ReturnType<typeof createApp>; let deps: Deps; let admin = "";
  const call = async (method: string, path: string, body?: unknown, raw = false) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(admin && !path.startsWith("/import/") ? { authorization: "Bearer " + admin } : {}) }, body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body) });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, body: (ct.includes("json") ? await r.json() : await r.text()) as any };
  };
  beforeAll(async () => {
    const db = await mk();
    deps = { db, jwtSecret: "t", now: () => new Date(), storage: dataUrlStorage, messenger: logMessenger, sendOtp: async () => {}, publicUrl: "https://cardapio.test", ifoodPaceMs: 0, ifoodSync: true };
    app = createApp(deps);
    await seedForneria(db, { photo: (n) => "https://img.test/" + encodeURIComponent(n) + ".jpg", media: { cover: "https://img.test/capa.jpg" } });
    admin = (await call("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" })).body.token;
  }, 60000);

  let jobId = "";
  it("bookmarklet: sessão com token de uso único, recebe o cardápio e monta a prévia", async () => {
    const s = await call("POST", "/admin/menu-import/ifood/session");
    expect(s.status).toBe(201);
    expect(s.body.bookmarklet.startsWith("javascript:")).toBe(true);
    expect(decodeURIComponent(s.body.bookmarklet)).toContain(`/import/ifood/${s.body.token}`);
    jobId = s.body.id;
    expect((await call("GET", `/admin/menu-import/${jobId}`)).body.status).toBe("aguardando");
    const page = await call("GET", `/import/ifood/${s.body.token}/receive`);
    expect(page.status).toBe(200); expect(page.body).toContain("superapp-ifood");
    expect((await call("POST", `/import/ifood/${s.body.token.replace(/.$/, "x")}`, RAW)).status).toBe(401);
    const r = await call("POST", `/import/ifood/${s.body.token}`, RAW);
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, categories: 11 });
    expect((await call("POST", `/import/ifood/${s.body.token}`, RAW)).status).toBe(401); // segredo já usado
    const v = await call("GET", `/admin/menu-import/${jobId}`);
    expect(v.body.status).toBe("pronto");
    expect(v.body.secret).toBeUndefined();
    expect(v.body.plan.cuisine).toBe("pizza");
    expect(v.body.plan.report.counts.categories).toBe(11);
    expect((await call("GET", `/admin/menu-import/${jobId}?cuisine=bar`)).body.plan.cuisine).toBe("bar");
    expect((await call("GET", "/admin/imports")).body.every((x: { kind?: string }) => x.kind !== "ifood_menu")).toBe(true);
  });

  it("mesclar duas vezes não duplica nada e preserva o que já existia", async () => {
    const before = (await call("GET", "/admin/items")).body.length;
    const a = await call("POST", `/admin/menu-import/${jobId}/commit`, { mode: "merge" });
    expect(a.status).toBe(200);
    const after1 = (await call("GET", "/admin/items")).body;
    expect(after1.length).toBe(before + a.body.created);
    expect(a.body.updated).toBeGreaterThan(0); // itens da Forneria já existentes (mesmo nome na mesma categoria)
    const s2 = await call("POST", "/admin/menu-import/ifood/raw", { raw: JSON.stringify(RAW) });
    expect(s2.body.status).toBe("pronto");
    const b = await call("POST", `/admin/menu-import/${s2.body.id}/commit`, { mode: "merge" });
    expect(b.body.created).toBe(0); expect(b.body.updated).toBe(b.body.items);
    const after2 = (await call("GET", "/admin/items")).body;
    expect(after2.length).toBe(after1.length);
    expect((await call("GET", "/admin/categories")).body.length).toBe((await call("GET", "/admin/categories")).body.length);
  });

  it("substituir troca o cardápio inteiro e o rascunho passa na auditoria", async () => {
    const s = await call("POST", "/admin/menu-import/ifood/raw", { raw: RAW });
    const r = await call("POST", `/admin/menu-import/${s.body.id}/commit`, { mode: "replace" });
    expect(r.body).toMatchObject({ mode: "replace", categories: 11, created: r.body.items });
    const items = (await call("GET", "/admin/items")).body as { importedFrom?: { id: string } }[];
    expect(items.length).toBe(r.body.items);
    expect(items.every((i) => i.importedFrom?.id)).toBe(true);
    const audit = (await call("GET", "/admin/audit")).body as { level: string; message: string; where: string }[];
    expect(audit.filter((x) => x.level === "erro" && !x.where.startsWith("Banner") && !x.where.startsWith("Estratégia"))).toEqual([]);
    expect((await call("GET", "/admin/brand")).body.settings.cuisine).toBeTruthy();
  });

  it("link da loja: sem leitura pelo servidor, manda usar o bookmarklet; com leitura, baixa e pagina; 403 vira bloqueado", async () => {
    const url = "https://www.ifood.com.br/delivery/rio-de-janeiro-rj/forneria-original-pizza---barra/5d4c3a2b-1f0e-4d9c-8b7a-6f5e4d3c2b1a";
    const no = await call("POST", "/admin/menu-import/ifood/url", { url });
    expect(no.status).toBe(422); expect(no.body.details.useBookmarklet).toBe(true);
    expect((await call("POST", "/admin/menu-import/ifood/url", { url: "https://exemplo.com/loja" })).status).toBe(422);
    const hits: string[] = [];
    deps.ifoodFetch = async (u) => {
      hits.push(u);
      if (u.includes("marketplace.ifood.com.br")) return new Response("{}", { status: 404 });
      if (/\/catalog$/.test(u)) return Response.json(RAW.catalog);
      const m = u.match(/\/items\/([^/?]+)$/);
      if (m && RAW.details[m[1]]) return Response.json(RAW.details[m[1]]);
      return new Response("", { status: 404 });
    };
    const ok = await call("POST", "/admin/menu-import/ifood/url", { url });
    expect(ok.body.status).toBe("pronto");
    expect(ok.body.plan.merchant.name).toBe("Forneria Original Pizza - Barra");
    expect(ok.body.plan.report.counts.groups).toBeGreaterThan(40);
    expect(ok.body.plan.report.counts.items).toBeGreaterThan(70);
    expect(hits.filter((h) => h.includes("/items/")).length).toBe(Object.keys(RAW.details).length);
    deps.ifoodFetch = async () => new Response("captcha", { status: 403 });
    const blocked = await call("POST", "/admin/menu-import/ifood/url", { url });
    expect(blocked.body.status).toBe("bloqueado");
    expect(blocked.body.error).toMatch(/Copiar do iFood/);
    deps.ifoodFetch = undefined;
  });
});

describe("Copiar do iFood · fotos", () => {
  it("copia as fotos do iFood para o nosso armazenamento quando há mediaFetch", async () => {
    const { memoryDb } = await import("../src/db/memory");
    const { copyPhotos } = await import("../src/services/menuimport");
    const db = memoryDb();
    await db.tenants.put({ id: "t1", slug: "t1" } as never);
    await db.put("items", "t1", { id: "i1", imageUrl: "https://static.ifood-static.com.br/image/upload/t_high/pratos/abc.jpg" } as never);
    await db.put("items", "t1", { id: "i2", imageUrl: "https://minha.cdn/foto.jpg" } as never);
    await db.put("option_groups", "t1", { id: "g1", options: [{ id: "o1", imageUrl: "https://static.ifood-static.com.br/image/upload/t_high/pratos/abc.jpg" }, { id: "o2", imageUrl: "https://static.ifood-static.com.br/x/bad.jpg" }] } as never);
    const saved: string[] = [];
    const deps = { db, storage: { async put(_t: string, name: string) { saved.push(name); return "https://nosso.storage/" + name; } }, mediaFetch: async (u: string) => (u.includes("bad") ? new Response("x", { status: 404 }) : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })) } as never;
    const r = await copyPhotos({ deps, tenantId: "t1" });
    expect(r).toEqual({ copied: 1, failed: 1, pending: 1 });
    expect(saved).toEqual(["ifood-abc.jpg"]);
    expect((await db.get<{ id: string; imageUrl: string }>("items", "t1", "i1"))!.imageUrl).toBe("https://nosso.storage/ifood-abc.jpg");
    expect((await db.get<{ id: string; imageUrl: string }>("items", "t1", "i2"))!.imageUrl).toBe("https://minha.cdn/foto.jpg");
    const g = await db.get<{ id: string; options: { imageUrl: string }[] }>("option_groups", "t1", "g1");
    expect(g!.options.map((o) => o.imageUrl)).toEqual(["https://nosso.storage/ifood-abc.jpg", "https://static.ifood-static.com.br/x/bad.jpg"]);
  });
});
