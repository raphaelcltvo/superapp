// Gera cardapio.json a partir da leitura do iFood da Forneria Original Pizza - Barra (24/10/2026).
// Entrada: itens.txt, grupos.txt, opcoes.txt (extraídos da página pública da loja).
// Uso: node apps/api/src/seed/ifood-barra/gerar.mjs
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL(".", import.meta.url);
const lines = (f) => readFileSync(new URL(f, dir), "utf8").split("\n").filter(Boolean);
const fix = (s) => s.replace(/＝/g, "=").replace(/？/g, "?").replace(/＆/g, "&").trim();
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "e").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (s) => (s === "" ? null : Number(s));

/* ---------- leitura ---------- */
const items = lines("itens.txt").map((l) => { const [i, cat, id, name, details, price, min, orig, logo, avail, need] = l.split("|"); return { i: Number(i), cat: fix(cat), ifoodId: id, name: fix(name), details: fix(details), price: num(price), min: num(min), orig: num(orig), logo, need: need === "1", groups: [] }; });
const opts = Object.fromEntries(lines("opcoes.txt").map((l) => { const [i, name, details] = l.split("|"); return [Number(i), { name: fix(name), details: fix(details || "") }]; }));
const groups = {};
for (const l of lines("grupos.txt")) {
  const p = l.split("|");
  if (p[0] === "g") {
    const gi = Number(p[1]); const g = (groups[gi] ||= { gi, name: fix(p[2]), min: Number(p[3]), max: Number(p[4]), options: [] });
    for (const ref of p[6].split(",")) { const [oi, pr] = ref.split(":"); g.options.push({ ...opts[Number(oi)], price: Number(pr) }); }
  } else if (p[0] === "i") {
    for (const pair of p[1].split(" ")) { const [ii, gs] = pair.split(":"); items.find((x) => x.i === Number(ii)).groups = gs ? gs.split(",").map(Number) : []; }
  }
}

/* ---------- limpeza de nomes ---------- */
const cleanOpt = (n) => n.replace(/^1\/2\s+/, "").replace(/\s*-\s*2ªpizza$/i, "").replace(/\s*-\s*20cm$/i, "").trim();
const cleanItem = (n) => n.replace(/\s*-\s*Hits$/i, "").replace(/\s*-\s*(\d+cm)/, " · $1").replace(/\s+-\s+30m$/, " · 30cm").replace(/\.$/, "").trim();
const desc = (d) => d.replace(/^\((.*)\)\.?$/, "$1").replace(/^-\s*/, "").trim() || undefined;

/* ---------- categorias (mesma ordem do iFood) ---------- */
const CAT = {
  "I M B A T Í V E I S": { id: "cat_imbat", name: "Imbatíveis", locked: true },
  "Mais pedidos!": { id: "cat_combos", name: "Mais pedidos", locked: true },
  "Pizzas Salgadas": { id: "cat_salg", name: "Pizzas salgadas" },
  "Pizzas Doces": { id: "cat_doces", name: "Pizzas doces" },
  "Pizzas Veganas": { id: "cat_veganas", name: "Pizzas veganas" },
  "Bebidas Industrializadas": { id: "cat_bebidas", name: "Bebidas", description: "1,5l sai por R$ 9,33/L; a lata, R$ 25,43/L" },
  "Produtos Originais ;D": { id: "cat_originais", name: "Produtos Originais" },
  "Hits": { id: "cat_hits", name: "Hits", locked: true },
  "Adicional": { id: "cat_adicionais", name: "Adicionais" },
  "Até 50% Off com ifood": { id: "cat_ofertas", name: "Ofertas da semana", locked: true },
  "Vinhos": { id: "cat_vinhos", name: "Vinhos" },
};
const categories = Object.values(CAT).map((c, position) => ({ id: c.id, name: c.name, slug: slug(c.name), position, visible: true, pricingLocked: !!c.locked, ...(c.description ? { description: c.description } : {}) }));

/* ---------- itens que já existem no seed (mantêm id, grupos e regra validada) ---------- */
const KEEP = { 0: "m3", 1: "m2", 2: "m1", 3: "m4", 4: "m5", 5: "m6", 7: "c1", 8: "c2", 9: "c3", 15: "s40", 74: "d1", 75: "d2", 77: "d3", 78: "d4", 26: "b2", 27: "b3", 28: "b1", 32: "b4", 35: "b6" };
// 17 (40cm com borda) é o mesmo s40: a borda é escolhida na massa. 18 (30cm com borda) idem para s30.
// Os duplicados idênticos da categoria Hits (mesmo nome e preço) entram uma vez só.
const SKIP = new Set([17, 18]);

/* ---------- grupos: frações (meio a meio) viram regra "fraction" nos itens montáveis ---------- */
const outGroups = []; const gid = {};
const isHalves = (g) => g.min === 2 && g.max === 2 && g.options.filter((o) => /^1\/2\s/.test(o.name)).length >= g.options.length * 0.8;
function groupFor(gi, asFraction) {
  const key = `${gi}:${asFraction ? "f" : "s"}`; if (gid[key]) return gid[key];
  const g = groups[gi]; const id = `ig${gi}${asFraction ? "f" : ""}`;
  const seen = new Set();
  const options = g.options.map((o) => {
    const name = cleanOpt(o.name); let oid = slug(name).slice(0, 40); while (seen.has(oid)) oid += "-2"; seen.add(oid);
    return asFraction ? { id: oid, name, description: desc(o.details), price: 0, fullPrice: Math.round(o.price * 2 * 100) / 100 } : { id: oid, name, description: desc(o.details), price: o.price };
  });
  const out = { id, name: g.name.replace(/[.:]$/, ""), min: g.min, max: g.max, rule: asFraction ? "fraction" : "sum", allowRepeat: g.min === 2 && g.max === 2, options };
  if (/bebida|refri/i.test(g.name)) out.liters = 1.5;
  outGroups.push(out); gid[key] = id; return id;
}
// 30cm montável: s30 = "Pizza 30cm até 2 sabores" com a massa que já inclui as bordas (+26)
const S30_GROUPS = ["g_massa30", 23];

/* ---------- itens ---------- */
const outItems = []; const report = [];
const seenHits = new Set();
for (const it of items) {
  if (!it.cat) continue;
  const c = CAT[it.cat]; if (!c) { report.push(`sem categoria: ${it.name}`); continue; }
  if (SKIP.has(it.i)) continue;
  if (it.cat === "Hits") { const k = it.name + it.min; if (seenHits.has(k)) continue; seenHits.add(k); }
  const keep = KEEP[it.i];
  const groupsIdx = it.i === 16 ? S30_GROUPS : it.groups;
  const buildable = !c.locked && groupsIdx.some((g) => typeof g === "number" && isHalves(groups[g]));
  const groupIds = groupsIdx.map((g) => (typeof g === "string" ? g : groupFor(g, (buildable || it.i === 16) && isHalves(groups[g]))));
  // preço: montável = mínimo cheio (combinação mais barata); demais = preço do iFood + opções
  let price = it.price ?? 0;
  if (buildable) {
    const fr = outGroups.filter((g) => groupIds.includes(g.id) && g.rule === "fraction");
    price = (it.price ?? 0) + fr.reduce((a, g) => a + Math.min(...g.options.map((o) => o.fullPrice)), 0);
  }
  // fotos: sabores do item (meio a meio) ou o próprio nome
  const flavorGroup = outGroups.find((g) => groupIds.includes(g.id) && g.min === 2 && g.max === 2);
  const oneFlavor = outGroups.find((g) => groupIds.includes(g.id) && g.max === 1 && g.min === 1 && /sabor|pizza|doce|vegan|predileta/i.test(g.name));
  const m = it.name.match(/^1\/2\s+(.+?)\s*\+?\s*1\/2\s+(.+?)\s+-\s*\d+cm$/);
  const single = cleanOpt(it.name.replace(/^Pizza\s+/, "").replace(/\s*-\s*\d+c?m.*$/i, "").replace(/\s*-\s*hits$/i, ""));
  const pizzaOne = c.locked && /\d+\s?c?m/i.test(it.name) && !/duas|\+|combo|hits \d|salgada hits|ate dois|até dois|20cm/i.test(it.name);
  const hero = m ? [m[1].trim(), m[2].trim()] : flavorGroup ? [flavorGroup.options[0].name, flavorGroup.options[1]?.name || flavorGroup.options[0].name] : pizzaOne ? [single, single] : undefined;
  // montável só quando há meio a meio; grupos de soma com preço ficam em "simple" (o preço do item + o que escolher)
  const kind = buildable ? "buildable" : c.locked ? (it.cat === "Mais pedidos!" || /duas|combo|\+/i.test(it.name) ? "combo" : "offer") : "simple";
  const drink = it.cat === "Bebidas Industrializadas";
  const liters = drink ? (/1[,.]5\s?l/i.test(it.name) ? 1.5 : /(\d{3})ml/i.test(it.name) ? Number(it.name.match(/(\d{3})ml/i)[1]) / 1000 : undefined) : undefined;
  outItems.push({
    keepId: keep, ifoodId: it.ifoodId, categoryId: c.id, name: it.i === 16 ? "Pizza 30cm até 2 sabores" : cleanItem(it.name),
    description: it.i === 16 ? "Monte sua pizza média (30cm) com até dois sabores salgados. Meio a meio cobra a média dos dois sabores; a borda recheada é escolhida na massa." : desc(it.details),
    kind, price: Math.round(price * 100) / 100, ...(it.orig ? { compareAt: it.orig } : {}), groupIds,
    ...(hero ? { heroOptionNames: hero } : !groupIds.length && !drink ? { photoName: single } : oneFlavor ? { photoName: oneFlavor.options[0].name } : {}),
    ...(drink ? { isDrink: true, ...(liters ? { liters } : {}) } : {}),
    ...(it.i === 16 ? { s30: true } : {}),
  });
}
writeFileSync(new URL("cardapio.json", dir), JSON.stringify({ fonte: "iFood · Forneria Original Pizza - Barra · lido em 24/10/2026", categories, groups: outGroups, items: outItems }, null, 1));
console.log(`categorias ${categories.length} · grupos ${outGroups.length} · opções ${outGroups.reduce((a, g) => a + g.options.length, 0)} · itens ${outItems.length} (mantidos ${outItems.filter((x) => x.keepId).length})`);
if (report.length) console.log(report.join("\n"));
// conferência: preços cheios do 40cm (iFood ×2) contra a tabela validada do seed (S40)
const g3 = outGroups.find((g) => g.id === "ig3f") || { options: groups[3].options.map((o) => ({ name: cleanOpt(o.name), fullPrice: o.price * 2 })) };
console.log("40cm iFood (inteira):", g3.options.map((o) => `${o.name} ${o.fullPrice}`).join("; "));
