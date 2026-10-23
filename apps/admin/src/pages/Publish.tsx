import { useState } from "react";
import type { Tenant } from "@cw/core";
import { Btn, Empty, Field, MediaInput, Pill, Text, Toggle, dt, errMsg, useAction, useAdmin, useLoad } from "../ui";

type Issue = { level: "erro" | "aviso"; where: string; message: string; fix?: string; itemId?: string };

export function PublishPage() {
  const { api, go, toast, onPublished } = useAdmin(); const { run, busy } = useAction();
  const audit = useLoad<Issue[]>("/admin/audit");
  const versions = useLoad<{ id: string; number: number; createdAt: string; notes?: string; current: boolean; items: number }[]>("/admin/versions");
  const [notes, setNotes] = useState("");
  const errs = (audit.data || []).filter((i) => i.level === "erro"), warns = (audit.data || []).filter((i) => i.level === "aviso");
  const route = (w: string) => (w.startsWith("Loja") || w.startsWith("Lojas") ? "lojas" : w.startsWith("Banner") ? "vitrine" : w.startsWith("Estratégia") ? "estrategias" : "cardapio");
  return <>
    <div className="pagehead"><div><h1>Publicar</h1><p>O cliente vê sempre a última versão publicada. Edite à vontade: nada muda no cardápio até você publicar, e dá para voltar a qualquer versão.</p></div></div>
    <div className="split">
      <section className="panel"><header><h2>Revisão antes de publicar</h2>{errs.length ? <Pill tone="bad">{errs.length} erro(s)</Pill> : <Pill tone="good">pronto para publicar</Pill>}</header>
        {[...errs, ...warns].length ? <div className="stack" style={{ gap: 6 }}>{[...errs, ...warns].map((i, k) => <div key={k} className={`issue ${i.level}`}>
          <div className="grow" style={{ flex: 1 }}><b>{i.where}</b><div className="small">{i.message}</div></div>
          {i.fix === "Usar a combinação mais barata" && i.itemId ? <Btn sm onClick={async () => { await run(() => api.post(`/admin/items/${i.itemId}/fix-base`), "Preço base corrigido"); audit.reload(); }}>Corrigir</Btn> : <Btn sm onClick={() => go(route(i.where))}>Abrir</Btn>}
        </div>)}</div> : <Empty title="Nenhuma pendência" />}
        <Field label="O que mudou (fica no histórico)"><Text value={notes} onChange={setNotes} placeholder="Ex.: novos preços de setembro" /></Field>
        <div><Btn kind="primary" disabled={busy || errs.length > 0} onClick={async () => { try { const r = await api.post<{ number: number }>("/admin/publish", { notes }); toast(`Versão ${r.number} no ar`); setNotes(""); versions.reload(); onPublished?.(); } catch (e) { toast(errMsg(e), true); audit.reload(); } }}>Publicar agora</Btn></div>
      </section>
      <section className="panel"><header><h2>Versões</h2></header>
        {(versions.data || []).length ? <div className="list">{versions.data!.map((v) => <div key={v.id} className="li"><span className="pill num">v{v.number}</span><span className="grow"><span className="small">{v.notes || "sem nota"}</span><span className="small muted"> · {v.items} itens · {dt(v.createdAt)}</span></span>{v.current ? <Pill tone="good">no ar</Pill> : <Btn sm onClick={async () => { await run(() => api.post(`/admin/versions/${v.id}/rollback`), `Voltou para a versão ${v.number}`); versions.reload(); onPublished?.(); }}>Voltar para esta</Btn>}</div>)}</div> : <Empty title="Nada publicado ainda" />}
      </section>
    </div>
    <Brand />
  </>;
}

function Brand() {
  const { api, dirty } = useAdmin(); const { run, busy } = useAction();
  const t = useLoad<Tenant>("/admin/brand");
  if (!t.data) return null;
  const b = t.data; const set = (x: Partial<Tenant>) => t.setData({ ...b, ...x });
  const col = (k: keyof Tenant["branding"]["colors"], label: string) => <Field label={label}><div className="row" style={{ flexWrap: "nowrap" }}><input type="color" value={b.branding.colors[k]} onChange={(e) => set({ branding: { ...b.branding, colors: { ...b.branding.colors, [k]: e.target.value } } })} style={{ width: 44, height: 34, border: 0, background: "none" }} aria-label={label} /><Text mono value={b.branding.colors[k]} onChange={(v) => set({ branding: { ...b.branding, colors: { ...b.branding.colors, [k]: v } } })} /></div></Field>;
  return <section className="panel"><header><h2>Marca</h2><p>Logo, capa e cores do cardápio (whitelabel)</p></header>
    <div className="grid2">
      <Field label="Nome da marca"><Text value={b.name} onChange={(v) => set({ name: v, branding: { ...b.branding, name: v } })} /></Field>
      <Field label="WhatsApp de atendimento"><Text value={b.settings.whatsapp} onChange={(v) => set({ settings: { ...b.settings, whatsapp: v } })} /></Field>
      <Field label="Logo (avatar redondo)"><MediaInput value={b.branding.logoUrl} accept="image/*" onChange={(url) => set({ branding: { ...b.branding, logoUrl: url } })} /></Field>
      <Field label="Foto de capa"><MediaInput value={b.branding.coverUrl} accept="image/*" onChange={(url) => set({ branding: { ...b.branding, coverUrl: url } })} /></Field>
      {col("brand", "Cor principal")}{col("brandDeep", "Cor escura")}{col("brandSoft", "Cor clara")}{col("ink", "Texto")}
    </div>
    <Toggle checked={!!b.settings.priceParity} onChange={(v) => set({ settings: { ...b.settings, priceParity: v } })} label="Mostrar “mesmo preço do balcão”" />
    <div><Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/brand", { name: b.name, branding: b.branding, settings: b.settings }), "Marca salva")) dirty(); }}>Salvar marca</Btn></div>
  </section>;
}
