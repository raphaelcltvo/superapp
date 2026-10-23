import { useEffect, useState } from "react";
import type { Campaign, Coupon, EmailBlock, InboxMessage, Item, MessageTemplate, Page, Segment, TemplateVar } from "@cw/core";
import { Funnel } from "../charts";
import { BRL, Btn, ConfirmBtn, Drawer, Empty, Field, Num, Pill, Select, Tabs, Text, Tile, Toggle, dt, errMsg, pct, useAction, useAdmin, useLoad } from "../ui";

type Tab = "canais" | "modelos" | "campanhas" | "inbox";
type Ov = { whatsapp: Ch & { optin: number }; email: Ch & { optin: number }; customers: number };
type Ch = { sent: number; delivered: number; read: number; clicked: number; failed: number };
const rate = (a: number, b: number) => (b ? pct((a / b) * 100) : "—");

export function MessagingPage() {
  const [tab, setTab] = useState<Tab>("campanhas");
  const ov = useLoad<Ov>("/admin/messaging/overview");
  const inbox = useLoad<InboxMessage[]>("/admin/messaging/inbox?status=open");
  const o = ov.data;
  return <>
    <div className="pagehead"><div><h1>WhatsApp e e-mail</h1><p>Campanhas para segmentos do CRM, modelos aprovados e caixa de entrada. Toda campanha deixa um grupo de controle sem receber para medir o que ela realmente trouxe.</p></div></div>
    {o && <div className="grid4">
      <Tile k="Aceitam WhatsApp" v={o.whatsapp.optin} d={<span className="muted">de {o.customers} clientes</span>} />
      <Tile k="WhatsApp lidas · 30 dias" v={rate(o.whatsapp.read, o.whatsapp.sent)} d={<span className="muted">{o.whatsapp.sent} enviadas · {rate(o.whatsapp.clicked, o.whatsapp.sent)} clicaram</span>} />
      <Tile k="Aceitam e-mail" v={o.email.optin} d={<span className="muted">de {o.customers} clientes</span>} />
      <Tile k="E-mails abertos · 30 dias" v={rate(o.email.read, o.email.sent)} d={<span className="muted">{o.email.sent} enviados · {rate(o.email.clicked, o.email.sent)} clicaram</span>} />
    </div>}
    <Tabs value={tab} onChange={setTab} tabs={[{ value: "campanhas", label: "Campanhas" }, { value: "modelos", label: "Modelos" }, { value: "inbox", label: `Caixa de entrada${inbox.data?.length ? ` (${inbox.data.length})` : ""}` }, { value: "canais", label: "Canais" }]} />
    {tab === "canais" && <Channels onSaved={ov.reload} />}
    {tab === "modelos" && <Templates />}
    {tab === "campanhas" && <Campaigns onChange={ov.reload} />}
    {tab === "inbox" && <Inbox onChange={inbox.reload} />}
  </>;
}

/* ---------------- canais ---------------- */
type WaCfg = { enabled: boolean; provider: "meta" | "fake"; phoneNumberId: string; wabaId?: string; token: string; appSecret: string; verifyToken: string; graphVersion?: string; otpTemplate?: { name: string; language: string }; costPerMessage?: number };
type EmCfg = { enabled: boolean; provider: "resend" | "brevo" | "fake"; apiKey: string; fromName: string; fromEmail: string; replyTo?: string };
function Channels(p: { onSaved: () => void }) {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const cfg = useLoad<{ whatsapp: WaCfg | null; email: EmCfg | null; webhooks: { whatsapp: string; email: string } }>("/admin/messaging/config");
  const [wa, setWa] = useState<WaCfg | null>(null); const [em, setEm] = useState<EmCfg | null>(null);
  const [testTo, setTestTo] = useState({ whatsapp: "", email: "" });
  useEffect(() => { if (!cfg.data) return; setWa(cfg.data.whatsapp || { enabled: false, provider: "meta", phoneNumberId: "", token: "", appSecret: "", verifyToken: crypto.randomUUID().slice(0, 12), graphVersion: "v26.0", otpTemplate: { name: "codigo_acesso", language: "pt_BR" }, costPerMessage: 0.35 }); setEm(cfg.data.email || { enabled: false, provider: "resend", apiKey: "", fromName: "", fromEmail: "" }); }, [cfg.data]);
  if (!wa || !em || !cfg.data) return null;
  const test = async (channel: "whatsapp" | "email") => { const r = await run(() => api.post<{ ok: boolean; error?: string }>("/admin/messaging/test", { channel, to: testTo[channel] })); if (r) toast(r.ok ? "Mensagem de teste enviada" : r.error || "Falhou", !r.ok); };
  return <div className="grid2">
    <section className="panel"><header><h2>WhatsApp (API oficial da Meta)</h2>{wa.enabled ? <Pill tone="good">ligado</Pill> : <Pill>desligado</Pill>}</header>
      <p className="small muted">No Meta Business: crie o app, adicione o produto WhatsApp, gere um token permanente de usuário do sistema e aprove os modelos. Mensagens que a marca inicia só saem por modelo aprovado.</p>
      <div className="grid2">
        <Field label="Provedor"><Select value={wa.provider} onChange={(v) => setWa({ ...wa, provider: v })} options={[{ value: "meta", label: "Meta Cloud API" }, { value: "fake", label: "Teste (não envia)" }]} /></Field>
        <Field label="ID do número (Phone number ID)"><Text mono value={wa.phoneNumberId} onChange={(v) => setWa({ ...wa, phoneNumberId: v })} /></Field>
        <Field label="ID da conta (WABA)"><Text mono value={wa.wabaId} onChange={(v) => setWa({ ...wa, wabaId: v })} /></Field>
        <Field label="Token de acesso"><Text mono type="password" value={wa.token} onChange={(v) => setWa({ ...wa, token: v })} /></Field>
        <Field label="App Secret" hint="Valida a assinatura dos avisos da Meta"><Text mono type="password" value={wa.appSecret} onChange={(v) => setWa({ ...wa, appSecret: v })} /></Field>
        <Field label="Token de verificação" hint="Cole o mesmo valor na Meta"><Text mono value={wa.verifyToken} onChange={(v) => setWa({ ...wa, verifyToken: v })} /></Field>
        <Field label="Modelo do código de acesso"><Text mono value={wa.otpTemplate?.name} onChange={(v) => setWa({ ...wa, otpTemplate: { name: v, language: wa.otpTemplate?.language || "pt_BR" } })} /></Field>
        <Field label="Custo por mensagem (R$)" hint="Só para os relatórios"><Num value={wa.costPerMessage} onChange={(v) => setWa({ ...wa, costPerMessage: v })} /></Field>
      </div>
      <Field label="URL do webhook (Meta › WhatsApp › Configuração)"><div className="codebox" style={{ overflowWrap: "anywhere" }}>{cfg.data.webhooks.whatsapp}</div></Field>
      <div className="row"><Toggle checked={wa.enabled} onChange={(v) => setWa({ ...wa, enabled: v })} label="Ligar WhatsApp" /><Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/messaging/config/whatsapp", wa), "WhatsApp salvo")) { cfg.reload(); p.onSaved(); } }}>Salvar</Btn></div>
      <div className="row"><Text placeholder="5521999990000" value={testTo.whatsapp} onChange={(v) => setTestTo({ ...testTo, whatsapp: v })} /><Btn disabled={busy || !testTo.whatsapp} onClick={() => test("whatsapp")}>Enviar teste</Btn></div>
    </section>
    <section className="panel"><header><h2>E-mail marketing</h2>{em.enabled ? <Pill tone="good">ligado</Pill> : <Pill>desligado</Pill>}</header>
      <p className="small muted">Verifique o domínio no provedor (registros SPF, DKIM e DMARC) antes do primeiro envio; sem isso o e-mail cai no spam. Aberturas, cliques e descadastro são medidos aqui, em qualquer provedor.</p>
      <div className="grid2">
        <Field label="Provedor"><Select value={em.provider} onChange={(v) => setEm({ ...em, provider: v })} options={[{ value: "resend", label: "Resend" }, { value: "brevo", label: "Brevo" }, { value: "fake", label: "Teste (não envia)" }]} /></Field>
        <Field label="Chave da API"><Text mono type="password" value={em.apiKey} onChange={(v) => setEm({ ...em, apiKey: v })} /></Field>
        <Field label="Nome do remetente"><Text value={em.fromName} onChange={(v) => setEm({ ...em, fromName: v })} /></Field>
        <Field label="E-mail do remetente"><Text type="email" value={em.fromEmail} onChange={(v) => setEm({ ...em, fromEmail: v })} /></Field>
        <Field label="Responder para"><Text type="email" value={em.replyTo} onChange={(v) => setEm({ ...em, replyTo: v })} /></Field>
      </div>
      <Field label="URL de eventos (entregue, devolvido, spam)"><div className="codebox" style={{ overflowWrap: "anywhere" }}>{cfg.data.webhooks.email}</div></Field>
      <div className="row"><Toggle checked={em.enabled} onChange={(v) => setEm({ ...em, enabled: v })} label="Ligar e-mail" /><Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/messaging/config/email", em), "E-mail salvo")) { cfg.reload(); p.onSaved(); } }}>Salvar</Btn></div>
      <div className="row"><Text type="email" placeholder="voce@empresa.com.br" value={testTo.email} onChange={(v) => setTestTo({ ...testTo, email: v })} /><Btn disabled={busy || !testTo.email} onClick={() => test("email")}>Enviar teste</Btn></div>
    </section>
  </div>;
}

/* ---------------- modelos ---------------- */
const VARS: { value: TemplateVar; label: string }[] = [{ value: "nome", label: "Primeiro nome" }, { value: "cupom", label: "Código do cupom" }, { value: "link", label: "Link rastreado" }, { value: "marca", label: "Nome da marca" }, { value: "dias", label: "Dias sem pedir" }, { value: "pedido", label: "Número do pedido" }, { value: "cashback", label: "Saldo de cashback" }, { value: "codigo", label: "Código de acesso" }, { value: "fixo", label: "Texto fixo" }];
const BLOCKS: { kind: EmailBlock["kind"]; label: string; make: () => EmailBlock }[] = [
  { kind: "heading", label: "Título", make: () => ({ kind: "heading", text: "" }) },
  { kind: "text", label: "Texto", make: () => ({ kind: "text", text: "" }) },
  { kind: "image", label: "Imagem", make: () => ({ kind: "image", url: "", alt: "", href: "{{link}}" }) },
  { kind: "button", label: "Botão", make: () => ({ kind: "button", label: "Pedir agora", href: "{{link}}" }) },
  { kind: "items", label: "Itens do cardápio", make: () => ({ kind: "items", title: "", itemIds: [] }) },
  { kind: "coupon", label: "Cupom", make: () => ({ kind: "coupon", text: "" }) },
  { kind: "divider", label: "Linha", make: () => ({ kind: "divider" }) },
];
function Templates() {
  const list = useLoad<MessageTemplate[]>("/admin/message_templates");
  const [edit, setEdit] = useState<Partial<MessageTemplate> | null>(null);
  return <>
    <div className="row between"><p className="muted">Modelos de WhatsApp precisam estar aprovados na Meta com o mesmo nome e variáveis. Os de e-mail são montados aqui.</p>
      <div className="row"><Btn onClick={() => setEdit({ name: "", channel: "whatsapp", waLanguage: "pt_BR", waCategory: "MARKETING", waBody: "", waVars: [] })}>Modelo de WhatsApp</Btn><Btn kind="primary" onClick={() => setEdit({ name: "", channel: "email", subject: "", blocks: [{ kind: "heading", text: "" }, { kind: "text", text: "" }, { kind: "button", label: "Pedir agora", href: "{{link}}" }] })}>Modelo de e-mail</Btn></div></div>
    {(list.data || []).length ? <div className="list">{list.data!.map((t) => <div key={t.id} className="li click" role="button" tabIndex={0} onClick={() => setEdit(t)}>
      <Pill tone={t.channel === "whatsapp" ? "good" : "accent"}>{t.channel === "whatsapp" ? "WhatsApp" : "E-mail"}</Pill>
      <div className="grow"><b>{t.name}</b><span className="small muted">{t.channel === "whatsapp" ? `${t.waName} · ${t.waCategory === "MARKETING" ? "marketing" : t.waCategory === "UTILITY" ? "utilidade" : "autenticação"}` : t.subject}</span></div><span className="muted">›</span></div>)}</div> : <Empty title="Nenhum modelo" />}
    {edit && <TemplateEditor t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
  </>;
}

function TemplateEditor(p: { t: Partial<MessageTemplate>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const items = useLoad<Item[]>("/admin/items"); const coupons = useLoad<Coupon[]>("/admin/coupons");
  const [t, setT] = useState<Partial<MessageTemplate>>(p.t);
  const [prev, setPrev] = useState<{ html?: string; text?: string; subject?: string } | null>(null);
  useEffect(() => { const h = setTimeout(() => { api.post<{ html?: string; text?: string; subject?: string }>("/admin/messaging/templates/preview", t).then(setPrev).catch(() => {}); }, 350); return () => clearTimeout(h); }, [t, api]);
  const blocks = t.blocks || [];
  const upd = (i: number, b: Partial<EmailBlock>) => setT({ ...t, blocks: blocks.map((x, j) => (j === i ? ({ ...x, ...b } as EmailBlock) : x)) });
  const mv = (i: number, d: number) => { const b = [...blocks]; const j = i + d; if (j < 0 || j >= b.length) return; [b[i], b[j]] = [b[j], b[i]]; setT({ ...t, blocks: b }); };
  const nVars = Math.max(0, ...Array.from((t.waBody || "").matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
  const save = async () => { const r = await run(() => (t.id ? api.put(`/admin/message_templates/${t.id}`, t) : api.post("/admin/message_templates", t)), "Modelo salvo"); if (r) p.onSaved(); };
  return <Drawer title={t.id ? t.name : t.channel === "email" ? "Novo e-mail" : "Novo modelo de WhatsApp"} onClose={p.onClose} footer={<>{t.id ? <ConfirmBtn label="Excluir" confirm="Excluir o modelo?" onConfirm={async () => { await run(() => api.del(`/admin/message_templates/${t.id}`), "Excluído"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar modelo</Btn></>}>
    <Field label="Nome interno"><Text id="tpl-name" value={t.name} onChange={(v) => setT({ ...t, name: v })} /></Field>
    {t.channel === "whatsapp" ? <>
      <div className="grid3">
        <Field label="Nome do modelo na Meta"><Text mono value={t.waName} onChange={(v) => setT({ ...t, waName: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></Field>
        <Field label="Idioma"><Text mono value={t.waLanguage} onChange={(v) => setT({ ...t, waLanguage: v })} /></Field>
        <Field label="Categoria"><Select value={(t.waCategory || "MARKETING") as "MARKETING"} onChange={(v) => setT({ ...t, waCategory: v })} options={[{ value: "MARKETING", label: "Marketing" }, { value: "UTILITY" as "MARKETING", label: "Utilidade" }, { value: "AUTHENTICATION" as "MARKETING", label: "Autenticação" }]} /></Field>
      </div>
      <Field label="Texto aprovado" hint="Igual ao cadastrado na Meta, com {{1}}, {{2}}…"><textarea id="tpl-body" value={t.waBody || ""} onChange={(e) => setT({ ...t, waBody: e.target.value })} /></Field>
      {nVars > 0 && <section className="panel"><header><h3>De onde vem cada variável</h3></header>
        {Array.from({ length: nVars }, (_, i) => { const v = t.waVars?.[i] || { source: "nome" as TemplateVar }; const setV = (x: Partial<typeof v>) => { const arr = [...(t.waVars || [])]; while (arr.length < nVars) arr.push({ source: "nome" }); arr[i] = { ...v, ...x }; setT({ ...t, waVars: arr.slice(0, nVars) }); };
          return <div key={i} className="grid3"><span className="mono" style={{ alignSelf: "center" }}>{`{{${i + 1}}}`}</span><Select value={v.source} onChange={(s) => setV({ source: s })} options={VARS} />{v.source === "fixo" && <Text value={v.value} onChange={(x) => setV({ value: x })} />}</div>; })}
      </section>}
      <Field label="Pré-visualização"><div style={{ background: "#e7ddd3", borderRadius: 12, padding: 14 }}><div style={{ background: "#fff", color: "#111", borderRadius: "10px 10px 10px 2px", padding: "8px 11px", maxWidth: 320, whiteSpace: "pre-wrap", fontSize: 14, boxShadow: "0 1px 1px rgba(0,0,0,.15)" }}>{prev?.text || "…"}</div></div></Field>
    </> : <>
      <div className="grid2"><Field label="Assunto" hint="Pode usar {{nome}}"><Text id="tpl-subject" value={t.subject} onChange={(v) => setT({ ...t, subject: v })} /></Field><Field label="Texto de pré-visualização"><Text value={t.preheader} onChange={(v) => setT({ ...t, preheader: v })} /></Field></div>
      <div className="split">
        <div className="stack">{blocks.map((b, i) => <section key={i} className="panel">
          <header><h3>{BLOCKS.find((x) => x.kind === b.kind)?.label}</h3><span className="row"><Btn sm kind="ghost" onClick={() => mv(i, -1)}>↑</Btn><Btn sm kind="ghost" onClick={() => mv(i, 1)}>↓</Btn><Btn sm kind="ghost" onClick={() => setT({ ...t, blocks: blocks.filter((_, j) => j !== i) })}>✕</Btn></span></header>
          {(b.kind === "heading" || b.kind === "text") && (b.kind === "text" ? <textarea value={b.text} onChange={(e) => upd(i, { text: e.target.value })} /> : <Text value={b.text} onChange={(v) => upd(i, { text: v })} />)}
          {b.kind === "image" && <><Field label="URL da imagem"><Text value={b.url} onChange={(v) => upd(i, { url: v })} /></Field><Field label="Texto alternativo"><Text value={b.alt} onChange={(v) => upd(i, { alt: v })} /></Field></>}
          {b.kind === "button" && <div className="grid2"><Field label="Texto"><Text value={b.label} onChange={(v) => upd(i, { label: v })} /></Field><Field label="Link" hint="{{link}} = cardápio rastreado"><Text value={b.href} onChange={(v) => upd(i, { href: v })} /></Field></div>}
          {b.kind === "items" && <><Field label="Título"><Text value={b.title} onChange={(v) => upd(i, { title: v })} /></Field><div className="chips">{(items.data || []).map((x) => { const on = b.itemIds.includes(x.id); return <button key={x.id} type="button" className="chip" aria-pressed={on} onClick={() => upd(i, { itemIds: on ? b.itemIds.filter((y) => y !== x.id) : [...b.itemIds, x.id] })}>{x.name.split(" · ")[0].slice(0, 30)}</button>; })}</div></>}
          {b.kind === "coupon" && <><Field label="Cupom" hint="Vazio = o cupom da campanha"><Select value={b.couponId || ""} onChange={(v) => upd(i, { couponId: v || undefined })} options={[{ value: "", label: "O da campanha" }, ...(coupons.data || []).map((c) => ({ value: c.id, label: c.code || c.name }))]} /></Field><Field label="Texto"><Text value={b.text} onChange={(v) => upd(i, { text: v })} /></Field></>}
        </section>)}
          <Field label="Adicionar bloco"><Select value={"" as string} onChange={(k) => { const B = BLOCKS.find((x) => x.kind === k); if (B) setT({ ...t, blocks: [...blocks, B.make()] }); }} options={[{ value: "", label: "Escolha…" }, ...BLOCKS.map((b) => ({ value: b.kind, label: b.label }))]} /></Field>
        </div>
        <div className="stack" style={{ position: "sticky", top: 0 }}><span className="small muted">Assunto: <b>{prev?.subject}</b></span>
          {prev?.html ? <iframe title="Pré-visualização do e-mail" srcDoc={prev.html} sandbox="" style={{ width: "100%", height: 620, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }} /> : <Empty title="Montando a pré-visualização…" />}
        </div>
      </div>
    </>}
  </Drawer>;
}

/* ---------------- campanhas ---------------- */
type Rep = { envio: number; controle: number; sent: number; failed: number; delivered: number; read: number; clicked: number; orders: number; revenue: number; conversion: number; controlConversion: number; lift: number | null; incrementalOrders: number | null; cost: number };
const STATUS: Record<Campaign["status"], { label: string; tone?: "good" | "warn" | "accent" | "bad" }> = { draft: { label: "rascunho" }, scheduled: { label: "agendada", tone: "accent" }, sending: { label: "enviando", tone: "warn" }, done: { label: "enviada", tone: "good" }, paused: { label: "pausada", tone: "bad" } };
function Campaigns(p: { onChange: () => void }) {
  const list = useLoad<Campaign[]>("/admin/campaigns");
  const [edit, setEdit] = useState<Partial<Campaign> | null>(null);
  return <>
    <div className="row between"><p className="muted">Escolha o público (segmento), o canal e o modelo. O envio respeita o aceite de cada cliente, o horário de silêncio e o limite por semana.</p>
      <Btn kind="primary" onClick={() => setEdit({ name: "", channel: "whatsapp", templateId: "", holdoutPercent: 10, maxPerCustomerPerWeek: 2, quietHours: [22, 9], status: "draft" })}>Nova campanha</Btn></div>
    {(list.data || []).length ? <div className="list">{list.data!.map((c) => <div key={c.id} className="li click" role="button" tabIndex={0} onClick={() => setEdit(c)}>
      <Pill tone={c.channel === "whatsapp" ? "good" : "accent"}>{c.channel === "whatsapp" ? "WhatsApp" : "E-mail"}</Pill>
      <div className="grow"><b>{c.name}</b><span className="small muted">{c.scheduleAt ? `agendada para ${dt(c.scheduleAt)}` : c.finishedAt ? `enviada ${dt(c.finishedAt)}` : "envio manual"} · controle {c.holdoutPercent}%</span></div>
      <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill></div>)}</div> : <Empty title="Nenhuma campanha" />}
    {edit && <CampaignEditor c={edit} onClose={() => { setEdit(null); list.reload(); p.onChange(); }} />}
  </>;
}

function CampaignEditor(p: { c: Partial<Campaign>; onClose: () => void }) {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const tpls = useLoad<MessageTemplate[]>("/admin/message_templates"); const segs = useLoad<Segment[]>("/admin/segments"); const coupons = useLoad<Coupon[]>("/admin/coupons"); const pages = useLoad<Page[]>("/admin/pages");
  const [c, setC] = useState<Partial<Campaign>>(p.c);
  const aud = useLoad<{ total: number; reachable: number }>(`/admin/messaging/audience?channel=${c.channel}&segmentId=${c.segmentId || ""}`, [c.channel, c.segmentId]);
  const rep = useLoad<Rep>(c.id && c.status !== "draft" ? `/admin/messaging/campaigns/${c.id}/report` : null, [c.status]);
  const editable = !c.status || c.status === "draft" || c.status === "scheduled";
  const save = async (extra: Partial<Campaign> = {}) => { const body = { ...c, ...extra }; const r = await run(() => (c.id ? api.put<Campaign>(`/admin/campaigns/${c.id}`, body) : api.post<Campaign>("/admin/campaigns", body)), "Campanha salva"); if (r) setC(r); return r; };
  const send = async () => { const saved = await save(); if (!saved) return; try { const r = await api.post<{ sent: number; controle: number; done: boolean; waiting?: string }>(`/admin/messaging/campaigns/${saved.id}/send`); toast(r.waiting ? `Aguardando: ${r.waiting}` : `${r.sent} enviadas · ${r.controle} no grupo de controle`); setC({ ...saved, status: r.done ? "done" : r.waiting ? "scheduled" : "sending" }); } catch (e) { toast(errMsg(e), true); } };
  const r = rep.data;
  return <Drawer title={c.id ? c.name : "Nova campanha"} onClose={p.onClose} footer={<>{c.id && editable ? <ConfirmBtn label="Excluir" confirm="Excluir a campanha?" onConfirm={async () => { await run(() => api.del(`/admin/campaigns/${c.id}`), "Excluída"); p.onClose(); }} /> : <span />}
    {editable && <div className="row"><Btn onClick={() => save()} disabled={busy}>Salvar rascunho</Btn>{c.scheduleAt ? <Btn kind="primary" disabled={busy} onClick={() => save({ status: "scheduled" })}>Agendar</Btn> : <Btn kind="primary" disabled={busy || !c.templateId} onClick={send}>Enviar agora</Btn>}</div>}</>}>
    {r && <section className="panel"><header><h2>Resultado</h2><span className="small muted">pedidos até 7 dias depois do envio</span></header>
      <Funnel rows={[["Enviadas", r.envio], ["Entregues", r.delivered], [c.channel === "email" ? "Abertas" : "Lidas", r.read], ["Clicaram", r.clicked], ["Pediram", r.orders]].map(([label, n], i, a) => ({ label: String(label), sessions: Number(n), pctOfVisits: r.envio ? (Number(n) / r.envio) * 100 : 0, pctOfPrev: !i ? 100 : Number(a[i - 1][1]) ? (Number(n) / Number(a[i - 1][1])) * 100 : 0, dropFromPrev: 0 }))} />
      <div className="grid4"><Tile k="Conversão" v={pct(r.conversion)} d={<span className="muted">controle: {pct(r.controlConversion)}</span>} /><Tile k="Incremento" v={r.lift != null ? `${r.lift > 0 ? "+" : ""}${r.lift.toFixed(1).replace(".", ",")} p.p.` : "—"} d={<span className="muted">{r.incrementalOrders ?? 0} pedidos a mais</span>} /><Tile k="Faturamento" v={BRL(r.revenue)} /><Tile k="Custo" v={BRL(r.cost)} d={<span className="muted">{r.failed} falharam</span>} /></div>
    </section>}
    <div className="grid2">
      <Field label="Nome"><Text id="cmp-name" value={c.name} onChange={(v) => setC({ ...c, name: v })} /></Field>
      <Field label="Canal"><Select value={(c.channel || "whatsapp") as "whatsapp"} onChange={(v) => setC({ ...c, channel: v, templateId: "" })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email" as "whatsapp", label: "E-mail" }]} /></Field>
      <Field label="Modelo"><Select value={c.templateId || ""} onChange={(v) => setC({ ...c, templateId: v })} options={[{ value: "", label: "Escolha…" }, ...(tpls.data || []).filter((x) => x.channel === c.channel && x.waCategory !== "AUTHENTICATION").map((x) => ({ value: x.id, label: x.name }))]} /></Field>
      <Field label="Público" hint={aud.data ? `${aud.data.reachable} de ${aud.data.total} aceitam ${c.channel === "email" ? "e-mail" : "WhatsApp"}` : undefined}><Select value={c.segmentId || ""} onChange={(v) => setC({ ...c, segmentId: v || undefined })} options={[{ value: "", label: "Toda a base com aceite" }, ...(segs.data || []).map((s) => ({ value: s.id, label: s.name }))]} /></Field>
      <Field label="Cupom ({{cupom}})"><Select value={c.couponId || ""} onChange={(v) => setC({ ...c, couponId: v || undefined })} options={[{ value: "", label: "Nenhum" }, ...(coupons.data || []).map((x) => ({ value: x.id, label: x.code || x.name }))]} /></Field>
      <Field label="Destino do link ({{link}})"><Select value={c.pageId || ""} onChange={(v) => setC({ ...c, pageId: v || undefined })} options={[{ value: "", label: "Cardápio" }, ...(pages.data || []).map((x) => ({ value: x.id, label: x.title }))]} /></Field>
      <Field label="Enviar em" hint="Vazio = ao clicar em Enviar agora"><input type="datetime-local" value={c.scheduleAt?.slice(0, 16) || ""} onChange={(e) => setC({ ...c, scheduleAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></Field>
      <Field label="Grupo de controle (%)"><Num value={c.holdoutPercent} onChange={(v) => setC({ ...c, holdoutPercent: v ?? 0 })} /></Field>
      <Field label="Máximo de mensagens por cliente por semana"><Num value={c.maxPerCustomerPerWeek} onChange={(v) => setC({ ...c, maxPerCustomerPerWeek: v ?? 1 })} /></Field>
      <Field label="Horário de silêncio" hint="Não envia entre essas horas"><div className="row" style={{ flexWrap: "nowrap" }}><Num value={c.quietHours?.[0]} onChange={(v) => setC({ ...c, quietHours: [v ?? 22, c.quietHours?.[1] ?? 9] })} /><span>às</span><Num value={c.quietHours?.[1]} onChange={(v) => setC({ ...c, quietHours: [c.quietHours?.[0] ?? 22, v ?? 9] })} /></div></Field>
    </div>
  </Drawer>;
}

/* ---------------- caixa de entrada ---------------- */
function Inbox(p: { onChange: () => void }) {
  const { api, toast } = useAdmin();
  const [st, setSt] = useState("open");
  const list = useLoad<InboxMessage[]>(`/admin/messaging/inbox?status=${st}`, [st]);
  const [reply, setReply] = useState<Record<string, string>>({});
  return <>
    <div className="row"><Select value={st} onChange={setSt} options={[{ value: "open", label: "Em aberto" }, { value: "resolved", label: "Resolvidas" }]} /><span className="small muted">Resposta livre só até 24h depois da última mensagem do cliente (regra da Meta).</span></div>
    {(list.data || []).length ? <div className="stack">{list.data!.map((m) => { const open = Date.now() - +new Date(m.at) < 24 * 3600e3; return <section key={m.id} className="panel">
      <header><div><b>{m.name || m.from}</b> <span className="small muted mono">{m.from}</span></div><span className="small muted">{dt(m.at)}</span></header>
      <div style={{ background: "var(--sunk)", borderRadius: 10, padding: "8px 11px", whiteSpace: "pre-wrap" }}>{m.text}</div>
      {(m.replies || []).map((r, i) => <div key={i} style={{ alignSelf: "flex-end", background: "var(--accent-soft)", borderRadius: 10, padding: "8px 11px", maxWidth: "80%" }}><span className="small">{r.text}</span><div className="small muted">{dt(r.at)} · {r.status}</div></div>)}
      {st === "open" && <div className="row" style={{ flexWrap: "nowrap" }}>
        <Text placeholder={open ? "Responder" : "Janela de 24h fechada"} value={reply[m.id]} onChange={(v) => setReply({ ...reply, [m.id]: v })} />
        <Btn kind="primary" disabled={!open || !reply[m.id]} onClick={async () => { try { await api.post(`/admin/messaging/inbox/${m.id}/reply`, { text: reply[m.id] }); toast("Resposta enviada"); list.reload(); p.onChange(); } catch (e) { toast(errMsg(e), true); } }}>Enviar</Btn>
        <Btn onClick={async () => { await api.post(`/admin/messaging/inbox/${m.id}/resolve`); list.reload(); p.onChange(); }}>Resolver</Btn></div>}
    </section>; })}</div> : <Empty title={st === "open" ? "Nenhuma conversa em aberto" : "Nada resolvido ainda"}>Respostas dos clientes ao WhatsApp chegam aqui pelo webhook da Meta.</Empty>}
  </>;
}
