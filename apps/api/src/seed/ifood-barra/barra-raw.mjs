// Monta o cardápio da Forneria Original Pizza - Barra no formato cru do iFood (catálogo + detalhes de cada item),
// a partir da leitura de 24/10/2026 (itens.txt, grupos.txt, opcoes.txt). Função pura: usada pelo gerar-raw.mjs (gera raw.json
// para os testes) e pela demonstração (que importa os .txt, bem menores que o JSON).
const fix = (s) => s.replace(/＝/g, "=").replace(/？/g, "?").replace(/＆/g, "&").trim();
const num = (s) => (s === "" || s == null ? undefined : Number(s));

/** @param {{ itens: string; grupos: string; opcoes: string }} t */
export function buildRaw(t) {
  const lines = (s) => s.split("\n").filter(Boolean);
  const opts = Object.fromEntries(lines(t.opcoes).map((l) => { const [i, name, details] = l.split("|"); return [Number(i), { name: fix(name), details: fix(details || "") }]; }));
  const groups = {}; const itemGroups = {};
  for (const l of lines(t.grupos)) {
    const p = l.split("|");
    if (p[0] === "g") {
      const gi = Number(p[1]); const g = (groups[gi] ||= { gi, name: fix(p[2]), min: Number(p[3]), max: Number(p[4]), options: [] });
      for (const ref of p[6].split(",")) { const [oi, pr] = ref.split(":"); g.options.push({ oi: Number(oi), ...opts[Number(oi)], price: Number(pr) }); }
    } else if (p[0] === "i") {
      for (const pair of p[1].split(" ")) { const [ii, gs] = pair.split(":"); itemGroups[Number(ii)] = gs ? gs.split(",").map(Number) : []; }
    }
  }
  const menu = []; const details = {};
  for (const l of lines(t.itens)) {
    const [i, cat, id, name, det, price, min, orig, logo, avail, need] = l.split("|");
    if (!cat) continue;
    let c = menu.find((x) => x.name === fix(cat));
    if (!c) { c = { code: `cat${menu.length}`, name: fix(cat), itens: [] }; menu.push(c); }
    const item = { id, code: `it${i}`, description: fix(name), details: fix(det), logoUrl: logo || undefined, needChoices: need === "1", unitPrice: num(price) ?? 0, unitMinPrice: num(min) ?? num(price) ?? 0, availability: avail || "AVAILABLE" };
    if (num(orig) && num(orig) !== item.unitPrice) item.unitOriginalPrice = num(orig);
    c.itens.push(item);
    const gs = itemGroups[Number(i)] || [];
    if (gs.length) details[id] = { code: "00", data: { id, choices: gs.map((gi) => { const g = groups[gi]; return { code: `g${gi}`, name: g.name, min: g.min, max: g.max, garnishItens: g.options.map((o) => ({ id: `opt-${o.oi}`, code: `o${o.oi}`, description: o.name, details: o.details || undefined, unitPrice: o.price })) }; }) } };
  }
  // id da loja fictício (o link real não foi guardado na leitura)
  const mid = "5d4c3a2b-1f0e-4d9c-8b7a-6f5e4d3c2b1a";
  return { merchant: { id: mid, name: "Forneria Original Pizza - Barra", url: `https://www.ifood.com.br/delivery/rio-de-janeiro-rj/forneria-original-pizza---barra-barra-da-tijuca/${mid}` }, catalog: { code: "00", data: { menu } }, details };
}
