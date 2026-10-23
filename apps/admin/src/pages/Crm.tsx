import { useState } from "react";
import { RFM_LABEL, type Automation, type AutomationTrigger, type Coupon, type Customer, type Page, type RfmSegment, type Segment, type SegmentRule } from "@cw/core";
import { Bars, Funnel, LineChart } from "../charts";
import { BRL, Btn, Chips, ConfirmBtn, Delta, Drawer, Empty, Field, Num, Pill, Select, Tabs, Text, Tile, Toggle, day, dt, pct, useAction, useAdmin, useLoad } from "../ui";
import { STATUS } from "./Orders";

type Seg = { orders: number; revenue: number; avgTicket: number; discount: number };
type K = { visits: number; orders: number; conversion: number; revenue: number; avgTicket: number; upt: number; secondOrderRate60d: number; secondOrderCohort: number; avgIntervalDays: number; activeCustomers90d: number; novos: Seg; recorrentes: Seg; couponCost: number; cashbackIssued: number; freeDeliveryCost: number; serviceFees: number; cancelled: number; funnel: { label: string; sessions: number; pctOfVisits: number; pctOfPrev: number; dropFromPrev: number }[] };
type FRow = { label: string; sessions: number; pctOfVisits: number; pctOfPrev: number; dropFromPrev: number };

export function CrmPage() {
  const [days, setDays] = useState("30");
  const [by, setBy] = useState("source");
  const ov = useLoad<{ current: K; previous: K; series: { day: string; visits: number; orders: number; revenue: number }[] }>(`/admin/crm/overview?days=${days}`, [days]);
  const fb = useLoad<{ by: { key: string; rows: FRow[] }[] }>(`/admin/crm/funnel?days=${days}&by=${by}`, [days, by]);
  const fr = useLoad<{ items: { itemId: string; views: number; adds: number; rate: number }[]; signals: Record<string, number> }>(`/admin/crm/friction?days=${days}`, [days]);
  const rfm = useLoad<Record<string, { label: string; customers: number; spent: number }>>("/admin/crm/rfm");
  const items = useLoad<{ id: string; name: string }[]>("/admin/items");
  const c = ov.data?.current, p = ov.data?.previous;
  const IN = Object.fromEntries((items.data || []).map((i) => [i.id, i.name.split(" · ")[0]]));
  return <>
    <div className="pagehead"><div><h1>Painel e funil</h1><p>Cada indicador compara o período escolhido com o anterior de mesmo tamanho, sempre no mesmo perfil: novos com novos, recorrentes com recorrentes.</p></div>
      <Select value={days} onChange={setDays} options={[{ value: "7", label: "Últimos 7 dias" }, { value: "30", label: "Últimos 30 dias" }, { value: "90", label: "Últimos 90 dias" }]} /></div>
    {c && p && <>
      <div className="grid4">
        <Tile k="Conversão visita → pedido" v={pct(c.conversion)} d={<Delta cur={c.conversion} prev={p.conversion} />} />
        <Tile k="Faturamento" v={BRL(c.revenue)} d={<Delta cur={c.revenue} prev={p.revenue} />} />
        <Tile k="2º pedido em 60 dias" v={pct(c.secondOrderRate60d)} d={<span className="muted">base: {c.secondOrderCohort} clientes</span>} />
        <Tile k="Itens por pedido (UPT)" v={c.upt.toFixed(2).replace(".", ",")} d={<Delta cur={c.upt} prev={p.upt} />} />
      </div>
      <section className="panel"><header><h2>Novos × recorrentes</h2><p>Mesmo perfil nos dois períodos</p></header>
        <div className="tablewrap"><table>
          <thead><tr><th>Perfil</th><th className="r">Pedidos</th><th className="r">vs anterior</th><th className="r">Ticket médio</th><th className="r">vs anterior</th><th className="r">Desconto + cashback</th></tr></thead>
          <tbody>{(["novos", "recorrentes"] as const).map((k) => <tr key={k}><td><b>{k === "novos" ? "Novos (1º pedido)" : "Recorrentes"}</b></td><td className="r">{c[k].orders}</td><td className="r small"><Delta cur={c[k].orders} prev={p[k].orders} suffix="" /></td><td className="r">{BRL(c[k].avgTicket)}</td><td className="r small"><Delta cur={c[k].avgTicket} prev={p[k].avgTicket} suffix="" /></td><td className="r">{BRL(c[k].discount)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <div className="grid2">
        <section className="panel"><header><h2>Faturamento por dia</h2></header>
          <LineChart labels={(ov.data!.series || []).map((s) => day(s.day + "T12:00:00"))} series={[{ name: "Faturamento", values: ov.data!.series.map((s) => s.revenue), color: "var(--s1)" }]} format={(v) => (v >= 1000 ? `R$ ${(v / 1000).toFixed(1).replace(".", ",")} mil` : `R$ ${v.toFixed(0)}`)} />
        </section>
        <section className="panel"><header><h2>Funil de navegação</h2><p>Sessões que chegaram a cada etapa</p></header><Funnel rows={c.funnel} /></section>
      </div>
      <div className="grid4">
        <Tile k="Custo de cupons" v={BRL(c.couponCost)} d={<Delta cur={c.couponCost} prev={p.couponCost} invert />} />
        <Tile k="Frete grátis concedido" v={BRL(c.freeDeliveryCost)} d={<Delta cur={c.freeDeliveryCost} prev={p.freeDeliveryCost} invert />} />
        <Tile k="Taxas de serviço" v={BRL(c.serviceFees)} d={<span className="muted">pedidos abaixo do mínimo</span>} />
        <Tile k="Cashback emitido" v={BRL(c.cashbackIssued)} d={<span className="muted">intervalo médio {c.avgIntervalDays.toFixed(0)} dias</span>} />
      </div>
    </>}
    <section className="panel"><header><h2>Funil por {by === "source" ? "origem" : by === "device" ? "dispositivo" : by === "hour" ? "hora" : "perfil"}</h2>
      <Select value={by} onChange={setBy} options={[{ value: "source", label: "Origem" }, { value: "device", label: "Dispositivo" }, { value: "hour", label: "Hora" }, { value: "profile", label: "Perfil" }]} /></header>
      <div className="tablewrap"><table><thead><tr><th>{by === "source" ? "Origem" : "Grupo"}</th>{(fb.data?.by[0]?.rows || []).map((r) => <th key={r.label} className="r">{r.label}</th>)}<th className="r">Conversão</th></tr></thead>
        <tbody>{(fb.data?.by || []).map((g) => <tr key={g.key}><td><b>{g.key}</b></td>{g.rows.map((r) => <td key={r.label} className="r">{r.sessions}</td>)}<td className="r"><b>{pct(g.rows[5]?.pctOfVisits || 0)}</b></td></tr>)}</tbody></table></div>
    </section>
    <div className="grid2">
      <section className="panel"><header><h2>Onde a pessoa trava</h2><p>Itens mais abertos sem ir para a sacola</p></header>
        <Bars rows={(fr.data?.items || []).slice(0, 7).map((i) => ({ label: IN[i.itemId] || i.itemId, value: i.rate, note: `${i.views} aberturas` }))} format={(v) => pct(v) + " adicionam"} color="var(--s2)" />
        {fr.data && <div className="chips small">{Object.entries({ hesitations: "hesitações na revisão", popupsShown: "pop-ups exibidos", popupsUsed: "cupons do pop-up usados", couponErrors: "cupons recusados", outOfArea: "fora da área", searchNoResult: "buscas sem resultado" }).map(([k, l]) => <span key={k} className="pill">{fr.data!.signals[k] || 0} {l}</span>)}</div>}
      </section>
      <section className="panel"><header><h2>Base por RFM</h2><p>Recência e frequência</p></header>
        <Bars rows={Object.values(rfm.data || {}).map((r) => ({ label: r.label, value: r.customers, note: BRL(r.spent) }))} format={(v) => `${v} clientes`} />
      </section>
    </div>
  </>;
}

/* ---------------- clientes ---------------- */
type CRow = Customer & { rfm: RfmSegment; avgTicket: number; daysSinceLastOrder?: number };
export function CustomersPage() {
  const [q, setQ] = useState(""); const [rf, setRf] = useState(""); const [seg, setSeg] = useState("");
  const segs = useLoad<Segment[]>("/admin/segments");
  const list = useLoad<{ total: number; rows: CRow[] }>(`/admin/crm/customers?limit=80&q=${encodeURIComponent(q)}&rfm=${rf}&segment=${seg}`, [q, rf, seg]);
  const [open, setOpen] = useState<string | null>(null);
  return <>
    <div className="pagehead"><div><h1>Clientes</h1><p>Base unificada: cardápio próprio, planilhas importadas e API. Telefone é a chave.</p></div>
      <div className="row"><input type="text" placeholder="Nome, telefone ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="Buscar cliente" />
        <Select value={rf} onChange={setRf} options={[{ value: "", label: "Todo RFM" }, ...Object.entries(RFM_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select value={seg} onChange={setSeg} options={[{ value: "", label: "Todos os segmentos" }, ...(segs.data || []).map((s) => ({ value: s.id, label: s.name }))]} /></div></div>
    <p className="small muted">{list.data?.total ?? 0} clientes</p>
    <div className="tablewrap"><table>
      <thead><tr><th>Cliente</th><th>RFM</th><th className="r">Pedidos</th><th className="r">Gasto</th><th className="r">Ticket</th><th className="r">Última compra</th><th>WhatsApp</th><th>Origem</th></tr></thead>
      <tbody>{(list.data?.rows || []).map((c) => <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
        <td><b>{c.name || "Sem nome"}</b><div className="small muted mono">{c.phone}</div></td><td><Pill tone={c.rfm === "campeoes" || c.rfm === "fieis" ? "good" : c.rfm === "em_risco" || c.rfm === "perdidos" ? "bad" : c.rfm === "hibernando" ? "warn" : "accent"}>{RFM_LABEL[c.rfm]}</Pill></td>
        <td className="r">{c.orders}</td><td className="r">{BRL(c.spent)}</td><td className="r">{BRL(c.avgTicket)}</td><td className="r">{c.daysSinceLastOrder != null ? `há ${c.daysSinceLastOrder} d` : "—"}</td><td>{c.optinWhatsapp ? <Pill tone="good">aceita</Pill> : <Pill>não</Pill>}</td><td>{c.source || "—"}</td></tr>)}</tbody>
    </table></div>
    {open && <Customer360 id={open} onClose={() => { setOpen(null); list.reload(); }} />}
  </>;
}

type C360 = { customer: Customer; rfm: RfmSegment; segments: { id: string; name: string }[]; wallet: { balance: number; expiringSoon: number }; ledger: { id: string; type: string; amount: number; createdAt: string; note?: string; expiresAt?: string }[]; orders: { id: string; displayId: string; total: number; status: keyof typeof STATUS; createdAt: string; lines: { name: string; qty: number }[] }[]; messages: { id: string; text: string; group: string; createdAt: string }[]; timeline: { name: string; ts: string; props?: Record<string, unknown> }[]; prediction: { avgIntervalDays: number; nextOrderAround: string; overdue: boolean } | null; favorites: { name: string; n: number }[] };
function Customer360(p: { id: string; onClose: () => void }) {
  const { api } = useAdmin(); const { run } = useAction();
  const d = useLoad<C360>(`/admin/crm/customers/${p.id}`);
  const [tab, setTab] = useState<"resumo" | "pedidos" | "navegacao" | "carteira">("resumo");
  const [adj, setAdj] = useState({ amount: 10, note: "" });
  if (!d.data) return null;
  const x = d.data; const c = x.customer;
  return <Drawer title={c.name || c.phone || "Cliente"} onClose={p.onClose}>
    <div className="row"><Pill tone="accent">{RFM_LABEL[x.rfm]}</Pill>{x.segments.map((s) => <Pill key={s.id}>{s.name}</Pill>)}<span className="mono small muted">{c.phone}</span></div>
    <div className="grid4"><Tile k="Pedidos" v={c.orders} /><Tile k="Gasto" v={BRL(c.spent)} /><Tile k="Cashback" v={BRL(x.wallet.balance)} d={x.wallet.expiringSoon ? <span className="down">{BRL(x.wallet.expiringSoon)} vencendo</span> : undefined} /><Tile k="Próxima compra" v={x.prediction ? day(x.prediction.nextOrderAround + "T12:00:00") : "—"} d={x.prediction ? <span className={x.prediction.overdue ? "down" : "muted"}>{x.prediction.overdue ? "atrasado" : `ciclo de ${x.prediction.avgIntervalDays.toFixed(0)} dias`}</span> : undefined} /></div>
    <Tabs value={tab} onChange={setTab} tabs={[{ value: "resumo", label: "Resumo" }, { value: "pedidos", label: "Pedidos" }, { value: "navegacao", label: "Navegação" }, { value: "carteira", label: "Cashback" }]} />
    {tab === "resumo" && <>
      <Field label="Preferidos"><div className="chips">{x.favorites.map((f) => <span key={f.name} className="pill">{f.name} · {f.n}×</span>)}</div></Field>
      <Toggle checked={!!c.optinWhatsapp} onChange={async (v) => { await run(() => api.patch(`/admin/crm/customers/${c.id}`, { optinWhatsapp: v }), "Atualizado"); d.reload(); }} label="Aceita mensagens no WhatsApp" />
      <Field label="Etiquetas"><Text value={(c.tags || []).join(", ")} onChange={(v) => d.setData({ ...x, customer: { ...c, tags: v.split(",").map((t) => t.trim()).filter(Boolean) } })} /></Field>
      <div><Btn sm onClick={() => run(() => api.patch(`/admin/crm/customers/${c.id}`, { tags: c.tags || [] }), "Etiquetas salvas")}>Salvar etiquetas</Btn></div>
      <section className="panel"><header><h3>Mensagens</h3></header>{x.messages.length ? <div className="list">{x.messages.map((m) => <div key={m.id} className="li"><Pill tone={m.group === "controle" ? "warn" : "good"}>{m.group}</Pill><span className="grow small">{m.text}</span><span className="small muted">{dt(m.createdAt)}</span></div>)}</div> : <span className="small muted">Nenhuma ainda</span>}</section>
    </>}
    {tab === "pedidos" && <div className="list">{x.orders.map((o) => <div key={o.id} className="li"><span className="mono">#{o.displayId}</span><span className="grow small">{o.lines.map((l) => `${l.qty}× ${l.name.split(" · ")[0]}`).join(", ") || "pedido importado"}</span><Pill tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label || o.status}</Pill><span className="num">{BRL(o.total)}</span><span className="small muted">{dt(o.createdAt)}</span></div>)}</div>}
    {tab === "navegacao" && (x.timeline.length ? <div className="list">{[...x.timeline].reverse().slice(0, 60).map((e, i) => <div key={i} className="li"><span className="pill">{e.name}</span><span className="grow small muted">{e.props?.itemId ? String(e.props.itemId) : ""}</span><span className="small muted">{dt(e.ts)}</span></div>)}</div> : <Empty title="Sem eventos de navegação" />)}
    {tab === "carteira" && <>
      <div className="list">{x.ledger.map((l) => <div key={l.id} className="li"><span className="pill">{l.type}</span><span className="grow small">{l.note || ""}{l.expiresAt ? ` · vence ${day(l.expiresAt)}` : ""}</span><span className={`num ${l.amount < 0 ? "down" : "up"}`}>{BRL(l.amount)}</span><span className="small muted">{dt(l.createdAt)}</span></div>)}</div>
      <section className="panel"><header><h3>Ajuste manual</h3></header><div className="grid3"><Field label="Valor (negativo para debitar)"><Num value={adj.amount} onChange={(v) => setAdj({ ...adj, amount: v ?? 0 })} /></Field><Field label="Motivo"><Text value={adj.note} onChange={(v) => setAdj({ ...adj, note: v })} /></Field><div style={{ alignSelf: "end" }}><Btn onClick={async () => { await run(() => api.post(`/admin/crm/customers/${c.id}/ledger`, { ...adj, expiresInDays: 45 }), "Ajuste lançado"); d.reload(); }}>Lançar</Btn></div></div></section>
    </>}
  </Drawer>;
}

/* ---------------- segmentos ---------------- */
const RULES: { value: SegmentRule["field"]; label: string; make: () => SegmentRule }[] = [
  { value: "orders", label: "Pedidos", make: () => ({ field: "orders", op: ">=", value: 2 }) },
  { value: "days_since_last_order", label: "Dias desde a última compra", make: () => ({ field: "days_since_last_order", op: ">=", value: 30 }) },
  { value: "spent", label: "Gasto total", make: () => ({ field: "spent", op: ">=", value: 500 }) },
  { value: "avg_ticket", label: "Ticket médio", make: () => ({ field: "avg_ticket", op: ">=", value: 100 }) },
  { value: "rfm", label: "RFM", make: () => ({ field: "rfm", op: "in", value: ["em_risco"] }) },
  { value: "source", label: "Origem", make: () => ({ field: "source", op: "in", value: ["instagram"] }) },
  { value: "optin_whatsapp", label: "Aceita WhatsApp", make: () => ({ field: "optin_whatsapp", op: "=", value: true }) },
  { value: "tag", label: "Etiqueta", make: () => ({ field: "tag", op: "in", value: [] }) },
];
export function SegmentsPage() {
  const list = useLoad<Segment[]>("/admin/segments");
  const [edit, setEdit] = useState<Partial<Segment> | null>(null);
  return <>
    <div className="pagehead"><div><h1>Segmentos</h1><p>Grupos de clientes por regra. Servem para banners, cupons e automações.</p></div><Btn kind="primary" onClick={() => setEdit({ name: "", rules: [] })}>Novo segmento</Btn></div>
    <div className="list">{(list.data || []).map((s) => <SegRow key={s.id} s={s} onOpen={() => setEdit(s)} />)}</div>
    {edit && <SegEditor s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
  </>;
}
function SegRow(p: { s: Segment; onOpen: () => void }) {
  const pv = useLoad<{ count: number; optin: number; spent: number }>(`/admin/crm/segments/${p.s.id}/preview`);
  return <div className="li click" onClick={p.onOpen} role="button" tabIndex={0}><div className="grow"><b>{p.s.name}</b><span className="small muted">{p.s.description || `${p.s.rules.length} regra(s)`}</span></div>
    {pv.data && <><span className="pill num">{pv.data.count} clientes</span><span className="pill good num">{pv.data.optin} no WhatsApp</span><span className="num small">{BRL(pv.data.spent)}</span></>}</div>;
}
function SegEditor(p: { s: Partial<Segment>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const [s, setS] = useState<Partial<Segment>>(p.s);
  const rules = s.rules || [];
  const upd = (i: number, r: Partial<SegmentRule>) => setS({ ...s, rules: rules.map((x, j) => (j === i ? ({ ...x, ...r } as SegmentRule) : x)) });
  const save = async () => { const r = await run(() => (s.id ? api.put(`/admin/segments/${s.id}`, s) : api.post("/admin/segments", s)), "Segmento salvo"); if (r) p.onSaved(); };
  return <Drawer title={s.id ? s.name : "Novo segmento"} onClose={p.onClose} footer={<>{s.id ? <ConfirmBtn label="Excluir" confirm="Excluir?" onConfirm={async () => { await run(() => api.del(`/admin/segments/${s.id}`), "Excluído"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar</Btn></>}>
    <Field label="Nome"><Text id="seg-name" value={s.name} onChange={(v) => setS({ ...s, name: v })} /></Field>
    <Field label="Descrição"><Text value={s.description} onChange={(v) => setS({ ...s, description: v })} /></Field>
    {rules.map((r, i) => <div key={i} className="rulebox">
      <Select value={r.field} onChange={(f) => setS({ ...s, rules: rules.map((x, j) => (j === i ? RULES.find((y) => y.value === f)!.make() : x)) })} options={RULES.map((x) => ({ value: x.value, label: x.label }))} />
      <div className="row">
        {(r.field === "orders" || r.field === "days_since_last_order" || r.field === "spent" || r.field === "avg_ticket") && <><Select value={r.op} onChange={(op) => upd(i, { op } as never)} options={[{ value: ">=", label: "≥" }, { value: "<=", label: "≤" }, ...(r.field === "orders" ? [{ value: "=", label: "=" }] : [])]} /><Num value={r.value} onChange={(v) => upd(i, { value: v ?? 0 } as never)} /></>}
        {r.field === "rfm" && <Chips value={r.value} onChange={(v) => upd(i, { value: v } as never)} options={Object.entries(RFM_LABEL).map(([v, l]) => ({ value: v as RfmSegment, label: l }))} />}
        {(r.field === "source" || r.field === "tag") && <Text value={r.value.join(", ")} onChange={(v) => upd(i, { value: v.split(",").map((t) => t.trim()).filter(Boolean) } as never)} />}
        {r.field === "optin_whatsapp" && <Toggle checked={r.value} onChange={(v) => upd(i, { value: v } as never)} label={r.value ? "sim" : "não"} />}
      </div>
      <Btn sm kind="ghost" onClick={() => setS({ ...s, rules: rules.filter((_, j) => j !== i) })}>✕</Btn>
    </div>)}
    <div><Btn sm onClick={() => setS({ ...s, rules: [...rules, RULES[0].make()] })}>Adicionar regra</Btn></div>
  </Drawer>;
}

/* ---------------- automações ---------------- */
const TRIG: { value: AutomationTrigger["kind"]; label: string; make: () => AutomationTrigger }[] = [
  { value: "cart_abandoned", label: "Sacola esquecida", make: () => ({ kind: "cart_abandoned", afterMinutes: 30 }) },
  { value: "days_after_first_order", label: "Dias depois do 1º pedido", make: () => ({ kind: "days_after_first_order", days: 7 }) },
  { value: "no_order_cycle", label: "Passou do ciclo de compra", make: () => ({ kind: "no_order_cycle", multiplier: 1.5 }) },
  { value: "order_concluded", label: "Depois da entrega", make: () => ({ kind: "order_concluded", afterMinutes: 60 }) },
  { value: "cashback_expiring", label: "Cashback vencendo", make: () => ({ kind: "cashback_expiring", daysBefore: 5 }) },
  { value: "birthday", label: "Aniversário", make: () => ({ kind: "birthday" }) },
];
export function AutomationsPage() {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const list = useLoad<Automation[]>("/admin/automations");
  const rep = useLoad<{ id: string; name: string; envio: { n: number; conv: number; rate: number }; controle: { n: number; rate: number }; incremento: number | null }[]>("/admin/crm/automations/report");
  const msgs = useLoad<{ id: string; text: string; group: string; status: string; createdAt: string }[]>("/admin/crm/messages");
  const [edit, setEdit] = useState<Partial<Automation> | null>(null);
  const R = Object.fromEntries((rep.data || []).map((r) => [r.id, r]));
  return <>
    <div className="pagehead"><div><h1>Automações</h1><p>Mensagens de WhatsApp disparadas pelo comportamento. Uma parte da base fica sem receber (grupo de controle) para medir o que a mensagem realmente trouxe.</p></div>
      <div className="row"><Btn disabled={busy} onClick={async () => { const r = await run(() => api.post<{ created: number; controle: number }>("/admin/crm/automations/run"), undefined); if (r) { toast(`${r.created} mensagens enviadas · ${r.controle} no grupo de controle`); rep.reload(); msgs.reload(); } }}>Rodar agora</Btn><Btn kind="primary" onClick={() => setEdit({ name: "", trigger: TRIG[0].make(), channel: "whatsapp", template: "Oi {{nome}}! ", holdoutPercent: 10, maxPerCustomerPerWeek: 1, active: true })}>Nova automação</Btn></div></div>
    <div className="tablewrap"><table>
      <thead><tr><th>Automação</th><th>Gatilho</th><th className="r">Enviadas</th><th className="r">Conversão 7d</th><th className="r">Controle</th><th className="r">Incremento</th><th /></tr></thead>
      <tbody>{(list.data || []).map((a) => { const r = R[a.id]; return <tr key={a.id} className="click" onClick={() => setEdit(a)}>
        <td><b>{a.name}</b></td><td className="small">{TRIG.find((t) => t.value === a.trigger.kind)?.label}</td>
        <td className="r">{r?.envio.n ?? 0}</td><td className="r">{r ? pct(r.envio.rate) : "—"}</td><td className="r">{r?.controle.n ? pct(r.controle.rate) : "—"}</td>
        <td className="r">{r?.incremento != null ? <span className={r.incremento > 0 ? "up" : "down"}>{r.incremento > 0 ? "+" : ""}{r.incremento.toFixed(1).replace(".", ",")} p.p.</span> : "—"}</td>
        <td>{a.active ? <Pill tone="good">ativa</Pill> : <Pill>pausada</Pill>}</td></tr>; })}</tbody>
    </table></div>
    <section className="panel"><header><h2>Últimas mensagens</h2><p>O envio real usa o provedor de WhatsApp configurado no servidor</p></header>
      {(msgs.data || []).length ? <div className="list">{msgs.data!.slice(0, 25).map((m) => <div key={m.id} className="li"><Pill tone={m.group === "controle" ? "warn" : "good"}>{m.group === "controle" ? "controle" : m.status}</Pill><span className="grow small">{m.text}</span><span className="small muted">{dt(m.createdAt)}</span></div>)}</div> : <Empty title="Nada enviado ainda">Use “Rodar agora” para processar os gatilhos.</Empty>}
    </section>
    {edit && <AutoEditor a={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
  </>;
}
function AutoEditor(p: { a: Partial<Automation>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const segs = useLoad<Segment[]>("/admin/segments"); const coupons = useLoad<Coupon[]>("/admin/coupons"); const pages = useLoad<Page[]>("/admin/pages");
  const tpls = useLoad<{ id: string; name: string; channel: string }[]>("/admin/message_templates");
  const [a, setA] = useState<Partial<Automation>>(p.a);
  const t = a.trigger!;
  const save = async () => { const r = await run(() => (a.id ? api.put(`/admin/automations/${a.id}`, a) : api.post("/admin/automations", a)), "Automação salva"); if (r) p.onSaved(); };
  return <Drawer title={a.id ? a.name : "Nova automação"} onClose={p.onClose} footer={<>{a.id ? <ConfirmBtn label="Excluir" confirm="Excluir?" onConfirm={async () => { await run(() => api.del(`/admin/automations/${a.id}`), "Excluída"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar</Btn></>}>
    <Field label="Nome"><Text id="au-name" value={a.name} onChange={(v) => setA({ ...a, name: v })} /></Field>
    <div className="grid2">
      <Field label="Gatilho"><Select value={t.kind} onChange={(k) => setA({ ...a, trigger: TRIG.find((x) => x.value === k)!.make() })} options={TRIG.map((x) => ({ value: x.value, label: x.label }))} /></Field>
      {"afterMinutes" in t && <Field label="Depois de (minutos)"><Num value={t.afterMinutes} onChange={(v) => setA({ ...a, trigger: { ...t, afterMinutes: v ?? 30 } as AutomationTrigger })} /></Field>}
      {"days" in t && <Field label="Dias"><Num value={t.days} onChange={(v) => setA({ ...a, trigger: { ...t, days: v ?? 7 } as AutomationTrigger })} /></Field>}
      {"multiplier" in t && <Field label="Vezes o intervalo médio do cliente"><Num value={t.multiplier} onChange={(v) => setA({ ...a, trigger: { ...t, multiplier: v ?? 1.5 } as AutomationTrigger })} /></Field>}
      {"daysBefore" in t && <Field label="Dias antes de vencer"><Num value={t.daysBefore} onChange={(v) => setA({ ...a, trigger: { ...t, daysBefore: v ?? 5 } as AutomationTrigger })} /></Field>}
      <Field label="Só para o segmento"><Select value={a.segmentId || ""} onChange={(v) => setA({ ...a, segmentId: v || undefined })} options={[{ value: "", label: "Todos com aceite" }, ...(segs.data || []).map((s) => ({ value: s.id, label: s.name }))]} /></Field>
      <Field label="Cupom ({{cupom}})"><Select value={a.couponId || ""} onChange={(v) => setA({ ...a, couponId: v || undefined })} options={[{ value: "", label: "Nenhum" }, ...(coupons.data || []).map((c) => ({ value: c.id, label: c.code || c.name }))]} /></Field>
      <Field label="Link para página ({{link}})"><Select value={a.pageId || ""} onChange={(v) => setA({ ...a, pageId: v || undefined })} options={[{ value: "", label: "Cardápio" }, ...(pages.data || []).map((c) => ({ value: c.id, label: c.title }))]} /></Field>
      <Field label="Grupo de controle (%)" hint="Não recebe; serve para medir o incremento"><Num value={a.holdoutPercent} onChange={(v) => setA({ ...a, holdoutPercent: v ?? 0 })} /></Field>
      <Field label="Máximo por cliente por semana"><Num value={a.maxPerCustomerPerWeek} onChange={(v) => setA({ ...a, maxPerCustomerPerWeek: v ?? 1 })} /></Field>
    </div>
    <div className="grid3">
      <Field label="Canal"><Select value={(a.channel || "whatsapp") as "whatsapp"} onChange={(v) => setA({ ...a, channel: v })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-mail" }, { value: "whatsapp_then_email", label: "WhatsApp; sem aceite, e-mail" } as never]} /></Field>
      {a.channel !== "email" && <Field label="Modelo de WhatsApp" hint="Fora da janela de 24h a Meta só aceita modelo aprovado"><Select value={a.templateId || ""} onChange={(v) => setA({ ...a, templateId: v || undefined })} options={[{ value: "", label: "Texto abaixo (só dentro de 24h)" }, ...(tpls.data || []).filter((x) => x.channel === "whatsapp").map((x) => ({ value: x.id, label: x.name }))]} /></Field>}
      {a.channel !== "whatsapp" && <Field label="Modelo de e-mail"><Select value={a.emailTemplateId || ""} onChange={(v) => setA({ ...a, emailTemplateId: v || undefined })} options={[{ value: "", label: "Escolha…" }, ...(tpls.data || []).filter((x) => x.channel === "email").map((x) => ({ value: x.id, label: x.name }))]} /></Field>}
    </div>
    <Field label="Texto (sem modelo)" hint="Variáveis: {{nome}} {{cupom}} {{link}} {{marca}} {{dias}} {{pedido}} {{cashback}}"><textarea id="au-tpl" value={a.template} onChange={(e) => setA({ ...a, template: e.target.value })} /></Field>
    <Toggle checked={!!a.active} onChange={(v) => setA({ ...a, active: v })} label="Ativa" />
  </Drawer>;
}
