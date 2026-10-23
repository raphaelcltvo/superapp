import { useState } from "react";
import { breakEven, type Category, type Coupon, type Item, type Segment } from "@cw/core";
import { BRL, Btn, Chips, ConfirmBtn, Drawer, Empty, Field, Num, Pill, Select, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((l, i) => ({ value: i, label: l }));
const describe = (c: Partial<Coupon>) => c.type === "percent" ? `${c.value}% off${c.maxDiscount ? ` (até ${BRL(c.maxDiscount)})` : ""}` : c.type === "amount" ? `${BRL(c.value)} off` : "frete grátis";

export function CouponsPage() {
  const list = useLoad<Coupon[]>("/admin/coupons");
  const { dirty } = useAdmin();
  const [edit, setEdit] = useState<Partial<Coupon> | null>(null);
  return <>
    <div className="pagehead"><div><h1>Cupons</h1><p>Benefício personalizado com preço único: o cupom vai para quem precisa dele (primeiro pedido, quem sumiu, segundo pedido), via pop-up, LP ou WhatsApp.</p></div>
      <Btn kind="primary" onClick={() => setEdit({ name: "", code: "", type: "percent", value: 10, active: true, marginHint: 0.4, maxUsesPerCustomer: 1 })}>Novo cupom</Btn></div>
    {(list.data || []).length ? <div className="tablewrap"><table>
      <thead><tr><th>Código</th><th>Cupom</th><th>Benefício</th><th>Regras</th><th className="r">Usos</th><th className="r">Precisa vender a mais</th><th /></tr></thead>
      <tbody>{list.data!.map((c) => { const be = c.type === "percent" ? breakEven(c.value / 100, c.marginHint ?? 0.4) : null; return <tr key={c.id} className="click" onClick={() => setEdit(c)}>
        <td className="mono">{c.code || "automático"}</td><td>{c.name}</td><td>{describe(c)}</td>
        <td className="small">{[c.firstOrderOnly && "1º pedido", c.minSubtotal && `mín. ${BRL(c.minSubtotal)}`, c.segmentIds?.length && "segmento", c.requiresOptinWhatsapp && "aceite WhatsApp", c.maxUsesPerCustomer && `${c.maxUsesPerCustomer}× por cliente`].filter(Boolean).join(" · ") || "—"}</td>
        <td className="r">{c.uses || 0}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
        <td className="r">{be ? (Number.isFinite(be.extraPct) ? `+${be.extraPct.toFixed(0)}%` : "não empata") : "—"}</td>
        <td>{c.active ? <Pill tone="good">ativo</Pill> : <Pill>pausado</Pill>}</td></tr>; })}</tbody>
    </table></div> : <Empty title="Nenhum cupom" />}
    {edit && <CouponEditor c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); dirty(); }} />}
  </>;
}

function CouponEditor(p: { c: Partial<Coupon>; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const segs = useLoad<Segment[]>("/admin/segments"); const items = useLoad<Item[]>("/admin/items"); const cats = useLoad<Category[]>("/admin/categories");
  const [c, setC] = useState<Partial<Coupon>>(p.c);
  const be = c.type === "percent" && c.value ? breakEven(c.value / 100, c.marginHint ?? 0.4) : null;
  const save = async () => { const body = { ...c, code: (c.code || "").toUpperCase() || undefined }; const r = await run(() => (c.id ? api.put(`/admin/coupons/${c.id}`, body) : api.post("/admin/coupons", body)), "Cupom salvo"); if (r) p.onSaved(); };
  return <Drawer title={c.id ? c.name : "Novo cupom"} onClose={p.onClose} footer={<>{c.id ? <ConfirmBtn label="Excluir" confirm="Excluir o cupom?" onConfirm={async () => { await run(() => api.del(`/admin/coupons/${c.id}`), "Excluído"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar cupom</Btn></>}>
    <div className="grid2">
      <Field label="Nome"><Text id="cp-name" value={c.name} onChange={(v) => setC({ ...c, name: v })} /></Field>
      <Field label="Código" hint="Letras maiúsculas e números"><Text id="cp-code" mono value={c.code} onChange={(v) => setC({ ...c, code: v.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} /></Field>
      <Field label="Tipo"><Select value={(c.type || "percent") as Coupon["type"]} onChange={(v) => setC({ ...c, type: v })} options={[{ value: "percent", label: "Porcentagem" }, { value: "amount", label: "Valor em reais" }, { value: "free_delivery", label: "Frete grátis" }]} /></Field>
      {c.type !== "free_delivery" && <Field label={c.type === "percent" ? "Desconto (%)" : "Desconto (R$)"}><Num value={c.value} onChange={(v) => setC({ ...c, value: v ?? 0 })} /></Field>}
      {c.type === "percent" && <Field label="Teto do desconto (R$)"><Num value={c.maxDiscount} onChange={(v) => setC({ ...c, maxDiscount: v })} /></Field>}
      <Field label="Pedido mínimo (R$)"><Num value={c.minSubtotal} onChange={(v) => setC({ ...c, minSubtotal: v })} /></Field>
      <Field label="Usos no total"><Num value={c.maxUses} onChange={(v) => setC({ ...c, maxUses: v })} /></Field>
      <Field label="Usos por cliente"><Num value={c.maxUsesPerCustomer} onChange={(v) => setC({ ...c, maxUsesPerCustomer: v })} /></Field>
      <Field label="Começa"><input type="date" value={c.validFrom?.slice(0, 10) || ""} onChange={(e) => setC({ ...c, validFrom: e.target.value ? new Date(e.target.value + "T00:00:00-03:00").toISOString() : undefined })} /></Field>
      <Field label="Termina"><input type="date" value={c.validTo?.slice(0, 10) || ""} onChange={(e) => setC({ ...c, validTo: e.target.value ? new Date(e.target.value + "T23:59:59-03:00").toISOString() : undefined })} /></Field>
    </div>
    <div className="row"><Toggle checked={!!c.firstOrderOnly} onChange={(v) => setC({ ...c, firstOrderOnly: v })} label="Só no primeiro pedido" /><Toggle checked={!!c.requiresOptinWhatsapp} onChange={(v) => setC({ ...c, requiresOptinWhatsapp: v })} label="Exige aceite de WhatsApp" /><Toggle checked={c.active !== false} onChange={(v) => setC({ ...c, active: v })} label="Ativo" /></div>
    <Field label="Dias da semana"><Chips value={c.weekdays || []} onChange={(v) => setC({ ...c, weekdays: v as never })} options={WEEK} /></Field>
    <Field label="Só para os segmentos"><Chips value={c.segmentIds || []} onChange={(v) => setC({ ...c, segmentIds: v })} options={(segs.data || []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
    <Field label="Vale só nestas categorias"><Chips value={c.categoryIds || []} onChange={(v) => setC({ ...c, categoryIds: v })} options={(cats.data || []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
    <Field label="Ou nestes itens"><Chips value={c.itemIds || []} onChange={(v) => setC({ ...c, itemIds: v })} options={(items.data || []).map((s) => ({ value: s.id, label: s.name.split(" · ")[0].slice(0, 28) }))} /></Field>
    <section className="panel"><header><h3>Ponto de equilíbrio</h3><p>Quanto o volume precisa crescer para a margem total empatar</p></header>
      <div className="grid2"><Field label="Margem de contribuição média (%)"><Num value={c.marginHint != null ? Math.round(c.marginHint * 100) : undefined} onChange={(v) => setC({ ...c, marginHint: v != null ? v / 100 : undefined })} /></Field>
        <div className="stack" style={{ gap: 2 }}>{be ? Number.isFinite(be.extraPct) ? <><span className="small muted">Com {c.value}% de desconto</span><span style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 700 }}>+{be.extraPct.toFixed(1).replace(".", ",")}% de pedidos</span><span className="small muted">fator {be.factor.toFixed(2).replace(".", ",")} = 1 ÷ (1 − desconto ÷ margem)</span></> : <span className="down">O desconto é maior que a margem: nenhum volume compensa.</span> : <span className="small muted">Disponível para cupons em porcentagem.</span>}</div></div>
    </section>
  </Drawer>;
}
