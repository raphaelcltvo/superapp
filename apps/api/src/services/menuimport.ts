import { ifoodMerchantId, ifoodNameFromUrl, normalizeIfood, planIfoodImport, uid, type Category, type CuisineId, type ImportedMenu, type ImportPlan, type Item, type OptionGroup, type Tenant } from "@cw/core";
import type { Ctx } from "./ctx";
import { HttpError } from "./ctx";

/**
 * Importação de cardápio do iFood. O trabalho fica na tabela "imports" (kind "ifood_menu"):
 *   aguardando (sessão do bookmarklet aberta) → baixando (busca pelo servidor) → pronto (prévia) → concluida | erro | bloqueado.
 * Nada é publicado: o commit grava categorias, grupos e itens no rascunho.
 */
export type MenuImportStatus = "aguardando" | "baixando" | "pronto" | "concluida" | "erro" | "bloqueado";
export interface MenuImportJob {
  id: string;
  kind: "ifood_menu";
  status: MenuImportStatus;
  source: "bookmarklet" | "url" | "json";
  secret?: string;
  expiresAt?: string;
  url?: string;
  progress?: { done: number; total: number; message?: string };
  menu?: ImportedMenu;
  plan?: ImportPlan;
  error?: string;
  result?: CommitReport;
  createdAt: string;
  finishedAt?: string;
}
export interface CommitReport { mode: "replace" | "merge"; categories: number; items: number; groups: number; created: number; updated: number; removed: number; cuisine: CuisineId; photos?: { copied: number; failed: number; pending: number } }

const SESSION_MIN = 30;
const MAX_RAW = 8 * 1024 * 1024;

async function getJob(ctx: Ctx, id: string) {
  const j = await ctx.deps.db.get<MenuImportJob>("imports", ctx.tenantId, id);
  if (!j || j.kind !== "ifood_menu") throw new HttpError(404, "Importação não encontrada");
  return j;
}

/** Recebe o cardápio cru (bookmarklet, JSON colado ou busca do servidor), normaliza e monta a prévia. */
async function ingest(ctx: Ctx, job: MenuImportJob, raw: unknown) {
  let menu: ImportedMenu;
  try { menu = normalizeIfood(raw); } catch (e) { throw new HttpError(422, "Não reconheci o formato do cardápio do iFood: " + String((e as Error).message)); }
  if (!menu.categories.length) throw new HttpError(422, "O cardápio veio vazio. Abra a página da loja no iFood, role até o fim e tente de novo.");
  const plan = planIfoodImport(menu);
  const patch = { status: "pronto" as const, menu, plan, secret: undefined, error: undefined, progress: { done: 1, total: 1 }, finishedAt: ctx.deps.now().toISOString() };
  await ctx.deps.db.put("imports", ctx.tenantId, { ...job, ...patch });
  return { ...job, ...patch };
}

/* ---------------- sessão do bookmarklet ---------------- */
export async function createSession(ctx: Ctx) {
  const id = uid("mimp");
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(+ctx.deps.now() + SESSION_MIN * 60e3).toISOString();
  const job: MenuImportJob = { id, kind: "ifood_menu", status: "aguardando", source: "bookmarklet", secret, expiresAt, createdAt: ctx.deps.now().toISOString() };
  await ctx.deps.db.put("imports", ctx.tenantId, job);
  const token = `${ctx.tenantId}.${id}.${secret}`;
  const postUrl = `${ctx.deps.publicUrl}/import/ifood/${token}`;
  return { id, token, expiresAt, postUrl, receiveUrl: `${postUrl}/receive`, bookmarklet: bookmarklet(postUrl) };
}

/** Rota pública: valida o token (marca + trabalho + segredo) e grava o cardápio enviado pelo navegador do dono. */
export async function receiveFromBookmarklet(deps: Ctx["deps"], token: string, raw: unknown, size: number) {
  const [tenantId, id, secret] = token.split(".");
  if (!tenantId || !id || !secret) throw new HttpError(401, "Link de importação inválido");
  const ctx = { deps, tenantId };
  const job = await deps.db.get<MenuImportJob>("imports", tenantId, id).catch(() => null);
  if (!job || job.kind !== "ifood_menu" || !job.secret || !safeEq(job.secret, secret)) throw new HttpError(401, "Link de importação inválido");
  if (job.expiresAt && job.expiresAt < deps.now().toISOString()) throw new HttpError(410, "Link de importação vencido: gere outro no painel");
  if (size > MAX_RAW) throw new HttpError(413, "Cardápio acima de 8 MB");
  const out = await ingest(ctx, job, raw);
  return { ok: true, id: out.id, categories: out.plan!.report.counts.categories, items: out.plan!.report.counts.items };
}
function safeEq(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/* ---------------- JSON colado ---------------- */
export async function fromRaw(ctx: Ctx, raw: unknown) {
  const job: MenuImportJob = { id: uid("mimp"), kind: "ifood_menu", status: "baixando", source: "json", createdAt: ctx.deps.now().toISOString() };
  await ctx.deps.db.put("imports", ctx.tenantId, job);
  try { return view(await ingest(ctx, job, raw)); }
  catch (e) { await ctx.deps.db.patch("imports", ctx.tenantId, job.id, { status: "erro", error: String((e as Error).message) }); throw e; }
}

/* ---------------- busca pelo servidor (link da loja) ---------------- */
/**
 * Endereços públicos que a página da loja usa. Não conseguimos validar hoje (o iFood bloqueia acessos rápidos com PerimeterX
 * e não tínhamos um Chrome conectado): confira uma vez em produção. Se o iFood bloquear o servidor (403), o painel cai para o bookmarklet.
 */
export const IFOOD_CATALOG_URLS = (mid: string) => [
  `https://marketplace.ifood.com.br/v1/merchants/${mid}/catalog`,
  `https://www.ifood.com.br/site-api/v1/merchants/restaurant/${mid}/catalog`,
];
export const IFOOD_ITEM_URLS = (catalogUrl: string, itemId: string) => {
  const base = catalogUrl.split("?")[0].replace(/\/catalog\/?$/, "");
  return [`${base}/items/${itemId}`, `${base}/catalog/${itemId}`, `${catalogUrl.split("?")[0]}?itemId=${itemId}`];
};

export async function fromUrl(ctx: Ctx, url: string) {
  const mid = ifoodMerchantId(url);
  if (!/ifood\.com\.br/i.test(url) || !mid) throw new HttpError(422, "Cole o link da loja no iFood (termina com o código da loja, ex.: …/3f2a…-…)");
  const f = ctx.deps.ifoodFetch;
  if (!f) throw new HttpError(422, "O iFood não deixa o nosso servidor ler o cardápio direto. Use o botão “Copiar do iFood” no seu navegador (3 passos).", { useBookmarklet: true });
  const job: MenuImportJob = { id: uid("mimp"), kind: "ifood_menu", status: "baixando", source: "url", url, progress: { done: 0, total: 1, message: "Lendo o cardápio" }, createdAt: ctx.deps.now().toISOString() };
  await ctx.deps.db.put("imports", ctx.tenantId, job);
  const run = download(ctx, job, mid, f).catch(async (e) => {
    const blocked = e instanceof HttpError && e.status === 403;
    await ctx.deps.db.patch("imports", ctx.tenantId, job.id, { status: blocked ? "bloqueado" : "erro", error: String((e as Error).message), finishedAt: ctx.deps.now().toISOString() });
  });
  if (ctx.deps.demo || ctx.deps.ifoodSync) await run; // demonstração e testes: termina na mesma chamada
  return view((await getJob(ctx, job.id)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function download(ctx: Ctx, job: MenuImportJob, mid: string, f: NonNullable<Ctx["deps"]["ifoodFetch"]>) {
  const pace = ctx.deps.ifoodPaceMs ?? 3500;
  const headers = { accept: "application/json", "accept-language": "pt-BR,pt;q=0.9" };
  const get = async (u: string, tries = 3): Promise<Response | null> => {
    for (let k = 0; k < tries; k++) {
      const r = await f(u, { headers });
      if (r.status === 403 || r.status === 429 && k === tries - 1) throw new HttpError(403, "O iFood bloqueou a leitura pelo servidor. Use o botão “Copiar do iFood” no seu navegador.");
      if (r.status === 429 || r.status >= 500) { await sleep(pace * (k + 1) * 2); continue; }
      return r.ok ? r : null;
    }
    return null;
  };
  let catalog: unknown = null; let catalogUrl = "";
  for (const u of IFOOD_CATALOG_URLS(mid)) { const r = await get(u); if (r) { catalog = await r.json(); catalogUrl = u; break; } }
  if (!catalog) throw new HttpError(404, "Não achei o cardápio dessa loja no iFood");
  const menu = normalizeIfood(catalog);
  const need = menu.categories.flatMap((c) => c.items).filter((i) => i.needChoices && !i.choices.length).map((i) => i.ifoodId);
  const details: Record<string, unknown> = {};
  for (const [k, id] of need.entries()) {
    await ctx.deps.db.patch("imports", ctx.tenantId, job.id, { progress: { done: k, total: need.length, message: `Lendo complementos ${k + 1} de ${need.length}` } });
    for (const u of IFOOD_ITEM_URLS(catalogUrl, id)) { const r = await get(u, 2); if (r) { details[id] = await r.json(); break; } }
    if (pace) await sleep(pace + Math.random() * 1500);
  }
  const name = (catalog as { data?: { merchant?: { name?: string } } })?.data?.merchant?.name || ifoodNameFromUrl(job.url || "");
  await ingest(ctx, job, { merchant: { id: mid, url: job.url, name }, catalog, details });
}

/* ---------------- prévia ---------------- */
export function view(j: MenuImportJob) {
  const { secret: _s, menu: _m, ...rest } = j;
  return rest;
}
export async function getImport(ctx: Ctx, id: string, cuisine?: CuisineId) {
  const j = await getJob(ctx, id);
  if (j.status === "aguardando" && j.expiresAt && j.expiresAt < ctx.deps.now().toISOString()) return { ...view(j), status: "erro" as const, error: "Link vencido: gere outro" };
  if (cuisine && j.menu) return { ...view(j), plan: planIfoodImport(j.menu, { cuisine }) };
  return view(j);
}

/* ---------------- gravar no rascunho ---------------- */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function commitImport(ctx: Ctx, id: string, mode: "replace" | "merge", cuisine?: CuisineId): Promise<CommitReport> {
  const j = await getJob(ctx, id);
  if (!j.menu) throw new HttpError(409, j.status === "aguardando" ? "O cardápio ainda não chegou do iFood" : "Importação sem cardápio");
  const plan = planIfoodImport(j.menu, { cuisine: cuisine || j.plan?.cuisine });
  const { db } = ctx.deps; const T = ctx.tenantId;
  let created = 0, updated = 0, removed = 0;
  const [oldCats, oldItems, oldGroups] = await Promise.all([db.list<Category & { id: string }>("categories", T), db.list<Item & { id: string }>("items", T), db.list<OptionGroup & { id: string }>("option_groups", T)]);

  if (mode === "replace") {
    for (const x of oldItems) { await db.remove("items", T, x.id); removed++; }
    for (const x of oldGroups) await db.remove("option_groups", T, x.id);
    for (const x of oldCats) await db.remove("categories", T, x.id);
    for (const c of plan.categories) await db.put("categories", T, c);
    for (const g of plan.groups) await db.put("option_groups", T, g);
    for (const it of plan.items) { await db.put("items", T, it); created++; }
  } else {
    // categorias: reaproveita a de mesmo nome; as novas entram no fim
    const catMap: Record<string, string> = {};
    let pos = oldCats.length;
    for (const c of plan.categories) {
      const hit = oldCats.find((o) => o.id === c.id || norm(o.name) === norm(c.name));
      if (hit) catMap[c.id] = hit.id;
      else { await db.put("categories", T, { ...c, position: pos++ }); catMap[c.id] = c.id; }
    }
    // grupos: id determinístico pela assinatura (mesmo grupo no iFood = mesmo id) → regravar é idempotente
    for (const g of plan.groups) await db.put("option_groups", T, { ...(oldGroups.find((o) => o.id === g.id) || ({} as Partial<OptionGroup>)), ...g });
    const byImport = new Map(oldItems.filter((i) => i.importedFrom?.id).map((i) => [i.importedFrom!.id, i]));
    for (const it of plan.items) {
      const categoryId = catMap[it.categoryId];
      const hit = byImport.get(it.importedFrom!.id) || oldItems.find((o) => o.categoryId === categoryId && norm(o.name) === norm(it.name));
      if (hit) {
        // atualiza o que vem do iFood (preço, descrição, complementos); mantém foto própria, posição, códigos PDV e combinações prontas
        await db.put("items", T, { ...hit, name: it.name, description: it.description ?? hit.description, price: it.price, compareAt: it.compareAt, imageUrl: hit.imageUrl || it.imageUrl, kind: it.kind, groupIds: it.groupIds, available: it.available, measure: it.measure ?? hit.measure, serves: it.serves ?? hit.serves, tags: it.tags?.length ? Array.from(new Set([...(hit.tags || []), ...it.tags])) : hit.tags, isDrink: it.isDrink ?? hit.isDrink, liters: it.liters ?? hit.liters, importedFrom: it.importedFrom });
        updated++;
      } else {
        const inCat = (await db.count("items", T, { where: { categoryId } }));
        await db.put("items", T, { ...it, categoryId, position: inCat }); created++;
      }
    }
  }
  const t = (await db.tenants.get(T)) as unknown as Tenant;
  if (t && !t.settings?.cuisine) await db.tenants.put({ ...t, settings: { ...t.settings, cuisine: plan.cuisine } } as unknown as Parameters<typeof db.tenants.put>[0]);
  const photos = await copyPhotos(ctx);
  const result: CommitReport = { mode, categories: plan.categories.length, items: plan.items.length, groups: plan.groups.length, created, updated, removed, cuisine: plan.cuisine, photos };
  await db.patch("imports", T, id, { status: "concluida", result, finishedAt: ctx.deps.now().toISOString() });
  return result;
}

/* ---------------- fotos ---------------- */
const EXTERNAL = /^https?:\/\/[^/]*ifood[^/]*\//i;
/**
 * Copia as fotos que ainda apontam para o iFood para o nosso armazenamento (o cardápio não depende do servidor de imagens deles).
 * Sem deps.mediaFetch (demonstração, testes) as URLs ficam como estão e o relatório conta as pendentes.
 */
export async function copyPhotos(ctx: Ctx, limit = 400) {
  const { db, storage, mediaFetch } = ctx.deps; const T = ctx.tenantId;
  const items = (await db.list<Item & { id: string }>("items", T)).filter((i) => i.imageUrl && EXTERNAL.test(i.imageUrl));
  const groups = (await db.list<OptionGroup & { id: string }>("option_groups", T)).filter((g) => g.options.some((o) => o.imageUrl && EXTERNAL.test(o.imageUrl)));
  const pending = items.length + groups.reduce((a, g) => a + g.options.filter((o) => o.imageUrl && EXTERNAL.test(o.imageUrl)).length, 0);
  if (!mediaFetch || !pending) return { copied: 0, failed: 0, pending };
  const cache = new Map<string, string | null>();
  let copied = 0, failed = 0, n = 0;
  const grab = async (url: string) => {
    if (cache.has(url)) return cache.get(url)!;
    if (n++ >= limit) return null;
    try {
      const r = await mediaFetch(url);
      const type = r.headers.get("content-type") || "image/jpeg";
      if (!r.ok || !type.startsWith("image/")) throw new Error(String(r.status));
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 3e6) throw new Error("grande demais");
      const out = await storage.put(T, `ifood-${url.split("/").pop()!.replace(/[^a-zA-Z0-9._-]/g, "").slice(-60) || uid("img")}`, bytes, type);
      cache.set(url, out); copied++; return out;
    } catch { cache.set(url, null); failed++; return null; }
  };
  let left = 0;
  for (const it of items) { const u = await grab(it.imageUrl!); if (u) await db.patch("items", T, it.id, { imageUrl: u }); else left++; }
  for (const g of groups) {
    const options = [];
    for (const o of g.options) {
      if (!o.imageUrl || !EXTERNAL.test(o.imageUrl)) { options.push(o); continue; }
      const u = await grab(o.imageUrl); if (!u) left++;
      options.push({ ...o, imageUrl: u || o.imageUrl });
    }
    await db.patch("option_groups", T, g.id, { options });
  }
  return { copied, failed, pending: left };
}

/* ---------------- bookmarklet ---------------- */
/**
 * Roda na página da loja no iFood, no navegador do próprio dono (com a sessão dele), e:
 *  1. abre a janelinha do SuperApp (precisa ser no clique, senão o navegador bloqueia o pop-up);
 *  2. acha a chamada de catálogo que a página já fez (performance.getEntriesByType("resource"), URL com "/catalog");
 *  3. relê o catálogo e, item a item que pede escolhas, os complementos (3 a 5 s entre itens para não acionar o anti-robô);
 *  4. envia direto para a API; se a política da página bloquear, manda pela janelinha (postMessage); se falhar, copia o JSON.
 * Os endereços de detalhe do item precisam ser validados uma vez num Chrome real (não conseguimos conferir hoje).
 */
export function bookmarklet(postUrl: string) {
  const src = `(async()=>{const P=${JSON.stringify(postUrl)};
const w=window.open(P+'/receive','superapp_import','width=420,height=320');
const d=document.createElement('div');d.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;background:#fff;color:#1b1716;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:16px;font:14px/1.4 system-ui,sans-serif';
d.innerHTML='<b>Copiando para o SuperApp</b><p style="margin:8px 0">Procurando o cardápio…</p><div style="height:6px;background:#eee;border-radius:3px"><i style="display:block;height:6px;width:0;background:#a3191f;border-radius:3px"></i></div><div style="margin-top:10px;display:flex;gap:8px"><button>Cancelar</button></div>';
document.body.appendChild(d);const say=t=>d.querySelector('p').textContent=t;const bar=x=>d.querySelector('i').style.width=Math.round(x*100)+'%';
let stop=false;d.querySelector('button').onclick=()=>{stop=true;say('Cancelado.');setTimeout(()=>d.remove(),1500)};
const all=performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/\\/catalog(\\/?$|\\?)/.test(u));
const cu=all.pop();if(!cu){say('Não achei o cardápio. Abra a página da loja, role até o fim e clique de novo.');return}
let cat;try{cat=await(await fetch(cu,{credentials:'include'})).json()}catch(e){say('O iFood não respondeu. Recarregue a página e tente de novo.');return}
const menu=(cat.data&&cat.data.menu)||cat.menu||[];const need=[];menu.forEach(c=>(c.itens||c.items||[]).forEach(i=>{if(i.needChoices&&!(i.choices&&i.choices.length))need.push(i.id)}));
const base=cu.split('?')[0].replace(/\\/catalog\\/?$/,'');const det={};
for(let k=0;k<need.length&&!stop;k++){say('Lendo complementos '+(k+1)+' de '+need.length+'…');bar(k/need.length);const id=need[k];
for(const u of[base+'/items/'+id,base+'/catalog/'+id,cu.split('?')[0]+'?itemId='+id]){try{const r=await fetch(u,{credentials:'include'});if(r.status===403){stop=true;say('O iFood pediu verificação. Resolva na página e clique de novo.');break}if(r.ok){det[id]=await r.json();break}}catch(e){}}
await new Promise(r=>setTimeout(r,3000+Math.random()*2000))}
if(stop)return;bar(1);const m=location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
const body={merchant:{id:m&&m[0],name:document.title,url:location.href},catalog:cat,details:det};const txt=JSON.stringify(body);
say('Enviando para o SuperApp…');
try{const r=await fetch(P,{method:'POST',headers:{'content-type':'application/json'},body:txt});if(!r.ok)throw 0;say('Pronto! Volte ao painel do SuperApp.');try{w&&w.close()}catch(e){}return}catch(e){}
try{if(w&&!w.closed){w.postMessage({type:'superapp-ifood',payload:body},'*');say('Enviado pela janela do SuperApp. Volte ao painel.');return}}catch(e){}
const b=document.createElement('button');b.textContent='Copiar JSON';b.onclick=async()=>{await navigator.clipboard.writeText(txt);say('JSON copiado: cole no painel do SuperApp.')};d.querySelector('div:last-child').appendChild(b);
say('Não consegui enviar. Copie o JSON e cole no painel.')})()`;
  return "javascript:" + encodeURIComponent(src.replace(/\n/g, ""));
}

/** Janelinha aberta pelo bookmarklet: recebe o cardápio por postMessage e envia para a API do nosso domínio. */
export function receivePage(postUrl: string) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copiando do iFood</title>
<body style="font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;color:#1b1716;background:#fff"><h1 style="font-size:18px;margin:0 0 8px">SuperApp · Copiar do iFood</h1><p id="s">Aguardando o cardápio da página do iFood… Pode deixar esta janela aberta.</p>
<script>const P=${JSON.stringify(postUrl)};const s=document.getElementById('s');
addEventListener('message',async(e)=>{if(!e.data||e.data.type!=='superapp-ifood')return;s.textContent='Enviando…';
try{const r=await fetch(P,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(e.data.payload)});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);s.textContent='Pronto: '+j.items+' itens em '+j.categories+' categorias. Volte ao painel.';setTimeout(()=>close(),2500)}catch(err){s.textContent='Não consegui enviar: '+err.message}});
</script></body></html>`;
}
