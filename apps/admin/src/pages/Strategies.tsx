import { useMemo, useState } from "react";
import { applyStrategies, matches, type Condition, type Coupon, type Item, type Store, type Strategy, type StrategyAction } from "@cw/core";
import { BRL, Btn, Chips, ConfirmBtn, Drawer, Field, Num, Pill, Select, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FIELDS: { value: Condition["field"]; label: string; make: () => Condition }[] = [
  { value: "subtotal", label: "Valor dos itens", make: () => ({ field: "subtotal", op: ">=", value: 100 }) },
  { value: "customer_orders", label: "Pedidos do cliente", make: () => ({ field: "customer_orders", op: "=", value: 0 }) },
  { value: "days_since_last_order", label: "Dias desde a última compra", make: () => ({ field: "days_since_last_order", op: "between", min: 7, max: 10 }) },
  { value: "cart_has_item", label: "Sacola tem o item", make: () => ({ field: "cart_has_item", itemIds: [] }) },
  { value: "cart_has_category", label: "Sacola tem a categoria", make: () => ({ field: "cart_has_category", categoryIds: [] }) },
  { value: "weekday", label: "Dia da semana", make: () => ({ field: "weekday", values: [1, 2, 3] }) },
  { value: "time", label: "Horário", make: () => ({ field: "time", from: "18:00", to: "20:00" }) },
  { value: "zone", label: "Área de entrega", make: () => ({ field: "zone", zoneIds: [] }) },
  { value: "mode", label: "Entrega ou retirada", make: () => ({ field: "mode", values: ["DELIVERY"] }) },
  { value: "source", label: "Origem da visita", make: () => ({ field: "source", values: ["instagram"] }) },
  { value: "idle_seconds_without_add", label: "Tempo no cardápio sem adicionar", make: () => ({ field: "idle_seconds_without_add", value: 60 }) },
];

export function describeCondition(c: Condition, names: Record<string, string> = {}): string {
  switch (c.field) {
    case "subtotal": return `itens ${c.op === ">=" ? "a partir de" : "abaixo de"} ${BRL(c.value)}`;
    case "customer_orders": return c.op === "=" && c.value === 0 ? "cliente novo" : `cliente com ${c.op === "=" ? "" : c.op === ">=" ? "pelo menos " : "até "}${c.value} pedidos`;
    case "days_since_last_order": return c.op === "between" ? `última compra entre ${c.min} e ${c.max} dias` : `última compra ${c.op === ">=" ? "há mais de" : "há menos de"} ${c.value} dias`;
    case "cart_has_item": return `sacola com ${c.itemIds.map((i) => names[i] || i).join(" ou ") || "(escolha o item)"}`;
    case "cart_has_category": return `sacola com ${c.categoryIds.map((i) => names[i] || i).join(" ou ") || "(escolha)"}`;
    case "weekday": return c.values.map((d) => WEEK[d]).join(", ");
    case "time": return `das ${c.from} às ${c.to}`;
    case "zone": return `área ${c.zoneIds.map((z) => names[z] || z).join(" ou ")}`;
    case "mode": return c.values.map((m) => (m === "DELIVERY" ? "entrega" : "retirada")).join(" ou ");
    case "source": return `vindo de ${c.values.join(", ")}`;
    case "idle_seconds_without_add": return `${c.value}s sem adicionar nada`;
  }
  return "";
}
export function describeAction(a: StrategyAction, coupons: Record<string, Coupon> = {}) {
  if (a.kind === "delivery_fee") return a.mode === "free" ? "frete grátis" : a.mode === "fixed" ? `frete de ${BRL(a.value || 0)}` : `${a.value}% de desconto no frete`;
  if (a.kind === "service_fee") return `cobra ${a.label.toLowerCase()} de ${BRL(a.amount)}`;
  return `mostra pop-up com o cupom ${coupons[a.couponId]?.code || "(escolha)"}`;
}

export function StrategiesPage() {
  const list = useLoad<Strategy[]>("/admin/strategies");
  const coupons = useLoad<Coupon[]>("/admin/coupons");
  const items = useLoad<Item[]>("/admin/items");
  const stores = useLoad<Store[]>("/admin/stores");
  const templates = useLoad<Omit<Strategy, "id">[]>("/admin/strategy-templates");
  const { dirty } = useAdmin();
  const [edit, setEdit] = useState<Partial<Strategy> | null>(null);
  const C = Object.fromEntries((coupons.data || []).map((c) => [c.id, c]));
  const names = useMemo(() => ({ ...Object.fromEntries((items.data || []).map((i) => [i.id, i.name.split(" · ")[0]])), ...Object.fromEntries((stores.data || []).flatMap((s) => s.zones.map((z) => [z.id, z.name]))) }), [items.data, stores.data]);
  const groups: { title: string; hint: string; kinds: StrategyAction["kind"][] }[] = [
    { title: "Frete", hint: "A primeira regra que bater (pela prioridade) decide o frete. A taxa base vem da área desenhada no mapa.", kinds: ["delivery_fee"] },
    { title: "Taxas", hint: "O pedido mínimo nunca bloqueia: abaixo dele, cobra a taxa. Ela só aparece no resumo antes de pagar.", kinds: ["service_fee"] },
    { title: "Pop-ups por comportamento", hint: "Aparecem no canto superior do cardápio, uma vez por sessão.", kinds: ["popup_coupon"] },
  ];
  return <>
    <div className="pagehead"><div><h1>Estratégias</h1><p>Regras com condição e ação: frete grátis, taxa de serviço no lugar do pedido mínimo e cupom que aparece quando a pessoa hesita.</p></div>
      <Btn kind="primary" onClick={() => setEdit({ name: "", active: true, priority: 10, conditions: [], action: { kind: "delivery_fee", mode: "free" }, showProgress: true })}>Nova estratégia</Btn></div>
    <div className="split">
      <div className="stack">{groups.map((g) => {
        const rows = (list.data || []).filter((s) => g.kinds.includes(s.action.kind)).sort((a, b) => a.priority - b.priority);
        return <section key={g.title} className="panel"><header><h2>{g.title}</h2><p>{g.hint}</p></header>
          <div className="list">{rows.map((s) => <div key={s.id} className="li click" onClick={() => setEdit(s)} role="button" tabIndex={0}>
            <span className="pill num">{s.priority}</span>
            <div className="grow"><b>{s.name}</b><span className="small muted">Se {s.conditions.map((c) => describeCondition(c, names)).join(" e ") || "sempre"} → {describeAction(s.action, C)}</span></div>
            {s.showProgress && s.action.kind === "delivery_fee" && <Pill tone="accent">barra de progresso</Pill>}
            {s.active ? <Pill tone="good">ativa</Pill> : <Pill>pausada</Pill>}
          </div>)}</div>
        </section>;
      })}
        <section className="panel"><header><h3>Modelos prontos</h3><p>Comece por um e ajuste</p></header>
          <div className="chips">{(templates.data || []).map((t) => <button key={t.name} className="chip" onClick={() => setEdit({ ...t, active: false })}>{t.name}</button>)}</div>
        </section>
      </div>
      <Simulator strategies={list.data || []} stores={stores.data || []} items={items.data || []} coupons={C} />
    </div>
    {edit && <StrategyEditor s={edit} coupons={coupons.data || []} items={items.data || []} stores={stores.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); dirty(); }} />}
  </>;
}

function Simulator(p: { strategies: Strategy[]; stores: Store[]; items: Item[]; coupons: Record<string, Coupon> }) {
  const zones = p.stores.flatMap((s) => s.zones);
  const [x, setX] = useState({ subtotal: 45, orders: 3, days: 8, zone: "", mode: "DELIVERY" as "DELIVERY" | "TAKEOUT", wd: new Date().getDay(), time: "20:00", idle: 0, itemIds: [] as string[] });
  const zone = zones.find((z) => z.id === x.zone) || zones[0];
  const now = new Date(); now.setDate(now.getDate() + ((x.wd - now.getDay() + 7) % 7)); const [h, m] = x.time.split(":").map(Number); now.setHours(h, m);
  const ctx = { now, subtotal: x.subtotal, lines: x.itemIds.map((id) => ({ itemId: id, name: "", qty: 1, unit: 0, total: 0, base: 0, choices: [] })), items: Object.fromEntries(p.items.map((i) => [i.id, i])), customerOrders: x.orders, daysSinceLastOrder: x.orders ? x.days : undefined, segmentIds: [], zoneId: zone?.id, mode: x.mode, idleSecondsWithoutAdd: x.idle };
  const r = applyStrategies(p.strategies, ctx, zone?.fee || 0);
  const pop = p.strategies.filter((s) => s.action.kind === "popup_coupon" && matches(s, ctx)).sort((a, b) => a.priority - b.priority)[0];
  const total = x.subtotal + r.deliveryFee + r.fees.reduce((a, f) => a + f.amount, 0);
  return <section className="panel" style={{ position: "sticky", top: 70 }}>
    <header><h2>Simular um pedido</h2><p>Teste as regras sem publicar</p></header>
    <div className="grid2">
      <Field label="Valor dos itens"><Num value={x.subtotal} onChange={(v) => setX({ ...x, subtotal: v ?? 0 })} /></Field>
      <Field label="Pedidos anteriores"><Num value={x.orders} onChange={(v) => setX({ ...x, orders: v ?? 0 })} /></Field>
      <Field label="Dias desde a última compra"><Num value={x.days} onChange={(v) => setX({ ...x, days: v ?? 0 })} /></Field>
      <Field label="Área"><Select value={zone?.id || ""} onChange={(v) => setX({ ...x, zone: v })} options={zones.map((z) => ({ value: z.id, label: `${z.name} · ${BRL(z.fee)}` }))} /></Field>
      <Field label="Dia"><Select value={String(x.wd)} onChange={(v) => setX({ ...x, wd: Number(v) })} options={WEEK.map((w, i) => ({ value: String(i), label: w }))} /></Field>
      <Field label="Hora"><input type="time" value={x.time} onChange={(e) => setX({ ...x, time: e.target.value })} /></Field>
      <Field label="Segundos sem adicionar"><Num value={x.idle} onChange={(v) => setX({ ...x, idle: v ?? 0 })} /></Field>
      <Field label="Modo"><Select value={x.mode} onChange={(v) => setX({ ...x, mode: v })} options={[{ value: "DELIVERY", label: "Entrega" }, { value: "TAKEOUT", label: "Retirada" }]} /></Field>
    </div>
    <Field label="Itens na sacola"><Chips value={x.itemIds} onChange={(v) => setX({ ...x, itemIds: v })} options={p.items.filter((i) => !i.isDrink).slice(0, 12).map((i) => ({ value: i.id, label: i.name.split(" · ")[0].slice(0, 28) }))} /></Field>
    <div className="tablewrap"><table><tbody>
      <tr><td>Itens</td><td className="r">{BRL(x.subtotal)}</td></tr>
      <tr><td>Entrega {r.deliveryLabel && <Pill tone="good">{r.deliveryLabel}</Pill>}</td><td className="r">{r.deliveryFee !== r.baseDeliveryFee && <s className="muted">{BRL(r.baseDeliveryFee)} </s>}{BRL(r.deliveryFee)}</td></tr>
      {r.fees.map((f) => <tr key={f.strategyId}><td>{f.label}</td><td className="r">{BRL(f.amount)}</td></tr>)}
      <tr><td><b>Total</b></td><td className="r"><b>{BRL(total)}</b></td></tr>
    </tbody></table></div>
    {r.progress && <div className="stack" style={{ gap: 4 }}><span className="small">Faltam <b>{BRL(r.progress.missing)}</b> {r.progress.label}</span><div className="bar"><i style={{ width: `${r.progress.pct}%` }} /></div></div>}
    {pop ? <div className="issue"><span>Pop-up: <b>{(pop.action as { title: string }).title}</b> com o cupom {p.coupons[(pop.action as { couponId: string }).couponId]?.code}</span></div> : <span className="small muted">Nenhum pop-up com esses dados</span>}
  </section>;
}

function StrategyEditor(p: { s: Partial<Strategy>; coupons: Coupon[]; items: Item[]; stores: Store[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const [s, setS] = useState<Partial<Strategy>>(p.s);
  const conds = s.conditions || [];
  const updC = (i: number, c: Partial<Condition>) => setS({ ...s, conditions: conds.map((x, j) => (j === i ? ({ ...x, ...c } as Condition) : x)) });
  const a = s.action!;
  const zones = p.stores.flatMap((x) => x.zones);
  const save = async () => { const r = await run(() => (s.id ? api.put(`/admin/strategies/${s.id}`, s) : api.post("/admin/strategies", s)), "Estratégia salva"); if (r) p.onSaved(); };
  return <Drawer title={s.id ? s.name : "Nova estratégia"} onClose={p.onClose} footer={<>{s.id ? <ConfirmBtn label="Excluir" confirm="Excluir a regra?" onConfirm={async () => { await run(() => api.del(`/admin/strategies/${s.id}`), "Excluída"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar</Btn></>}>
    <div className="grid2"><Field label="Nome"><Text id="st-name" value={s.name} onChange={(v) => setS({ ...s, name: v })} /></Field><Field label="Prioridade" hint="Menor número é avaliado antes"><Num value={s.priority} onChange={(v) => setS({ ...s, priority: v ?? 10 })} /></Field></div>
    <section className="panel"><header><h3>Quando</h3><p>Todas as condições precisam bater</p></header>
      {conds.map((c, i) => <div key={i} className="rulebox">
        <Select value={c.field} onChange={(f) => setS({ ...s, conditions: conds.map((x, j) => (j === i ? FIELDS.find((y) => y.value === f)!.make() : x)) })} options={FIELDS.map((f) => ({ value: f.value, label: f.label }))} />
        <div className="row">
          {(c.field === "subtotal") && <><Select value={c.op} onChange={(op) => updC(i, { op } as never)} options={[{ value: ">=", label: "a partir de" }, { value: "<", label: "abaixo de" }]} /><Num value={c.value} onChange={(v) => updC(i, { value: v ?? 0 } as never)} /></>}
          {c.field === "customer_orders" && <><Select value={c.op} onChange={(op) => updC(i, { op } as never)} options={[{ value: "=", label: "igual a" }, { value: ">=", label: "pelo menos" }, { value: "<=", label: "até" }]} /><Num value={c.value} onChange={(v) => updC(i, { value: v ?? 0 } as never)} /></>}
          {c.field === "days_since_last_order" && (c.op === "between" ? <><span className="small">entre</span><Num value={c.min} onChange={(v) => updC(i, { min: v ?? 0 } as never)} /><span className="small">e</span><Num value={c.max} onChange={(v) => updC(i, { max: v ?? 0 } as never)} /><span className="small">dias</span></> : <><Select value={c.op} onChange={(op) => updC(i, { op } as never)} options={[{ value: ">=", label: "há mais de" }, { value: "<=", label: "há menos de" }]} /><Num value={c.value} onChange={(v) => updC(i, { value: v ?? 0 } as never)} /></>)}
          {c.field === "cart_has_item" && <Chips value={c.itemIds} onChange={(v) => updC(i, { itemIds: v } as never)} options={p.items.map((x) => ({ value: x.id, label: x.name.split(" · ")[0].slice(0, 30) }))} />}
          {c.field === "weekday" && <Chips value={c.values} onChange={(v) => updC(i, { values: v } as never)} options={WEEK.map((w, k) => ({ value: k as 0, label: w }))} />}
          {c.field === "time" && <><input type="time" value={c.from} onChange={(e) => updC(i, { from: e.target.value } as never)} /><span className="small">às</span><input type="time" value={c.to} onChange={(e) => updC(i, { to: e.target.value } as never)} /></>}
          {c.field === "zone" && <Chips value={c.zoneIds} onChange={(v) => updC(i, { zoneIds: v } as never)} options={zones.map((z) => ({ value: z.id, label: z.name }))} />}
          {c.field === "mode" && <Chips value={c.values} onChange={(v) => updC(i, { values: v } as never)} options={[{ value: "DELIVERY", label: "Entrega" }, { value: "TAKEOUT", label: "Retirada" }]} />}
          {c.field === "source" && <Text value={c.values.join(", ")} onChange={(v) => updC(i, { values: v.split(",").map((x) => x.trim()).filter(Boolean) } as never)} />}
          {c.field === "idle_seconds_without_add" && <><Num value={c.value} onChange={(v) => updC(i, { value: v ?? 60 } as never)} /><span className="small">segundos</span></>}
        </div>
        <Btn sm kind="ghost" onClick={() => setS({ ...s, conditions: conds.filter((_, j) => j !== i) })}>✕</Btn>
      </div>)}
      <div><Btn sm onClick={() => setS({ ...s, conditions: [...conds, FIELDS[0].make()] })}>Adicionar condição</Btn></div>
    </section>
    <section className="panel"><header><h3>Então</h3></header>
      <Field label="Ação"><Select value={a.kind} onChange={(k) => setS({ ...s, action: k === "delivery_fee" ? { kind: k, mode: "free" } : k === "service_fee" ? { kind: k, amount: 15, label: "Taxa de serviço", feeType: "MIN_ORDER_FEE" } : { kind: k, couponId: p.coupons[0]?.id || "", title: "", text: "", position: "top-right", frequency: "session" } })} options={[{ value: "delivery_fee", label: "Mudar o frete" }, { value: "service_fee", label: "Cobrar taxa de serviço" }, { value: "popup_coupon", label: "Mostrar pop-up com cupom" }]} /></Field>
      {a.kind === "delivery_fee" && <div className="grid3"><Field label="Frete"><Select value={a.mode} onChange={(m) => setS({ ...s, action: { ...a, mode: m } })} options={[{ value: "free", label: "Grátis" }, { value: "fixed", label: "Valor fixo" }, { value: "percent_off", label: "Desconto %" }]} /></Field>{a.mode !== "free" && <Field label={a.mode === "fixed" ? "Valor" : "Desconto (%)"}><Num value={a.value} onChange={(v) => setS({ ...s, action: { ...a, value: v } })} /></Field>}<Field label="Texto no cardápio"><Text value={a.label} placeholder="Frete grátis" onChange={(v) => setS({ ...s, action: { ...a, label: v } })} /></Field></div>}
      {a.kind === "delivery_fee" && <Toggle checked={!!s.showProgress} onChange={(v) => setS({ ...s, showProgress: v })} label="Mostrar barra “faltam R$ X para ganhar” na sacola" />}
      {a.kind === "service_fee" && <div className="grid3"><Field label="Valor"><Num value={a.amount} onChange={(v) => setS({ ...s, action: { ...a, amount: v ?? 0 } })} /></Field><Field label="Nome no resumo"><Text value={a.label} onChange={(v) => setS({ ...s, action: { ...a, label: v } })} /></Field><Field label="Tipo na SAIPOS"><Select value={a.feeType} onChange={(v) => setS({ ...s, action: { ...a, feeType: v } })} options={[{ value: "MIN_ORDER_FEE", label: "Taxa de pedido mínimo" }, { value: "SERVICE_FEE", label: "Taxa de serviço" }]} /></Field></div>}
      {a.kind === "popup_coupon" && <div className="grid2">
        <Field label="Cupom"><Select value={a.couponId} onChange={(v) => setS({ ...s, action: { ...a, couponId: v } })} options={p.coupons.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>
        <Field label="Posição"><Select value={a.position} onChange={(v) => setS({ ...s, action: { ...a, position: v } })} options={[{ value: "top-right", label: "Canto superior" }, { value: "top", label: "Topo" }, { value: "bottom", label: "Rodapé" }]} /></Field>
        <Field label="Título"><Text value={a.title} onChange={(v) => setS({ ...s, action: { ...a, title: v } })} /></Field>
        <Field label="Frequência"><Select value={a.frequency} onChange={(v) => setS({ ...s, action: { ...a, frequency: v } })} options={[{ value: "session", label: "1 vez por visita" }, { value: "day", label: "1 vez por dia" }, { value: "once", label: "1 vez só" }]} /></Field>
        <Field label="Texto" wide><Text value={a.text} onChange={(v) => setS({ ...s, action: { ...a, text: v } })} /></Field>
      </div>}
    </section>
    <div className="grid2">
      <Field label="Começa"><input type="datetime-local" value={s.startsAt?.slice(0, 16) || ""} onChange={(e) => setS({ ...s, startsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></Field>
      <Field label="Termina"><input type="datetime-local" value={s.endsAt?.slice(0, 16) || ""} onChange={(e) => setS({ ...s, endsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></Field>
    </div>
    <Toggle checked={!!s.active} onChange={(v) => setS({ ...s, active: v })} label="Ativa" />
  </Drawer>;
}
