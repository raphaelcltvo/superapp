import { useState } from "react";
import type { Order, OrderStatus } from "@cw/core";
import { BRL, Btn, Drawer, Empty, Pill, Select, dt, useAction, useAdmin, useLoad } from "../ui";

export const STATUS: Record<OrderStatus, { label: string; tone?: "good" | "warn" | "bad" | "accent" }> = {
  awaiting_payment: { label: "Aguardando pagamento", tone: "warn" }, payment_failed: { label: "Pagamento não concluído", tone: "bad" },
  created: { label: "Recebido", tone: "warn" }, sent_to_pos: { label: "No PDV", tone: "accent" }, pos_error: { label: "Erro no PDV", tone: "bad" }, confirmed: { label: "Confirmado", tone: "accent" },
  ready: { label: "Pronto", tone: "accent" }, dispatched: { label: "Saiu para entrega", tone: "accent" }, concluded: { label: "Entregue", tone: "good" }, cancelled: { label: "Cancelado", tone: "bad" },
};
const PAY: Record<string, string> = { CARD_ONLINE: "Cartão online", PIX_ONLINE: "Pix", CARD_ON_DELIVERY: "Cartão na entrega", CREDIT_ON_DELIVERY: "Crédito", DEBIT_ON_DELIVERY: "Débito", VR_VA: "VR/VA", CASH: "Dinheiro" };

export function OrdersPage() {
  const [st, setSt] = useState<string>("");
  const list = useLoad<Order[]>(`/admin/orders?limit=150${st ? `&status=${st}` : ""}`, [st]);
  const [open, setOpen] = useState<string | null>(null);
  return <>
    <div className="pagehead"><div><h1>Pedidos</h1><p>Pedidos feitos no cardápio próprio. Com a SAIPOS ligada, eles entram no PDV na hora e os status voltam pelo webhook.</p></div>
      <div className="row"><Select value={st} onChange={setSt} options={[{ value: "", label: "Todos os status" }, ...Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label }))]} /><Btn onClick={list.reload}>Atualizar</Btn></div></div>
    {(list.data || []).length ? <div className="tablewrap"><table>
      <thead><tr><th>#</th><th>Quando</th><th>Itens</th><th>Pagamento</th><th>Origem</th><th className="r">Total</th><th>Status</th></tr></thead>
      <tbody>{list.data!.map((o) => <tr key={o.id} className="click" onClick={() => setOpen(o.id)}>
        <td className="mono">{o.displayId}</td><td className="num">{dt(o.createdAt)}</td>
        <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.lines.map((l) => `${l.qty}× ${l.name.split(" · ")[0]}`).join(", ")}</td>
        <td>{PAY[o.payment.code] || o.payment.code}</td><td>{o.source || "direto"}</td><td className="r">{BRL(o.total)}</td>
        <td><Pill tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label || o.status}</Pill></td></tr>)}</tbody>
    </table></div> : <Empty title="Nenhum pedido com esse filtro" />}
    {open && <OrderDrawer id={open} onClose={() => { setOpen(null); list.reload(); }} />}
  </>;
}

function OrderDrawer(p: { id: string; onClose: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const o = useLoad<Order>(`/admin/orders/${p.id}`);
  if (!o.data) return null;
  const d = o.data;
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) o.reload(); };
  return <Drawer title={`Pedido #${d.displayId}`} onClose={p.onClose} footer={<>
    <div className="row">{d.status !== "cancelled" && d.status !== "concluded" && <><Btn sm onClick={() => act(() => api.post(`/admin/orders/${d.id}/status`, { status: "dispatched" }), "Saiu para entrega")}>Saiu para entrega</Btn><Btn sm onClick={() => act(() => api.post(`/admin/orders/${d.id}/status`, { status: "concluded" }), "Marcado como entregue")}>Entregue</Btn><Btn sm kind="danger" onClick={() => act(() => api.post(`/admin/orders/${d.id}/status`, { status: "cancelled" }), "Pedido cancelado")}>Cancelar</Btn></>}</div>
    {(d.status === "pos_error" || d.status === "created") && <Btn kind="primary" disabled={busy} onClick={() => act(() => api.post(`/admin/orders/${d.id}/send-pos`), "Reenviado ao PDV")}>Enviar ao PDV</Btn>}
  </>}>
    <div className="row"><Pill tone={STATUS[d.status]?.tone}>{STATUS[d.status]?.label}</Pill><span className="muted small">{dt(d.createdAt)} · {d.mode === "DELIVERY" ? "Entrega" : "Retirada"} · {PAY[d.payment.code]}{d.payment.changeFor ? ` · troco para ${BRL(d.payment.changeFor)}` : ""}</span></div>
    {d.pos?.error && <div className="issue erro"><span><b>SAIPOS:</b> {d.pos.error}</span></div>}
    {d.payment.online && <section className="panel"><header><h3>Pagamento online</h3><Pill tone={d.payment.online.status === "paid" ? "good" : d.payment.online.status === "pending" ? "warn" : d.payment.online.status === "refunded" ? "accent" : "bad"}>{{ pending: "Aguardando", paid: "Pago", failed: "Recusado", expired: "Expirado", refunded: "Estornado" }[d.payment.online.status]}</Pill></header>
      <p className="small">{d.payment.online.method === "pix" ? "Pix" : `Cartão ${d.payment.online.card?.brand || ""} •••• ${d.payment.online.card?.last4 || ""}${(d.payment.online.card?.installments || 1) > 1 ? ` em ${d.payment.online.card!.installments}x` : ""}`} · {d.payment.online.gateway} · cobrança <span className="mono">{d.payment.online.chargeId}</span>{d.payment.online.paidAt ? ` · pago ${dt(d.payment.online.paidAt)}` : ""}{d.payment.online.refundedAt ? ` · estornado ${dt(d.payment.online.refundedAt)}` : ""}</p>
      {d.payment.online.failureReason && <p className="small down">{d.payment.online.failureReason}</p>}
      {d.payment.online.status === "paid" && <div><Btn sm disabled={busy} onClick={() => act(() => api.post(`/admin/orders/${d.id}/refund`, {}), "Estorno solicitado")}>Estornar valor total</Btn></div>}
    </section>}
    <div className="tablewrap"><table><tbody>
      {d.lines.map((l, i) => <tr key={i}><td><b>{l.qty}× {l.name}</b><div className="small muted">{l.choices.map((c) => `${c.fraction && c.fraction !== "inteira" ? c.fraction + " " : ""}${c.name}${c.unitDelta ? ` (+${BRL(c.unitDelta)})` : ""}`).join(" · ")}{l.notes ? ` · obs: ${l.notes}` : ""}</div></td><td className="r">{BRL(l.total)}</td></tr>)}
      <tr><td>Itens</td><td className="r">{BRL(d.subtotal)}</td></tr>
      {d.discount > 0 && <tr><td>Desconto</td><td className="r">− {BRL(d.discount)}</td></tr>}
      {d.cashbackUsed > 0 && <tr><td>Cashback usado</td><td className="r">− {BRL(d.cashbackUsed)}</td></tr>}
      <tr><td>Entrega{d.baseDeliveryFee && d.deliveryFee < d.baseDeliveryFee ? <span className="small muted"> (de {BRL(d.baseDeliveryFee)})</span> : null}</td><td className="r">{BRL(d.deliveryFee)}</td></tr>
      {(d.fees || []).map((f) => <tr key={f.label}><td>{f.label}</td><td className="r">{BRL(f.amount)}</td></tr>)}
      <tr><td><b>Total</b></td><td className="r"><b>{BRL(d.total)}</b></td></tr>
    </tbody></table></div>
    {d.address && <p className="small">{d.address.street}, {d.address.number}{d.address.complement ? ` · ${d.address.complement}` : ""} · {d.address.district} · {d.address.city}/{d.address.state}</p>}
    {d.cashbackEarned > 0 && <p className="small">Cashback do pedido: <b>{BRL(d.cashbackEarned)}</b> {d.status === "concluded" ? "creditado" : "(credita na entrega)"}</p>}
    <section className="panel"><header><h3>Linha do tempo</h3></header>
      <div className="list">{d.statusHistory.map((h, i) => <div key={i} className="li"><Pill tone={STATUS[h.status]?.tone}>{STATUS[h.status]?.label || h.status}</Pill><span className="grow small">{h.note}</span><span className="small muted">{h.by} · {dt(h.at)}</span></div>)}</div>
    </section>
    {d.pos?.payload ? <details><summary className="small">JSON enviado à SAIPOS</summary><div className="codebox">{JSON.stringify(d.pos.payload, null, 2)}</div></details> : null}
  </Drawer>;
}
