import { useState } from "react";
import type { Banner, BannerSlot, Category, HeroRule, Item, LinkTarget, MerchSettings, Page, ProfileKey, Segment, CrossSellRule } from "@cw/core";
import { Btn, Chips, ConfirmBtn, Drawer, Empty, Field, MediaInput, Num, Pill, Select, Tabs, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";

export const SLOTS: Record<BannerSlot, string> = { menu_top: "Em cima do cardápio", below_suggested: "Abaixo do card sugerido", bag: "Na sacola", after_order: "Depois do pedido" };
export const PROFILES: { value: ProfileKey; label: string }[] = [{ value: "novo", label: "Novo" }, { value: "recorrente", label: "Recorrente" }, { value: "familia", label: "Família" }, { value: "em_risco", label: "Em risco" }, { value: "qualquer", label: "Qualquer" }];
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((l, i) => ({ value: i, label: l }));

export function ShowcasePage() {
  const [tab, setTab] = useState<"banners" | "hero" | "ordem" | "sacola" | "comportamento">("banners");
  return <>
    <div className="pagehead"><div><h1>Vitrine e sugestões</h1><p>O que cada perfil vê primeiro: banners em movimento, o card sugerido, a ordem das categorias e as sugestões da sacola.</p></div></div>
    <Tabs value={tab} onChange={setTab} tabs={[{ value: "banners", label: "Banners" }, { value: "hero", label: "Card sugerido" }, { value: "ordem", label: "Ordem e mais pedidos" }, { value: "sacola", label: "Sugestões na sacola" }, { value: "comportamento", label: "Busca e comportamento" }]} />
    {tab === "banners" ? <Banners /> : <MerchEditor tab={tab} />}
  </>;
}

function Banners() {
  const banners = useLoad<Banner[]>("/admin/banners");
  const { dirty } = useAdmin();
  const [edit, setEdit] = useState<Partial<Banner> | null>(null);
  return <>
    <div className="row between"><p className="muted">Cada espaço mostra um banner por vez. Empate de prioridade vira teste A/B pelo peso.</p><Btn kind="primary" onClick={() => setEdit({ name: "", slot: "menu_top", media: { kind: "image", url: "", alt: "" }, link: { kind: "none" }, audience: {}, priority: 1, weight: 1, active: true })}>Novo banner</Btn></div>
    {(Object.keys(SLOTS) as BannerSlot[]).map((slot) => {
      const list = (banners.data || []).filter((b) => b.slot === slot);
      return <section key={slot} className="panel"><header><h3>{SLOTS[slot]}</h3><span className="small muted">{list.filter((b) => b.active).length} ativo(s)</span></header>
        {list.length ? <div className="grid3">{list.map((b) => <button key={b.id} className="panel" style={{ cursor: "pointer", textAlign: "left", padding: 10 }} onClick={() => setEdit(b)}>
          <div className="media-prev">{b.media.kind === "video" ? <video src={b.media.url} poster={b.media.posterUrl} muted autoPlay loop playsInline /> : b.media.url ? <img src={b.media.url} alt={b.media.alt} /> : null}</div>
          <b>{b.name}</b>
          <span className="row small">{b.active ? <Pill tone="good">ativo</Pill> : <Pill>pausado</Pill>}<Pill>{b.media.kind === "video" ? "vídeo" : b.media.kind === "gif" ? "GIF" : "imagem"}</Pill>{(b.audience.profiles || []).map((p) => <Pill key={p} tone="accent">{p}</Pill>)}</span>
        </button>)}</div> : <Empty title="Nenhum banner neste espaço" />}
      </section>;
    })}
    {edit && <BannerEditor b={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); banners.reload(); dirty(); }} />}
  </>;
}

export function LinkPicker(p: { value: LinkTarget; onChange: (l: LinkTarget) => void }) {
  const items = useLoad<Item[]>("/admin/items"); const cats = useLoad<Category[]>("/admin/categories"); const pages = useLoad<Page[]>("/admin/pages");
  const kind = p.value.kind;
  return <div className="grid2">
    <Field label="Ao tocar, leva para"><Select value={kind} onChange={(k) => p.onChange(k === "item" ? { kind: "item", itemId: items.data?.[0]?.id || "" } : k === "category" ? { kind: k, categoryId: cats.data?.[0]?.id || "" } : k === "page" ? { kind: k, pageId: pages.data?.[0]?.id || "" } : k === "url" ? { kind: k, url: "https://" } : { kind: "none" })} options={[{ value: "item", label: "Um item" }, { value: "category", label: "Uma categoria" }, { value: "page", label: "Uma página (LP ou pesquisa)" }, { value: "url", label: "Um link externo" }, { value: "none", label: "Nada" }]} /></Field>
    {p.value.kind === "item" && <Field label="Item"><Select value={p.value.itemId} onChange={(v) => p.onChange({ kind: "item", itemId: v })} options={(items.data || []).map((i) => ({ value: i.id, label: i.name }))} /></Field>}
    {p.value.kind === "category" && <Field label="Categoria"><Select value={p.value.categoryId} onChange={(v) => p.onChange({ kind: "category", categoryId: v })} options={(cats.data || []).map((i) => ({ value: i.id, label: i.name }))} /></Field>}
    {p.value.kind === "page" && <Field label="Página"><Select value={p.value.pageId} onChange={(v) => p.onChange({ kind: "page", pageId: v })} options={(pages.data || []).map((i) => ({ value: i.id, label: i.title }))} /></Field>}
    {p.value.kind === "url" && <Field label="Endereço"><Text type="url" value={p.value.url} onChange={(v) => p.onChange({ kind: "url", url: v })} /></Field>}
  </div>;
}

function BannerEditor(p: { b: Partial<Banner>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const segs = useLoad<Segment[]>("/admin/segments");
  const [b, setB] = useState<Partial<Banner>>(p.b);
  const a = b.audience || {};
  const save = async () => { const r = await run(() => (b.id ? api.put(`/admin/banners/${b.id}`, b) : api.post("/admin/banners", b)), "Banner salvo"); if (r) p.onSaved(); };
  return <Drawer title={b.id ? b.name : "Novo banner"} onClose={p.onClose} footer={<>{b.id ? <ConfirmBtn label="Excluir" confirm="Excluir banner?" onConfirm={async () => { await run(() => api.del(`/admin/banners/${b.id}`), "Excluído"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar banner</Btn></>}>
    <div className="grid2">
      <Field label="Nome interno"><Text id="bn-name" value={b.name} onChange={(v) => setB({ ...b, name: v })} /></Field>
      <Field label="Espaço"><Select id="bn-slot" value={(b.slot || "menu_top") as BannerSlot} onChange={(v) => setB({ ...b, slot: v })} options={(Object.keys(SLOTS) as BannerSlot[]).map((s) => ({ value: s, label: SLOTS[s] }))} /></Field>
    </div>
    <Field label="Imagem, GIF ou vídeo" hint="Vídeo toca sem som e em loop. Proporção sugerida 12:5 (720×300).">
      <MediaInput id="bn-media" value={b.media?.url} onChange={(url, type) => setB({ ...b, media: { ...(b.media || { alt: "" }), url, kind: type.startsWith("video") ? "video" : type === "image/gif" ? "gif" : "image" } as Banner["media"] })} />
    </Field>
    {b.media?.kind === "video" && <Field label="Capa do vídeo (antes de carregar)"><MediaInput value={b.media.posterUrl} accept="image/*" onChange={(url) => setB({ ...b, media: { ...b.media!, posterUrl: url } })} /></Field>}
    <div className="grid2">
      <Field label="Texto alternativo" hint="Lido por leitores de tela"><Text id="bn-alt" value={b.media?.alt} onChange={(v) => setB({ ...b, media: { ...b.media!, alt: v } })} /></Field>
      <Field label="Chamada (opcional)"><Text id="bn-head" value={b.headline} onChange={(v) => setB({ ...b, headline: v })} /></Field>
    </div>
    <LinkPicker value={b.link || { kind: "none" }} onChange={(l) => setB({ ...b, link: l })} />
    <section className="panel"><header><h3>Quem vê</h3><p>Vazio = todo mundo</p></header>
      <Field label="Perfis"><Chips value={a.profiles || []} onChange={(v) => setB({ ...b, audience: { ...a, profiles: v } })} options={PROFILES} /></Field>
      <Field label="Segmentos do CRM"><Chips value={a.segmentIds || []} onChange={(v) => setB({ ...b, audience: { ...a, segmentIds: v } })} options={(segs.data || []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
      <Field label="Origem da visita" hint="utm_source: instagram, google, whatsapp…"><Text value={(a.sources || []).join(", ")} onChange={(v) => setB({ ...b, audience: { ...a, sources: v.split(",").map((x) => x.trim()).filter(Boolean) } })} /></Field>
      <Field label="Dias"><Chips value={a.weekdays || []} onChange={(v) => setB({ ...b, audience: { ...a, weekdays: v as never } })} options={WEEK} /></Field>
      <Toggle checked={!!a.newOnly} onChange={(v) => setB({ ...b, audience: { ...a, newOnly: v } })} label="Só para quem nunca comprou" />
    </section>
    <div className="grid3">
      <Field label="Começa"><input type="datetime-local" value={b.startsAt?.slice(0, 16) || ""} onChange={(e) => setB({ ...b, startsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></Field>
      <Field label="Termina"><input type="datetime-local" value={b.endsAt?.slice(0, 16) || ""} onChange={(e) => setB({ ...b, endsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></Field>
      <Field label="Prioridade" hint="1 aparece antes de 2"><Num value={b.priority} onChange={(v) => setB({ ...b, priority: v ?? 1 })} /></Field>
      <Field label="Peso no teste A/B"><Num value={b.weight} onChange={(v) => setB({ ...b, weight: v })} /></Field>
    </div>
    <Toggle checked={b.active !== false} onChange={(v) => setB({ ...b, active: v })} label="Ativo" />
  </Drawer>;
}

function MerchEditor(p: { tab: "hero" | "ordem" | "sacola" | "comportamento" }) {
  const { api, dirty } = useAdmin(); const { run, busy } = useAction();
  const m = useLoad<MerchSettings>("/admin/settings/merch");
  const items = useLoad<Item[]>("/admin/items"); const cats = useLoad<Category[]>("/admin/categories");
  if (!m.data) return null;
  const s = m.data; const set = (x: Partial<MerchSettings>) => m.setData({ ...s, ...x });
  const itemOpts = (items.data || []).map((i) => ({ value: i.id, label: i.name.split(" · ")[0] }));
  const catOpts = (cats.data || []).map((c) => ({ value: c.id, label: c.name }));
  const save = async () => { if (await run(() => api.put("/admin/settings/merch", s), "Vitrine salva")) dirty(); };
  return <div className="stack">
    {p.tab === "hero" && <section className="panel"><header><h3>Card sugerido por perfil</h3><p>Fica no topo do cardápio, logo abaixo do banner de cima</p></header>
      {s.heroRules.map((h, i) => { const upd = (x: Partial<HeroRule>) => set({ heroRules: s.heroRules.map((y, j) => (j === i ? { ...y, ...x } : y)) }); return <div key={h.id} className="grid3" style={{ borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 12 : 0 }}>
        <Field label="Perfil"><Select value={h.profile} onChange={(v) => upd({ profile: v })} options={PROFILES} /></Field>
        <Field label="Ação"><Select value={h.action.kind === "reorder" ? "reorder" : h.action.itemId} onChange={(v) => upd({ action: v === "reorder" ? { kind: "reorder" } : { kind: "open_item", itemId: v } })} options={[{ value: "reorder", label: "Pedir de novo (último pedido)" }, ...itemOpts.map((o) => ({ value: o.value, label: "Abrir: " + o.label }))]} /></Field>
        <Field label="Selo"><Text value={h.kicker} onChange={(v) => upd({ kicker: v })} /></Field>
        <Field label="Título" wide><Text value={h.title} onChange={(v) => upd({ title: v })} placeholder={h.action.kind === "reorder" ? "Preenchido com o último pedido" : ""} /></Field>
        <Field label="Linha de apoio" wide><Text value={h.sub} onChange={(v) => upd({ sub: v })} /></Field>
        <div className="row"><Toggle checked={h.active} onChange={(v) => upd({ active: v })} label="Ativo" /><Btn sm kind="danger" onClick={() => set({ heroRules: s.heroRules.filter((_, j) => j !== i) })}>Remover</Btn></div>
      </div>; })}
      <div><Btn sm onClick={() => set({ heroRules: [...s.heroRules, { id: "h" + Date.now(), profile: "novo", kicker: "", title: "", action: { kind: "open_item", itemId: itemOpts[0]?.value || "" }, active: true, priority: 1 }] })}>Adicionar card</Btn></div>
    </section>}
    {p.tab === "ordem" && <>
      <section className="panel"><header><h3>Ordem das categorias por perfil</h3><p>Toque na ordem desejada; categorias não marcadas vêm depois</p></header>
        {PROFILES.filter((x) => x.value !== "qualquer").map((pr) => <Field key={pr.value} label={pr.label}><Chips value={s.categoryOrderByProfile[pr.value] || []} onChange={(v) => set({ categoryOrderByProfile: { ...s.categoryOrderByProfile, [pr.value]: v } })} options={catOpts} /><em>{(s.categoryOrderByProfile[pr.value] || []).map((id, i) => `${i + 1}. ${catOpts.find((c) => c.value === id)?.label}`).join("  ")}</em></Field>)}
      </section>
      <section className="panel"><header><h3>Mais pedidos</h3></header>
        <div className="row"><Toggle checked={s.mostOrdered.enabled} onChange={(v) => set({ mostOrdered: { ...s.mostOrdered, enabled: v } })} label="Mostrar carrossel" /><Toggle checked={s.mostOrdered.auto} onChange={(v) => set({ mostOrdered: { ...s.mostOrdered, auto: v } })} label="Automático pelos últimos 30 dias" /></div>
        <Field label="Título"><Text value={s.mostOrdered.title} onChange={(v) => set({ mostOrdered: { ...s.mostOrdered, title: v } })} /></Field>
        <Field label="Itens fixos (usados quando há poucos pedidos)"><Chips value={s.mostOrdered.itemIds || []} onChange={(v) => set({ mostOrdered: { ...s.mostOrdered, itemIds: v } })} options={itemOpts} /></Field>
      </section>
    </>}
    {p.tab === "sacola" && <section className="panel"><header><h3>“Complete seu pedido”</h3><p>Quando a sacola tem algo destas categorias, sugere estes itens</p></header>
      {s.crossSell.map((x, i) => { const upd = (y: Partial<CrossSellRule>) => set({ crossSell: s.crossSell.map((z, j) => (j === i ? { ...z, ...y } : z)) }); return <div key={x.id} className="stack" style={{ borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 12 : 0 }}>
        <Field label="Quando a sacola tem"><Chips value={x.whenCategoryIds || []} onChange={(v) => upd({ whenCategoryIds: v })} options={catOpts} /></Field>
        <Field label="Sugerir"><Chips value={x.suggestItemIds} onChange={(v) => upd({ suggestItemIds: v })} options={itemOpts} /></Field>
        <Field label="Motivo exibido"><Text value={x.reason} onChange={(v) => upd({ reason: v })} /></Field>
        <div className="row"><Toggle checked={x.active} onChange={(v) => upd({ active: v })} label="Ativa" /><Btn sm kind="danger" onClick={() => set({ crossSell: s.crossSell.filter((_, j) => j !== i) })}>Remover</Btn></div>
      </div>; })}
      <div><Btn sm onClick={() => set({ crossSell: [...s.crossSell, { id: "x" + Date.now(), whenCategoryIds: [], suggestItemIds: [], reason: "", active: true }] })}>Adicionar sugestão</Btn></div>
    </section>}
    {p.tab === "comportamento" && <section className="panel"><header><h3>Busca e comportamento</h3></header>
      <Toggle checked={s.searchInHeader} onChange={(v) => set({ searchInHeader: v })} label="Busca só pela lupa no topo (libera espaço no cardápio)" />
      <Field label="Ajuda na revisão depois de (segundos parado)" hint="Uma ajuda dentro da página, sem pop-up"><Num value={s.hesitationHelpSeconds} onChange={(v) => set({ hesitationHelpSeconds: v ?? 12 })} /></Field>
      <p className="small muted">O pop-up de cupom por tempo sem adicionar fica em Estratégias.</p>
    </section>}
    <div><Btn kind="primary" onClick={save} disabled={busy}>Salvar</Btn></div>
  </div>;
}
