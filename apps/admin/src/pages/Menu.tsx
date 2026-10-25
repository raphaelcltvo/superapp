import { useMemo, useState } from "react";
import { DIET_TAGS, availabilityLabel, leadTimeLabel, measureLabel, pricePerMeasure, suggestBasePrice, tagLabel, type Category, type Item, type ItemKind, type Measure, type OptionGroup, type Preset, type Weekday } from "@cw/core";
import { BRL, Btn, Chips, ConfirmBtn, Drawer, Empty, Field, MediaInput, Num, Pill, Select, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";

const KIND: Record<ItemKind, { label: string; hint: string }> = {
  simple: { label: "Simples", hint: "Preço fixo, sem montar" },
  buildable: { label: "Montável", hint: "Preço base = combinação mais barata; meio a meio cobra a diferença" },
  combo: { label: "Combo", hint: "Preço fechado; complementos só somam o que tiverem de acréscimo" },
  offer: { label: "Oferta / Imbatível", hint: "Preço fechado, nunca aplica meio a meio" },
};

export function MenuPage() {
  const { api, dirty } = useAdmin();
  const cats = useLoad<Category[]>("/admin/categories");
  const items = useLoad<Item[]>("/admin/items");
  const groups = useLoad<OptionGroup[]>("/admin/option_groups");
  const [editItem, setEditItem] = useState<Partial<Item> | null>(null);
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const [q, setQ] = useState("");
  const { run } = useAction();
  const G = useMemo(() => Object.fromEntries((groups.data || []).map((g) => [g.id, g])), [groups.data]);
  const reload = () => { cats.reload(); items.reload(); dirty(); };
  const move = async (list: { id: string }[], i: number, d: number, path: string) => {
    const ids = list.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(() => api.post(path, { ids })); reload();
  };
  const filtered = (cid: string) => (items.data || []).filter((i) => i.categoryId === cid && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  return <>
    <div className="pagehead">
      <div><h1>Itens e categorias</h1><p>Combos e Imbatíveis ficam em categorias de preço fechado. Itens montáveis calculam o preço base pela combinação mais barata e cobram a diferença de cada metade.</p></div>
      <div className="row"><input type="text" placeholder="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} aria-label="Buscar item" /><Btn onClick={() => setEditCat({ name: "", visible: true, position: (cats.data || []).length })}>Nova categoria</Btn><Btn kind="primary" onClick={() => setEditItem({ name: "", kind: "simple", price: 0, groupIds: [], active: true, available: true, position: (items.data || []).length, categoryId: cats.data?.[0]?.id })}>Novo item</Btn></div>
    </div>
    {(cats.data || []).map((c, ci) => <section key={c.id} className="panel">
      <header>
        <div className="row"><h2>{c.name}</h2>{c.pricingLocked && <Pill tone="accent">preço fechado</Pill>}{!c.visible && <Pill tone="warn">oculta</Pill>}</div>
        <div className="row"><Btn sm kind="ghost" onClick={() => move(cats.data!, ci, -1, "/admin/categories/reorder")} title="Subir">↑</Btn><Btn sm kind="ghost" onClick={() => move(cats.data!, ci, 1, "/admin/categories/reorder")} title="Descer">↓</Btn><Btn sm onClick={() => setEditCat(c)}>Editar</Btn></div>
      </header>
      {filtered(c.id).length ? <div className="list">{filtered(c.id).map((it, ii, arr) => {
        const gs = it.groupIds.map((g) => G[g]).filter(Boolean);
        const wrong = it.kind === "buildable" && Math.abs(suggestBasePrice(it, gs) - it.price) > 0.009;
        const img = it.imageUrl || (it.heroOptionNames?.[0] && gs.flatMap((g) => g.options).find((o) => o.name === it.heroOptionNames![0])?.imageUrl);
        return <div key={it.id} className="li click" onClick={() => setEditItem(it)} role="button" tabIndex={0}>
          {img ? <img className="thumb" src={img} alt="" /> : <span className="thumb" />}
          <div className="grow"><b>{it.name}</b><span className="small muted">{KIND[it.kind].label} · {gs.map((g) => g.name).join(", ") || "sem complementos"}{it.integrationCode && <> · PDV <span className="mono">{it.integrationCode}</span></>}</span></div>
          {it.leadTimeHours ? <Pill tone="accent">encomenda {it.leadTimeHours} h</Pill> : null}
          {it.availability && <Pill>{availabilityLabel(it.availability)}</Pill>}
          {(it.tags || []).filter((t) => DIET_TAGS.some((d) => d.id === t)).slice(0, 2).map((t) => <Pill key={t} tone="good">{tagLabel(t)}</Pill>)}
          {wrong && <Pill tone="bad">preço base errado</Pill>}
          {!it.active && <Pill>desativado</Pill>}{it.active && !it.available && <Pill tone="warn">esgotado</Pill>}
          <span className="num" style={{ fontWeight: 650, textAlign: "right" }}>{it.kind === "buildable" ? "a partir de " : ""}{BRL(it.price)}{it.measure && <span className="small muted" style={{ display: "block", fontWeight: 400 }}>{measureLabel(it.measure)}{pricePerMeasure(it.price, it.measure) ? ` · ${pricePerMeasure(it.price, it.measure)}` : ""}</span>}</span>
          <span className="row" onClick={(e) => e.stopPropagation()}><Btn sm kind="ghost" onClick={() => move(arr, ii, -1, "/admin/items/reorder")} title="Subir">↑</Btn><Btn sm kind="ghost" onClick={() => move(arr, ii, 1, "/admin/items/reorder")} title="Descer">↓</Btn></span>
        </div>;
      })}</div> : <Empty title="Nenhum item nesta categoria" />}
    </section>)}
    {editCat && <CategoryEditor cat={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); reload(); }} />}
    {editItem && <ItemEditor item={editItem} cats={cats.data || []} groups={groups.data || []} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); reload(); }} />}
  </>;
}

function CategoryEditor(p: { cat: Partial<Category>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const [c, setC] = useState(p.cat);
  const save = async () => { const r = await run(() => (c.id ? api.put(`/admin/categories/${c.id}`, c) : api.post("/admin/categories", c)), "Categoria salva"); if (r) p.onSaved(); };
  return <Drawer title={c.id ? "Editar categoria" : "Nova categoria"} onClose={p.onClose} footer={<>{c.id ? <ConfirmBtn label="Excluir" confirm="Excluir a categoria?" onConfirm={async () => { await run(() => api.del(`/admin/categories/${c.id}`), "Excluída"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar</Btn></>}>
    <Field label="Nome"><Text id="cat-name" value={c.name} onChange={(v) => setC({ ...c, name: v })} /></Field>
    <Field label="Descrição" hint="Aparece abaixo do título da categoria"><Text id="cat-desc" value={c.description} onChange={(v) => setC({ ...c, description: v })} /></Field>
    <Toggle checked={!!c.visible} onChange={(v) => setC({ ...c, visible: v })} label="Visível no cardápio" />
    <Toggle checked={!!c.pricingLocked} onChange={(v) => setC({ ...c, pricingLocked: v })} label="Preço fechado (combos, ofertas, Imbatíveis): nunca aplica meio a meio" />
  </Drawer>;
}

function ItemEditor(p: { item: Partial<Item>; cats: Category[]; groups: OptionGroup[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const [it, setIt] = useState<Partial<Item>>(p.item);
  const G = Object.fromEntries(p.groups.map((g) => [g.id, g]));
  const gs = (it.groupIds || []).map((g) => G[g]).filter(Boolean);
  const suggested = it.kind === "buildable" ? suggestBasePrice(it as Item, gs) : undefined;
  const set = (k: Partial<Item>) => setIt({ ...it, ...k });
  const save = async () => {
    const body = { ...it, price: Number(it.price || 0) };
    const r = await run(() => (it.id ? api.put(`/admin/items/${it.id}`, body) : api.post("/admin/items", body)), "Item salvo");
    if (r) p.onSaved();
  };
  const allOptNames = gs.flatMap((g) => g.options.filter((o) => o.imageUrl).map((o) => o.name));
  return <Drawer title={it.id ? it.name : "Novo item"} onClose={p.onClose} footer={<>{it.id ? <ConfirmBtn label="Excluir item" confirm="Excluir de vez?" onConfirm={async () => { await run(() => api.del(`/admin/items/${it.id}`), "Item excluído"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar item</Btn></>}>
    <div className="grid2">
      <Field label="Nome" wide><Text id="it-name" value={it.name} onChange={(v) => set({ name: v })} /></Field>
      <Field label="Descrição" wide><textarea id="it-desc" value={it.description || ""} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label="Categoria"><Select id="it-cat" value={it.categoryId || ""} onChange={(v) => set({ categoryId: v })} options={p.cats.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <Field label="Tipo" hint={KIND[(it.kind || "simple") as ItemKind].hint}><Select id="it-kind" value={(it.kind || "simple") as ItemKind} onChange={(v) => set({ kind: v })} options={Object.entries(KIND).map(([value, k]) => ({ value: value as ItemKind, label: k.label }))} /></Field>
      <Field label={it.kind === "buildable" ? "Preço base" : "Preço"} hint={suggested !== undefined ? `Combinação mais barata: ${BRL(suggested)}` : undefined}>
        <div className="row" style={{ flexWrap: "nowrap" }}><Num id="it-price" value={it.price} onChange={(v) => set({ price: v ?? 0 })} />{suggested !== undefined && Math.abs(suggested - (it.price || 0)) > 0.009 && <Btn sm onClick={() => set({ price: suggested })}>Usar</Btn>}</div>
      </Field>
      <Field label="Preço “de” (riscado)" hint="Opcional: mostra a economia"><Num id="it-compare" value={it.compareAt} onChange={(v) => set({ compareAt: v })} /></Field>
      <Field label="Código PDV (SAIPOS)"><Text id="it-pdv" mono value={it.integrationCode} onChange={(v) => set({ integrationCode: v })} /></Field>
    </div>
    <div className="row"><Toggle checked={it.active !== false} onChange={(v) => set({ active: v })} label="Ativo" /><Toggle checked={it.available !== false} onChange={(v) => set({ available: v })} label="Disponível (desligue para esgotar)" /><Toggle checked={!!it.isDrink} onChange={(v) => set({ isDrink: v })} label="É bebida" /></div>
    <SaleRules it={it} set={set} />
    <section className="panel">
      <header><h3>Complementos</h3><p>A ordem aqui é a ordem no item</p></header>
      <Chips value={it.groupIds || []} onChange={(v) => set({ groupIds: v })} options={p.groups.map((g) => ({ value: g.id, label: `${g.name} · ${g.rule === "fraction" ? "meio a meio" : `${g.min}–${g.max}`}` }))} />
    </section>
    <section className="panel">
      <header><h3>Foto</h3><p>Use uma foto própria ou componha meio a meio com as fotos dos sabores</p></header>
      <MediaInput id="it-photo" value={it.imageUrl} accept="image/*" onChange={(url) => set({ imageUrl: url })} />
      {allOptNames.length > 0 && <div className="grid2">
        <Field label="Metade esquerda"><Select value={it.heroOptionNames?.[0] || ""} onChange={(v) => set({ heroOptionNames: [v, it.heroOptionNames?.[1] || v].filter(Boolean) })} options={[{ value: "", label: "—" }, ...allOptNames.map((n) => ({ value: n, label: n }))]} /></Field>
        <Field label="Metade direita"><Select value={it.heroOptionNames?.[1] || ""} onChange={(v) => set({ heroOptionNames: [it.heroOptionNames?.[0] || v, v].filter(Boolean) })} options={[{ value: "", label: "—" }, ...allOptNames.map((n) => ({ value: n, label: n }))]} /></Field>
      </div>}
    </section>
    {gs.length > 0 && <Presets presets={it.presets || []} groups={gs} onChange={(v) => set({ presets: v })} />}
  </Drawer>;
}

/** Combinações prontas ("1 toque e pronto") dentro do item. */
function Presets(p: { presets: Preset[]; groups: OptionGroup[]; onChange: (v: Preset[]) => void }) {
  const upd = (i: number, x: Partial<Preset>) => p.onChange(p.presets.map((y, j) => (j === i ? { ...y, ...x } : y)));
  return <section className="panel">
    <header><h3>Combinações prontas</h3><p>Aparecem no topo do item como “Mais pedidos aqui”</p></header>
    {p.presets.map((pr, i) => <div key={pr.id} className="stack" style={{ borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 12 : 0 }}>
      <div className="grid2"><Field label="Selo"><Text value={pr.label} onChange={(v) => upd(i, { label: v })} /></Field><Field label="Título"><Text value={pr.title} onChange={(v) => upd(i, { title: v })} /></Field></div>
      {p.groups.map((g) => <Field key={g.id} label={g.name}><Chips value={Object.entries(pr.selection[g.id] || {}).flatMap(([id, q]) => Array(q).fill(id))} onChange={(ids) => { const s: Record<string, number> = {}; for (const id of ids) s[id] = (s[id] || 0) + 1; upd(i, { selection: { ...pr.selection, [g.id]: s } }); }} options={g.options.filter((o) => o.active).map((o) => ({ value: o.id, label: o.name }))} /></Field>)}
      <div><Btn sm kind="danger" onClick={() => p.onChange(p.presets.filter((_, j) => j !== i))}>Remover combinação</Btn></div>
    </div>)}
    <div><Btn sm onClick={() => p.onChange([...p.presets, { id: "p" + Date.now(), label: "#1 · mais pedido", title: "", selection: {} }])}>Adicionar combinação</Btn></div>
  </section>;
}

const UNITS: { value: Measure["unit"]; label: string }[] = [{ value: "g", label: "gramas" }, { value: "kg", label: "kg" }, { value: "ml", label: "ml" }, { value: "l", label: "litros" }, { value: "un", label: "unidades" }];
const WDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Particularidades de venda que valem para qualquer culinária: medida, encomenda, janela de venda e selos. */
function SaleRules(p: { it: Partial<Item>; set: (k: Partial<Item>) => void }) {
  const { it, set } = p;
  const av = it.availability || {};
  const setAv = (x: Partial<NonNullable<Item["availability"]>>) => { const n = { ...av, ...x }; const empty = !n.weekdays?.length && !n.from && !n.to; set({ availability: empty ? undefined : n }); };
  const per = pricePerMeasure(it.price || 0, it.measure);
  return <section className="panel">
    <header><h3>Como é vendido</h3><p>Medida, encomenda, dias de venda e selos. Use o que fizer sentido para o item.</p></header>
    <div className="grid3">
      <Field label="Quantidade vendida" hint={per ? `Cliente vê ${per}` : "Ex.: 500 g, 350 ml, 12 un"}>
        <div className="row" style={{ flexWrap: "nowrap" }}><Num id="it-measure" value={it.measure?.amount} onChange={(v) => set({ measure: v ? { unit: it.measure?.unit || "g", amount: v } : undefined })} /><Select value={it.measure?.unit || "g"} onChange={(u) => set({ measure: it.measure ? { ...it.measure, unit: u } : undefined })} options={UNITS} /></div>
      </Field>
      <Field label="Encomenda: antecedência (horas)" hint={it.leadTimeHours ? leadTimeLabel(it.leadTimeHours) : "Vazio = sai na hora"}><Num id="it-lead" value={it.leadTimeHours} onChange={(v) => set({ leadTimeHours: v || undefined })} /></Field>
      <Field label="Serve" hint="Usado na triagem “pra quantas pessoas?”"><Text value={it.serves} placeholder="serve 2" onChange={(v) => set({ serves: v || undefined })} /></Field>
    </div>
    <Field label="Dias de venda" hint={av.weekdays?.length ? "Fora desses dias aparece como “volta …”" : "Todos os dias"}><Chips value={(av.weekdays || []) as Weekday[]} onChange={(v) => setAv({ weekdays: v.length ? (v as Weekday[]).sort() : undefined })} options={WDAYS.map((l, i) => ({ value: i as Weekday, label: l }))} /></Field>
    <div className="grid2">
      <Field label="Vende a partir de" hint="hh:mm"><Text id="it-from" value={av.from} placeholder="11:00" onChange={(v) => setAv({ from: /^\d{2}:\d{2}$/.test(v) ? v : v ? av.from : undefined })} /></Field>
      <Field label="Vende até" hint="hh:mm"><Text id="it-to" value={av.to} placeholder="15:00" onChange={(v) => setAv({ to: /^\d{2}:\d{2}$/.test(v) ? v : v ? av.to : undefined })} /></Field>
    </div>
    <Field label="Selos" hint="Viram filtros no cardápio"><Chips value={(it.tags || []).filter((t) => DIET_TAGS.some((d) => d.id === t))} onChange={(v) => set({ tags: [...(it.tags || []).filter((t) => !DIET_TAGS.some((d) => d.id === t)), ...v] })} options={DIET_TAGS.map((d) => ({ value: d.id, label: d.label }))} /></Field>
  </section>;
}
