import { useState } from "react";
import type { Coupon, Item, Page, PageBlock } from "@cw/core";
import { Bars } from "../charts";
import { Btn, Chips, ConfirmBtn, Drawer, Empty, Field, MediaInput, Pill, Select, Tabs, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";
import { LinkPicker } from "./Showcase";

const BLOCKS: { kind: PageBlock["kind"]; label: string; make: () => PageBlock }[] = [
  { kind: "hero", label: "Capa (imagem ou vídeo)", make: () => ({ kind: "hero", media: { kind: "image", url: "", alt: "" }, title: "" }) },
  { kind: "text", label: "Texto", make: () => ({ kind: "text", title: "", text: "" }) },
  { kind: "items", label: "Itens do cardápio", make: () => ({ kind: "items", title: "", itemIds: [] }) },
  { kind: "coupon", label: "Cupom", make: () => ({ kind: "coupon", couponId: "", text: "" }) },
  { kind: "nps", label: "Pergunta NPS (0 a 10)", make: () => ({ kind: "nps", id: "q" + Date.now().toString(36), question: "De 0 a 10, quanto você nos indicaria?" }) },
  { kind: "rating", label: "Nota de 1 a 5", make: () => ({ kind: "rating", id: "q" + Date.now().toString(36), question: "Como você avalia a qualidade?", scale: 5 }) },
  { kind: "choice", label: "Múltipla escolha", make: () => ({ kind: "choice", id: "q" + Date.now().toString(36), question: "", options: ["Opção A", "Opção B"] }) },
  { kind: "open", label: "Resposta aberta", make: () => ({ kind: "open", id: "q" + Date.now().toString(36), question: "" }) },
  { kind: "cta", label: "Botão", make: () => ({ kind: "cta", label: "Ver o cardápio", link: { kind: "none" } }) },
];
const LABEL = Object.fromEntries(BLOCKS.map((b) => [b.kind, b.label]));

export function PagesPage() {
  const pages = useLoad<Page[]>("/admin/pages");
  const { dirty } = useAdmin();
  const [edit, setEdit] = useState<Partial<Page> | null>(null);
  return <>
    <div className="pagehead"><div><h1>Páginas e pesquisas</h1><p>Abas próprias para campanhas (LP) e pesquisas de qualidade e NPS. Um banner ou uma automação de WhatsApp pode levar para elas.</p></div>
      <Btn kind="primary" onClick={() => setEdit({ title: "", slug: "", active: true, blocks: [] })}>Nova página</Btn></div>
    {(pages.data || []).length ? <div className="list">{pages.data!.map((p) => <div key={p.id} className="li click" onClick={() => setEdit(p)} role="button" tabIndex={0}>
      <div className="grow"><b>{p.title}</b><span className="small muted mono">/p/{p.slug} · {p.blocks.length} blocos</span></div>
      {p.blocks.some((b) => ["nps", "rating", "choice", "open"].includes(b.kind)) && <Pill tone="accent">pesquisa</Pill>}
      {p.active ? <Pill tone="good">no ar</Pill> : <Pill>rascunho</Pill>}<span className="muted">›</span></div>)}</div> : <Empty title="Nenhuma página ainda" />}
    {edit && <PageEditor page={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); pages.reload(); dirty(); }} />}
  </>;
}

function PageEditor(p: { page: Partial<Page>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const items = useLoad<Item[]>("/admin/items"); const coupons = useLoad<Coupon[]>("/admin/coupons");
  const [pg, setPg] = useState<Partial<Page>>(p.page);
  const [tab, setTab] = useState<"conteudo" | "respostas">("conteudo");
  const blocks = pg.blocks || [];
  const upd = (i: number, b: Partial<PageBlock>) => setPg({ ...pg, blocks: blocks.map((x, j) => (j === i ? ({ ...x, ...b } as PageBlock) : x)) });
  const mv = (i: number, d: number) => { const b = [...blocks]; const j = i + d; if (j < 0 || j >= b.length) return; [b[i], b[j]] = [b[j], b[i]]; setPg({ ...pg, blocks: b }); };
  const save = async () => { const body = { ...pg, slug: pg.slug || (pg.title || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") }; const r = await run(() => (pg.id ? api.put(`/admin/pages/${pg.id}`, body) : api.post("/admin/pages", body)), "Página salva"); if (r) p.onSaved(); };
  return <Drawer title={pg.id ? pg.title : "Nova página"} onClose={p.onClose} footer={<>{pg.id ? <ConfirmBtn label="Excluir" confirm="Excluir a página?" onConfirm={async () => { await run(() => api.del(`/admin/pages/${pg.id}`), "Excluída"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar página</Btn></>}>
    {pg.id && <Tabs value={tab} onChange={setTab} tabs={[{ value: "conteudo", label: "Conteúdo" }, { value: "respostas", label: "Respostas" }]} />}
    {tab === "respostas" && pg.id ? <Responses id={pg.id} /> : <>
      <div className="grid2">
        <Field label="Título"><Text id="pg-title" value={pg.title} onChange={(v) => setPg({ ...pg, title: v })} /></Field>
        <Field label="Endereço" hint="cardapio/marca/p/…"><Text id="pg-slug" mono value={pg.slug} onChange={(v) => setPg({ ...pg, slug: v })} /></Field>
        <Field label="Mensagem depois de responder" wide><Text value={pg.thankYou} onChange={(v) => setPg({ ...pg, thankYou: v })} /></Field>
      </div>
      <Toggle checked={pg.active !== false} onChange={(v) => setPg({ ...pg, active: v })} label="No ar" />
      {blocks.map((b, i) => <section key={i} className="panel">
        <header><h3>{LABEL[b.kind]}</h3><span className="row"><Btn sm kind="ghost" onClick={() => mv(i, -1)}>↑</Btn><Btn sm kind="ghost" onClick={() => mv(i, 1)}>↓</Btn><Btn sm kind="danger" onClick={() => setPg({ ...pg, blocks: blocks.filter((_, j) => j !== i) })}>Remover</Btn></span></header>
        {b.kind === "hero" && <><MediaInput value={b.media.url} onChange={(url, type) => upd(i, { media: { ...b.media, url, kind: type.startsWith("video") ? "video" : type === "image/gif" ? "gif" : "image" } })} /><Field label="Título"><Text value={b.title} onChange={(v) => upd(i, { title: v })} /></Field><Field label="Texto"><Text value={b.text} onChange={(v) => upd(i, { text: v })} /></Field></>}
        {b.kind === "text" && <><Field label="Título"><Text value={b.title} onChange={(v) => upd(i, { title: v })} /></Field><Field label="Texto"><textarea value={b.text} onChange={(e) => upd(i, { text: e.target.value })} /></Field></>}
        {b.kind === "items" && <><Field label="Título"><Text value={b.title} onChange={(v) => upd(i, { title: v })} /></Field><Chips value={b.itemIds} onChange={(v) => upd(i, { itemIds: v })} options={(items.data || []).map((x) => ({ value: x.id, label: x.name.split(" · ")[0] }))} /></>}
        {b.kind === "coupon" && <><Field label="Cupom"><Select value={b.couponId} onChange={(v) => upd(i, { couponId: v })} options={[{ value: "", label: "—" }, ...(coupons.data || []).map((c) => ({ value: c.id, label: `${c.code || "automático"} · ${c.name}` }))]} /></Field><Field label="Texto"><Text value={b.text} onChange={(v) => upd(i, { text: v })} /></Field></>}
        {(b.kind === "nps" || b.kind === "rating" || b.kind === "open" || b.kind === "choice") && <Field label="Pergunta"><Text value={b.question} onChange={(v) => upd(i, { question: v })} /></Field>}
        {b.kind === "choice" && <><Field label="Opções (separadas por vírgula)"><Text value={b.options.join(", ")} onChange={(v) => upd(i, { options: v.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field><Toggle checked={!!b.multiple} onChange={(v) => upd(i, { multiple: v })} label="Permite marcar várias" /></>}
        {b.kind === "cta" && <><Field label="Texto do botão"><Text value={b.label} onChange={(v) => upd(i, { label: v })} /></Field><LinkPicker value={b.link} onChange={(l) => upd(i, { link: l })} /></>}
      </section>)}
      <Field label="Adicionar bloco"><Select value={"" as string} onChange={(k) => { const B = BLOCKS.find((x) => x.kind === k); if (B) setPg({ ...pg, blocks: [...blocks, B.make()] }); }} options={[{ value: "", label: "Escolha o tipo…" }, ...BLOCKS.map((b) => ({ value: b.kind, label: b.label }))]} /></Field>
    </>}
  </Drawer>;
}

type Sum = { id: string; kind: string; question: string; n: number; nps?: number | null; promoters?: number; detractors?: number; avg?: number | null; counts?: Record<string, number>; last?: string[] };
function Responses(p: { id: string }) {
  const r = useLoad<{ responses: number; summary: Sum[] }>(`/admin/crm/pages/${p.id}/responses`);
  if (!r.data) return null;
  if (!r.data.responses) return <Empty title="Nenhuma resposta ainda" />;
  return <div className="stack">
    <p className="muted">{r.data.responses} respostas</p>
    {r.data.summary.map((s) => <section key={s.id} className="panel"><header><h3>{s.question}</h3><span className="small muted">{s.n} respostas</span></header>
      {s.kind === "nps" && <div className="row"><span style={{ fontFamily: "var(--f-display)", fontSize: 30, fontWeight: 700 }}>{s.nps}</span><span className="small muted">NPS = % promotores (9–10) − % detratores (0–6) · {s.promoters} promotores, {s.detractors} detratores</span></div>}
      {s.kind === "rating" && <span style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 700 }}>{s.avg?.toFixed(1).replace(".", ",")} <span className="small muted">de 5</span></span>}
      {s.kind === "choice" && s.counts && <Bars rows={Object.entries(s.counts).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} format={(v) => String(v)} />}
      {s.kind === "open" && <div className="stack small">{(s.last || []).map((t, i) => <p key={i} className="issue">{t}</p>)}</div>}
    </section>)}
  </div>;
}
