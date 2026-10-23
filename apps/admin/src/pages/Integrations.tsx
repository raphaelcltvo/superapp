import { useRef, useState } from "react";
import { Btn, Chips, ConfirmBtn, Empty, Field, Pill, Select, Tabs, Text, Toggle, dt, errMsg, useAction, useAdmin, useLoad } from "../ui";

export function IntegrationsPage() {
  const [tab, setTab] = useState<"saipos" | "bases" | "api" | "acesso">("saipos");
  return <>
    <div className="pagehead"><div><h1>Integrações e bases</h1><p>PDV SAIPOS, importação de clientes e pedidos, chaves de API para conectar o seu sistema e acesso da equipe.</p></div></div>
    <Tabs value={tab} onChange={setTab} tabs={[{ value: "saipos", label: "SAIPOS (PDV)" }, { value: "bases", label: "Importar bases" }, { value: "api", label: "API e webhooks" }, { value: "acesso", label: "Equipe" }]} />
    {tab === "saipos" && <Saipos />}{tab === "bases" && <Imports />}{tab === "api" && <ApiKeys />}{tab === "acesso" && <Users />}
  </>;
}

type Cfg = { enabled: boolean; env: "homolog" | "production"; idPartner: string; secret: string; codStore: string; deliveryBy: "RESTAURANT" | "PARTNER"; autoSend: boolean; payments: Record<string, { code: string; complement?: string; type: "ONLINE" | "OFFLINE" }>; baseUrl?: string };
type Sug = { itemId: string; itemName: string; current?: string; match?: { code: string; name: string; score: number }; options: { groupId: string; optionId: string; name: string; current?: string; match?: { code: string; name: string; score: number } }[] };
const PAYL: Record<string, string> = { PIX_ONLINE: "Pix online", CARD_ON_DELIVERY: "Cartão na entrega", CREDIT_ON_DELIVERY: "Crédito", DEBIT_ON_DELIVERY: "Débito", VR_VA: "VR/VA", CASH: "Dinheiro" };

function Saipos() {
  const { api, storeId, toast } = useAdmin(); const { run, busy } = useAction();
  const cur = useLoad<{ config: Cfg | null; webhookUrl: string }>(storeId ? `/admin/integrations/saipos/${storeId}` : null, [storeId]);
  const hom = useLoad<{ sent: number; done: number; criteria: { label: string; ok: boolean }[] }>(storeId ? `/admin/integrations/saipos/${storeId}/homologation` : null, [storeId]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [map, setMap] = useState<Sug[] | null>(null);
  const c: Cfg = cfg || cur.data?.config || { enabled: false, env: "homolog", idPartner: "", secret: "", codStore: "", deliveryBy: "RESTAURANT", autoSend: true, payments: {} };
  const set = (x: Partial<Cfg>) => setCfg({ ...c, ...x });
  return <div className="split">
    <section className="panel">
      <header><h2>Conexão</h2>{c.enabled ? <Pill tone="good">ligada</Pill> : <Pill>desligada</Pill>}</header>
      <p className="small muted">Credenciais do Saipos Developer. Em homologação, use a loja de teste; o ID Partner de cada loja real vem do suporte SAIPOS quando a integração é ativada em Canais de Venda.</p>
      <div className="grid2">
        <Field label="Ambiente"><Select value={c.env} onChange={(v) => set({ env: v })} options={[{ value: "homolog", label: "Homologação" }, { value: "production", label: "Produção" }]} /></Field>
        <Field label="Código da loja (cod_store)" hint="O mesmo cadastrado em “Adicionar novo código de loja”"><Text mono value={c.codStore} onChange={(v) => set({ codStore: v })} /></Field>
        <Field label="ID Partner"><Text mono value={c.idPartner} onChange={(v) => set({ idPartner: v })} /></Field>
        <Field label="Secret"><Text mono type="password" value={c.secret} onChange={(v) => set({ secret: v })} /></Field>
        <Field label="Quem entrega"><Select value={c.deliveryBy} onChange={(v) => set({ deliveryBy: v })} options={[{ value: "RESTAURANT", label: "A loja (motoboy próprio)" }, { value: "PARTNER", label: "O parceiro (nós avisamos a SAIPOS)" }]} /></Field>
      </div>
      <div className="row"><Toggle checked={c.enabled} onChange={(v) => set({ enabled: v })} label="Ligar integração" /><Toggle checked={c.autoSend} onChange={(v) => set({ autoSend: v })} label="Enviar todo pedido na hora" /></div>
      <section className="panel"><header><h3>Formas de pagamento na SAIPOS</h3><p>O complemento precisa ser igual ao cadastrado no canal (maiúsculas contam)</p></header>
        <div className="tablewrap"><table><thead><tr><th>No cardápio</th><th>Código</th><th>Complemento</th><th>Tipo</th></tr></thead><tbody>
          {Object.keys(PAYL).map((k) => { const v = c.payments[k] || { code: "", type: "OFFLINE" as const }; const upd = (x: Partial<typeof v>) => set({ payments: { ...c.payments, [k]: { ...v, ...x } } }); return <tr key={k}><td>{PAYL[k]}</td><td><Text mono value={v.code} onChange={(x) => upd({ code: x })} /></td><td><Text mono value={v.complement} onChange={(x) => upd({ complement: x })} /></td><td><Select value={v.type} onChange={(x) => upd({ type: x })} options={[{ value: "OFFLINE", label: "Na entrega" }, { value: "ONLINE", label: "Online" }]} /></td></tr>; })}
        </tbody></table></div>
      </section>
      <div className="row">
        <Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put(`/admin/integrations/saipos/${storeId}`, c), "Configuração salva")) { setCfg(null); cur.reload(); } }}>Salvar</Btn>
        <Btn disabled={busy} onClick={async () => { const r = await run(() => api.post<{ ok: boolean; message: string }>(`/admin/integrations/saipos/${storeId}/test`)); if (r) toast(r.message, !r.ok); }}>Testar conexão</Btn>
        <Btn disabled={busy} onClick={async () => { const r = await run(() => api.post<{ suggestions: Sug[] }>(`/admin/integrations/saipos/${storeId}/catalog`), "Cardápio da SAIPOS carregado"); if (r) setMap(r.suggestions); }}>Importar códigos PDV</Btn>
      </div>
      {cur.data && <Field label="URL do webhook (cole em Saipos Developer › Configuração)"><div className="codebox">{cur.data.webhookUrl}</div></Field>}
    </section>
    <div className="stack">
      <section className="panel"><header><h2>Critérios de homologação</h2><span className="small muted num">{hom.data?.done ?? 0} de {hom.data?.criteria.length ?? 0}</span></header>
        <p className="small muted">Marcados a partir dos pedidos já enviados. Faça pedidos de teste cobrindo cada caso e envie as evidências no pedido de homologação.</p>
        <div className="list">{(hom.data?.criteria || []).map((x) => <div key={x.label} className="li small"><span className={`pill ${x.ok ? "good" : ""}`}>{x.ok ? "✓" : "—"}</span><span className="grow">{x.label}</span></div>)}</div>
      </section>
    </div>
    {map && <section className="panel" style={{ gridColumn: "1 / -1" }}>
      <header><h2>De-para de códigos PDV</h2><p>Sugestão por semelhança de nome. Confira e aplique.</p></header>
      <div className="tablewrap"><table><thead><tr><th>No cardápio</th><th>Código atual</th><th>Sugestão SAIPOS</th><th className="r">Confiança</th></tr></thead><tbody>
        {map.map((m) => <><tr key={m.itemId}><td><b>{m.itemName}</b></td><td className="mono">{m.current || "—"}</td><td>{m.match ? <span className="mono">{m.match.code}</span> : <span className="muted">sem par</span>} <span className="small muted">{m.match?.name}</span></td><td className="r">{m.match ? `${Math.round(m.match.score * 100)}%` : ""}</td></tr>
          {m.options.filter((o) => o.match && o.match.code !== o.current).slice(0, 6).map((o) => <tr key={m.itemId + o.optionId}><td className="small" style={{ paddingLeft: 26 }}>{o.name}</td><td className="mono small">{o.current || "—"}</td><td className="mono small">{o.match!.code} <span className="muted">{o.match!.name}</span></td><td className="r small">{Math.round(o.match!.score * 100)}%</td></tr>)}</>)}
      </tbody></table></div>
      <div className="row"><Btn kind="primary" disabled={busy} onClick={async () => { const items = map.filter((m) => m.match).map((m) => ({ itemId: m.itemId, code: m.match!.code })); const options = map.flatMap((m) => m.options.filter((o) => o.match).map((o) => ({ groupId: o.groupId, optionId: o.optionId, code: o.match!.code }))); if (await run(() => api.post("/admin/integrations/saipos/apply-mapping", { items, options }), "Códigos aplicados")) setMap(null); }}>Aplicar sugestões</Btn><Btn onClick={() => setMap(null)}>Fechar</Btn></div>
    </section>}
  </div>;
}

type Job = { id: string; kind: string; filename: string; headers: string[]; mapping: Record<string, string>; total: number; preview: Record<string, string>[]; status: string; createdAt: string; report?: { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] } };
function Imports() {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const fields = useLoad<Record<string, { key: string; label: string; required?: boolean }[]>>("/admin/imports/fields");
  const hist = useLoad<Job[]>("/admin/imports");
  const [kind, setKind] = useState<"customers" | "orders">("customers");
  const [job, setJob] = useState<Job | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  return <div className="stack">
    <section className="panel">
      <header><h2>Enviar planilha</h2><p>CSV ou XLSX exportado do PDV, do iFood, do Power BI ou de qualquer planilha. Telefone vira a chave do cliente; reenviar o mesmo arquivo atualiza em vez de duplicar.</p></header>
      <div className="row"><Select value={kind} onChange={setKind} options={[{ value: "customers", label: "Clientes" }, { value: "orders", label: "Pedidos (histórico)" }]} />
        <input ref={ref} type="file" hidden accept=".csv,.xlsx,.xls,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append("kind", kind); fd.append("file", f); try { setJob(await api.upload<Job>("/admin/imports", fd)); } catch (er) { toast(errMsg(er), true); } e.target.value = ""; }} />
        <Btn kind="primary" onClick={() => ref.current?.click()}>Escolher arquivo</Btn></div>
    </section>
    {job && <section className="panel"><header><h2>{job.filename}</h2><span className="small muted">{job.total} linhas</span></header>
      <div className="grid3">{(fields.data?.[job.kind] || []).map((f) => <Field key={f.key} label={f.label + (f.required ? " *" : "")}><Select value={job.mapping[f.key] || ""} onChange={(v) => setJob({ ...job, mapping: { ...job.mapping, [f.key]: v } })} options={[{ value: "", label: "— não importar —" }, ...job.headers.map((h) => ({ value: h, label: h }))]} /></Field>)}</div>
      <div className="tablewrap"><table><thead><tr>{job.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{job.preview.map((r, i) => <tr key={i}>{job.headers.map((h) => <td key={h} className="small">{String(r[h] ?? "")}</td>)}</tr>)}</tbody></table></div>
      {job.report ? <p className="sentence"><b>{job.report.created}</b> novos, <b>{job.report.updated}</b> atualizados, <b>{job.report.skipped}</b> ignorados{job.report.errors[0] ? ` (linha ${job.report.errors[0].row}: ${job.report.errors[0].message})` : ""}.</p>
        : <div><Btn kind="primary" disabled={busy} onClick={async () => { const r = await run(() => api.post<Job["report"]>(`/admin/imports/${job.id}/commit`, { mapping: job.mapping }), "Importação concluída"); if (r) { setJob({ ...job, report: r }); hist.reload(); } }}>Importar {job.total} linhas</Btn></div>}
    </section>}
    <section className="panel"><header><h3>Histórico</h3></header>
      {(hist.data || []).length ? <div className="list">{hist.data!.map((j) => <div key={j.id} className="li"><Pill tone={j.status === "concluida" ? "good" : "warn"}>{j.status}</Pill><span className="grow">{j.filename} <span className="small muted">· {j.kind === "customers" ? "clientes" : "pedidos"} · {j.total} linhas</span></span>{j.report && <span className="small num">{j.report.created} novos · {j.report.updated} atualizados</span>}<span className="small muted">{dt(j.createdAt)}</span></div>)}</div> : <Empty title="Nenhuma importação ainda" />}
    </section>
  </div>;
}

function ApiKeys() {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const keys = useLoad<{ id: string; name: string; prefix: string; scopes: string[]; createdAt: string }[]>("/admin/api-keys");
  const hooks = useLoad<{ id: string; url: string; events: string[]; active: boolean }[]>("/admin/webhooks");
  const [nk, setNk] = useState({ name: "ERP", scopes: ["customers:write", "orders:write"] as string[] });
  const [raw, setRaw] = useState<string | null>(null);
  const [wh, setWh] = useState({ url: "https://", events: ["order.created", "order.status"] as string[] });
  const base = typeof location !== "undefined" && location.protocol.startsWith("http") ? `${location.origin}` : "https://api.seudominio.com";
  return <div className="split">
    <div className="stack">
      <section className="panel"><header><h2>Chaves de API</h2><p>Para o seu sistema enviar clientes, pedidos e eventos</p></header>
        <div className="list">{(keys.data || []).map((k) => <div key={k.id} className="li"><span className="mono">{k.prefix}…</span><span className="grow">{k.name} <span className="small muted">· {k.scopes.join(", ")}</span></span><ConfirmBtn sm label="Revogar" confirm="Revogar a chave?" onConfirm={async () => { await run(() => api.del(`/admin/api-keys/${k.id}`), "Chave revogada"); keys.reload(); }} /></div>)}</div>
        <div className="grid2"><Field label="Nome"><Text value={nk.name} onChange={(v) => setNk({ ...nk, name: v })} /></Field>
          <Field label="Permissões"><Chips value={nk.scopes} onChange={(v) => setNk({ ...nk, scopes: v })} options={["customers:write", "orders:write", "menu:read", "events:write"].map((s) => ({ value: s, label: s }))} /></Field></div>
        <div><Btn kind="primary" disabled={busy} onClick={async () => { const r = await run(() => api.post<{ key: string }>("/admin/api-keys", nk), "Chave criada"); if (r) { setRaw(r.key); keys.reload(); } }}>Criar chave</Btn></div>
        {raw && <div className="issue aviso"><div className="stack" style={{ gap: 4 }}><b>Copie agora: ela não aparece de novo.</b><span className="mono" style={{ wordBreak: "break-all" }}>{raw}</span><Btn sm onClick={() => navigator.clipboard?.writeText(raw).catch(() => {})}>Copiar</Btn></div></div>}
      </section>
      <section className="panel"><header><h2>Webhooks de saída</h2><p>Avisamos o seu sistema a cada evento, com assinatura HMAC no cabeçalho x-superapp-signature</p></header>
        <div className="list">{(hooks.data || []).map((h) => <div key={h.id} className="li"><span className="grow mono small" style={{ wordBreak: "break-all" }}>{h.url}</span><span className="small">{h.events.join(", ")}</span><ConfirmBtn sm label="Remover" confirm="Remover?" onConfirm={async () => { await run(() => api.del(`/admin/webhooks/${h.id}`), "Removido"); hooks.reload(); }} /></div>)}</div>
        <Field label="URL"><Text type="url" value={wh.url} onChange={(v) => setWh({ ...wh, url: v })} /></Field>
        <Chips value={wh.events} onChange={(v) => setWh({ ...wh, events: v })} options={["order.created", "order.status", "customer.created", "page.response"].map((e) => ({ value: e, label: e }))} />
        <div><Btn disabled={busy} onClick={async () => { if (await run(() => api.post("/admin/webhooks", { ...wh, secret: crypto.randomUUID(), active: true }), "Webhook criado")) hooks.reload(); }}>Adicionar webhook</Btn></div>
      </section>
    </div>
    <section className="panel"><header><h2>Como chamar</h2></header>
      <p className="small muted">Clientes (até 1.000 por chamada; telefone é a chave):</p>
      <div className="codebox">{`curl -X POST ${base}/v1/customers \\
  -H "Authorization: Bearer cw_live_..." \\
  -H "content-type: application/json" \\
  -d '[{"phone":"21999998888","name":"Ana","optinWhatsapp":true}]'`}</div>
      <p className="small muted">Pedidos históricos (alimentam RFM, ciclo e 2º pedido):</p>
      <div className="codebox">{`curl -X POST ${base}/v1/orders -H "Authorization: Bearer cw_live_..." \\
  -d '[{"externalId":"123","createdAt":"2026-10-01T20:10:00-03:00","total":119,
        "channel":"ifood","customer":{"phone":"21999998888"}}]'`}</div>
      <p className="small muted">Cardápio publicado: <span className="mono">GET /v1/menu</span> · Eventos de navegação: <span className="mono">POST /v1/events</span></p>
    </section>
  </div>;
}

function Users() {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const users = useLoad<{ id: string; name: string; email: string; role: string }[]>("/admin/users");
  const [u, setU] = useState({ name: "", email: "", password: "", role: "manager" as "owner" | "manager" | "analyst" });
  return <section className="panel"><header><h2>Equipe</h2><p>Dono configura tudo; gerente edita cardápio e campanhas; analista só consulta e usa o CRM</p></header>
    <div className="list">{(users.data || []).map((x) => <div key={x.id} className="li"><span className="grow"><b>{x.name}</b> <span className="small muted">{x.email}</span></span><Pill>{x.role === "owner" ? "dono" : x.role === "manager" ? "gerente" : "analista"}</Pill></div>)}</div>
    <div className="grid2"><Field label="Nome"><Text value={u.name} onChange={(v) => setU({ ...u, name: v })} /></Field><Field label="E-mail"><Text type="email" value={u.email} onChange={(v) => setU({ ...u, email: v })} /></Field>
      <Field label="Senha inicial"><Text type="password" value={u.password} onChange={(v) => setU({ ...u, password: v })} /></Field><Field label="Perfil"><Select value={u.role} onChange={(v) => setU({ ...u, role: v })} options={[{ value: "manager", label: "Gerente" }, { value: "analyst", label: "Analista" }, { value: "owner", label: "Dono" }]} /></Field></div>
    <div><Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.post("/admin/users", u), "Pessoa adicionada")) { setU({ name: "", email: "", password: "", role: "manager" }); users.reload(); } }}>Adicionar</Btn></div>
  </section>;
}
