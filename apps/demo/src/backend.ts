import { createApp } from "../../api/src/app";
import { memoryDb, type MemorySnapshot } from "../../api/src/db/memory";
import { dataUrlStorage, type Deps } from "../../api/src/deps";
import { FakeSaipos } from "../../api/src/integrations/saipos/fake";
import type { SaiposCatalogRow } from "../../api/src/integrations/saipos/types";
import { seedForneria } from "../../api/src/seed/forneria";
import { signCustomer } from "../../api/src/auth";
import photoIndex from "../../api/src/seed/photos/index.json";
import type { Transport } from "@cw/client";
import type { Customer, Item, OptionGroup, Order, Store } from "@cw/core";

/**
 * Backend completo rodando no navegador: mesma API do servidor, banco em memória salvo no IndexedDB,
 * SAIPOS de teste que confirma, despacha e entrega os pedidos sozinha.
 */
const DB_NAME = "superapp-demo", KEY = "snapshot-v8"; // v7: primeira visita, leads e senha do pagamento online
const SLUG = "forneria-original";
const media = (f: string) => `media/${f}`;

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => { try { const tx = open.result.transaction("kv", mode); const r = fn(tx.objectStore("kv")); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); } catch { resolve(undefined); } };
    } catch { resolve(undefined); }
  });
}
export const resetDemo = () => idb("readwrite", (s) => s.delete(KEY));

export interface Demo {
  transport: Transport;
  clock: { offsetTo: (d: Date | null) => void };
  customerToken: (kind: "recorrente" | "em_risco") => Promise<string | null>;
  saipos: FakeSaipos;
  slug: string;
}

export async function startDemo(onProgress: (msg: string) => void): Promise<Demo> {
  let fixedNow: Date | null = null;
  const now = () => (fixedNow ? new Date(+fixedNow + (performance.now() - fixedAt)) : new Date());
  let fixedAt = performance.now();
  const saipos = new FakeSaipos("https://saipos-teste.local", { "demo-partner": "demo-secret" });
  const snap = (await idb<MemorySnapshot>("readonly", (s) => s.get(KEY))) || undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const db = memoryDb(snap, (s) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => idb("readwrite", (st) => st.put(s, KEY)), 600); });
  const deps: Deps = {
    db, jwtSecret: "demo-superapp", now, storage: dataUrlStorage, demo: true, publicUrl: "https://cardapio.superapp.demo",
    messenger: { async send() { return { id: crypto.randomUUID(), status: "sent" }; } },
    sendOtp: async () => {}, saiposFetch: (u, i) => saipos.fetch(u, i),
  };
  const app = createApp(deps);
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const isForm = body instanceof FormData;
    const r = await app.request(path, { method, headers: isForm ? headers : { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const T = "ten_forneria";

  if (!snap) {
    onProgress("Montando a Forneria Original com 90 dias de histórico…");
    const photo = (n: string) => ((photoIndex as Record<string, string>)[n] ? media((photoIndex as Record<string, string>)[n]) : undefined);
    await seedForneria(db, { photo, photoNames: Object.keys(photoIndex as Record<string, string>), media: { cover: media("capa.jpg"), logo: media("logo.jpg"), video: media("banner-99.mp4"), poster: media("poster.jpg"), gif: media("doces.gif") }, history: true });
    // loja aberta a qualquer hora na demonstração
    const st = (await db.get<Store & { id: string }>("stores", T, "sto_leblon"))!;
    await db.put("stores", T, { ...st, hours: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w as 0, open: "00:00", close: "23:59" })) });
    const login = await req("POST", "/auth/login", { email: "demo@forneria.com.br", password: "forneria2026" });
    const auth = { authorization: "Bearer " + (login.json as { token: string }).token };
    await req("PUT", "/admin/integrations/saipos/sto_leblon", { enabled: true, env: "homolog", idPartner: "demo-partner", secret: "demo-secret", codStore: "896", deliveryBy: "RESTAURANT", autoSend: true, payments: {}, baseUrl: "https://saipos-teste.local" }, auth);
    // pagamento online com o gateway de teste: Pix se paga sozinho em ~8 s, cartão final 0002 é recusado
    await req("PUT", "/admin/integrations/payments", { enabled: true, gateway: "fake", env: "sandbox", methods: { pix: true, card: true }, pixExpiresMinutes: 15, maxInstallments: 3, fakeAutoPaySeconds: 8 }, auth);
    onProgress("Publicando a primeira versão…");
    await req("POST", "/admin/publish", { notes: "Cardápio importado do iFood + preços de set/2026" }, auth);
  }

  // WhatsApp e e-mail de teste: as campanhas "saem" e o relatório mostra entregas, aberturas e cliques simulados
  if (!(await db.get("integrations", T, "whatsapp"))) await db.put("integrations", T, { id: "whatsapp", provider: "whatsapp", config: { enabled: true, provider: "fake", phoneNumberId: "demo", token: "demo", appSecret: "demo", verifyToken: "demo", graphVersion: "v26.0", otpTemplate: { name: "codigo_acesso", language: "pt_BR" }, costPerMessage: 0.35, webhookToken: "demo" }, state: { connected: false } }); // QR de teste ainda não lido: o Setup mostra a conexão
  if (!(await db.get("integrations", T, "email"))) await db.put("integrations", T, { id: "email", provider: "email", config: { enabled: true, provider: "fake", apiKey: "demo", fromName: "Forneria Original", fromEmail: "contato@forneria.com.br", webhookToken: "demo" } });

  // catálogo da SAIPOS de teste espelha os códigos do cardápio (para o "Importar códigos PDV")
  const items = await db.list<Item & { id: string }>("items", T); const groups = await db.list<OptionGroup & { id: string }>("option_groups", T);
  const G = Object.fromEntries(groups.map((g) => [g.id, g]));
  const rows: SaiposCatalogRow[] = [];
  for (const it of items) {
    const base = { categoria: "Cardápio", tamanho: "Único", id_store_item: Number(it.integrationCode) || 1, item: it.name.split(" · ")[0], store_item_enabled: "Y" as const, store_choice_enabled: "Y" as const, store_choice_item_enabled: "Y" as const, item_type: "pizza", calc_method: null, print_by_quantity: null };
    rows.push({ ...base, tipo: "PRATO", id_store_choice: null, complemento: "", complemento_item: "", price: it.price, codigo_saipos: it.integrationCode || "", min_choices: null, max_choices: null });
    for (const gid of it.groupIds) { const g = G[gid]; if (!g) continue; for (const o of g.options) rows.push({ ...base, tipo: "COMPLEMENTO", id_store_choice: g.name.length, complemento: g.name, complemento_item: o.name, price: o.price, codigo_saipos: `${it.integrationCode}.${o.integrationCode}`, min_choices: g.min, max_choices: g.max }); }
  }
  saipos.catalogRows = rows;

  // a "loja" no PDV avança os pedidos novos sozinha
  const webhookToken = async () => ((await db.get<{ id: string; config: { webhookSecret?: string } }>("integrations", T, "saipos:sto_leblon"))?.config.webhookSecret);
  const seen = new Set<string>();
  setInterval(async () => {
    for (const [id, o] of saipos.orders) {
      if (seen.has(id)) continue; seen.add(id);
      const tok = await webhookToken();
      const steps: [number, "CONFIRMED" | "READY_TO_DELIVER" | "DISPATCHED" | "CONCLUDED"][] = [[3000, "CONFIRMED"], [9000, "READY_TO_DELIVER"], [15000, "DISPATCHED"], [24000, "CONCLUDED"]];
      for (const [ms, ev] of steps) setTimeout(() => req("POST", `/webhooks/saipos/${SLUG}/sto_leblon?token=${tok}`, saipos.event(id, ev)), ms);
      void o;
    }
  }, 1000);

  return {
    transport: req,
    slug: SLUG,
    saipos,
    clock: { offsetTo: (d) => { fixedNow = d; fixedAt = performance.now(); } },
    async customerToken(kind) {
      const cs = await db.list<Customer & { id: string }>("customers", T);
      const nowD = now();
      const days = (c: Customer) => (c.lastOrderAt ? (+nowD - +new Date(c.lastOrderAt)) / 864e5 : 999);
      const pick = kind === "recorrente" ? cs.filter((c) => c.orders >= 4 && days(c) < 25).sort((a, b) => b.orders - a.orders)[0] : cs.filter((c) => c.orders >= 2 && days(c) > 46).sort((a, b) => b.spent - a.spent)[0];
      if (!pick) return null;
      const orders = await db.list<Order & { id: string }>("orders", T, { where: { customerId: pick.id }, limit: 1 });
      void orders;
      return signCustomer({ cid: pick.id, tid: T }, deps.jwtSecret);
    },
  };
}
