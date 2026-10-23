import { useState } from "react";
import { cashbackEarn, cashbackRedeemable, type Category, type LoyaltyProgram } from "@cw/core";
import { BRL, Btn, Chips, Field, Num, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";

export function LoyaltyPage() {
  const { api, dirty } = useAdmin(); const { run, busy } = useAction();
  const lp = useLoad<LoyaltyProgram>("/admin/settings/loyalty");
  const cats = useLoad<Category[]>("/admin/categories");
  const [sim, setSim] = useState({ order: 120, spend: 400, balance: 18 });
  if (!lp.data) return null;
  const p = lp.data; const set = (x: Partial<LoyaltyProgram>) => lp.setData({ ...p, ...x });
  const earn = cashbackEarn(p, sim.order, sim.spend), redeem = cashbackRedeemable(p, sim.balance, sim.order);
  return <>
    <div className="pagehead"><div><h1>Cashback</h1><p>O crédito entra quando o pedido é entregue e vence sozinho. A régua de níveis premia quem gasta mais nos últimos 90 dias.</p></div></div>
    <div className="split">
      <section className="panel">
        <Toggle checked={p.active} onChange={(v) => set({ active: v })} label="Programa ligado" />
        <div className="grid2">
          <Field label="Cashback padrão (%)"><Num value={p.earnPercent} onChange={(v) => set({ earnPercent: v ?? 0 })} /></Field>
          <Field label="Pedido mínimo para ganhar (R$)"><Num value={p.minOrder} onChange={(v) => set({ minOrder: v ?? 0 })} /></Field>
          <Field label="Teto por pedido (R$)"><Num value={p.maxEarnPerOrder} onChange={(v) => set({ maxEarnPerOrder: v })} /></Field>
          <Field label="Vence em (dias)"><Num value={p.expiresInDays} onChange={(v) => set({ expiresInDays: v ?? 30 })} /></Field>
          <Field label="Saldo mínimo para usar (R$)"><Num value={p.minRedeem} onChange={(v) => set({ minRedeem: v ?? 0 })} /></Field>
          <Field label="Paga até (% do pedido)"><Num value={p.maxRedeemPercent} onChange={(v) => set({ maxRedeemPercent: v ?? 0 })} /></Field>
        </div>
        <Field label="Categorias que não geram cashback"><Chips value={p.excludedCategoryIds || []} onChange={(v) => set({ excludedCategoryIds: v })} options={(cats.data || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <section className="panel"><header><h3>Níveis</h3><p>Por gasto nos últimos 90 dias</p></header>
          {(p.tiers || []).map((t, i) => <div key={i} className="grid3"><Field label="Nome"><Text value={t.name} onChange={(v) => set({ tiers: p.tiers!.map((x, j) => (j === i ? { ...x, name: v } : x)) })} /></Field><Field label="A partir de (R$)"><Num value={t.minSpend90d} onChange={(v) => set({ tiers: p.tiers!.map((x, j) => (j === i ? { ...x, minSpend90d: v ?? 0 } : x)) })} /></Field><Field label="Cashback (%)"><Num value={t.earnPercent} onChange={(v) => set({ tiers: p.tiers!.map((x, j) => (j === i ? { ...x, earnPercent: v ?? 0 } : x)) })} /></Field></div>)}
          <div className="row"><Btn sm onClick={() => set({ tiers: [...(p.tiers || []), { name: "Novo nível", minSpend90d: 1000, earnPercent: 12 }] })}>Adicionar nível</Btn>{(p.tiers || []).length > 0 && <Btn sm kind="danger" onClick={() => set({ tiers: p.tiers!.slice(0, -1) })}>Remover último</Btn>}</div>
        </section>
        <div><Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/settings/loyalty", p), "Cashback salvo")) dirty(); }}>Salvar</Btn></div>
      </section>
      <section className="panel" style={{ position: "sticky", top: 70 }}>
        <header><h2>Simulação</h2></header>
        <div className="grid3"><Field label="Pedido (R$)"><Num value={sim.order} onChange={(v) => setSim({ ...sim, order: v ?? 0 })} /></Field><Field label="Gasto 90 dias"><Num value={sim.spend} onChange={(v) => setSim({ ...sim, spend: v ?? 0 })} /></Field><Field label="Saldo atual"><Num value={sim.balance} onChange={(v) => setSim({ ...sim, balance: v ?? 0 })} /></Field></div>
        <p className="sentence">Este pedido gera <b>{BRL(earn)}</b> de cashback, liberado na entrega e válido por {p.expiresInDays} dias. Do saldo de {BRL(sim.balance)}, o cliente pode usar <b>{BRL(redeem)}</b> agora.</p>
        <p className="small muted">Custo efetivo: {sim.order ? ((earn / sim.order) * 100).toFixed(1).replace(".", ",") : 0}% do pedido, pago só se o cliente voltar.</p>
      </section>
    </div>
  </>;
}
