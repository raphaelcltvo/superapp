import { useRef, useState } from "react";
import { fractionBase, fractionLabel, type GroupRole, type Item, type Option, type OptionGroup } from "@cw/core";
import { BRL, Btn, ConfirmBtn, Drawer, Field, Num, Pill, Select, Text, Toggle, errMsg, useAction, useAdmin, useLoad } from "../ui";

export function GroupsPage() {
  const groups = useLoad<OptionGroup[]>("/admin/option_groups");
  const items = useLoad<Item[]>("/admin/items");
  const { dirty } = useAdmin();
  const [edit, setEdit] = useState<Partial<OptionGroup> | null>(null);
  return <>
    <div className="pagehead">
      <div><h1>Complementos</h1><p>Grupos reaproveitáveis: massas e bordas, sabores, bebidas. No meio a meio, cada sabor guarda o preço da pizza inteira e a metade cobra metade da diferença para o sabor mais barato.</p></div>
      <Btn kind="primary" onClick={() => setEdit({ name: "", min: 0, max: 1, rule: "sum", allowRepeat: false, options: [] })}>Novo grupo</Btn>
    </div>
    <div className="list">{(groups.data || []).map((g) => {
      const used = (items.data || []).filter((i) => i.groupIds.includes(g.id));
      const noPdv = g.options.filter((o) => o.active && !o.integrationCode).length;
      return <div key={g.id} className="li click" onClick={() => setEdit(g)} role="button" tabIndex={0}>
        <div className="grow"><b>{g.name}</b><span className="small muted">{g.options.length} opções · {g.min === g.max ? `escolhe ${g.min}` : `${g.min} a ${g.max}`} · usado em {used.length} {used.length === 1 ? "item" : "itens"}</span></div>
        {g.role && <Pill>{ROLES.find((r) => r.value === g.role)?.label}</Pill>}
        {g.freeQuota ? <Pill tone="good">{g.freeQuota} grátis</Pill> : null}
        {g.rule === "fraction" && <Pill tone="accent">meio a meio · base {BRL(fractionBase(g))}</Pill>}
        {noPdv > 0 && <Pill tone="warn">{noPdv} sem PDV</Pill>}
        <span className="muted">›</span>
      </div>;
    })}</div>
    {edit && <GroupEditor g={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); groups.reload(); dirty(); }} />}
  </>;
}

function GroupEditor(p: { g: Partial<OptionGroup>; onClose: () => void; onSaved: () => void }) {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const [g, setG] = useState<Partial<OptionGroup>>(p.g);
  const opts = g.options || [];
  const setOpt = (i: number, o: Partial<Option>) => setG({ ...g, options: opts.map((x, j) => (j === i ? { ...x, ...o } : x)) });
  const fraction = g.rule === "fraction";
  const save = async () => { const r = await run(() => (g.id ? api.put(`/admin/option_groups/${g.id}`, g) : api.post("/admin/option_groups", g)), "Grupo salvo"); if (r) p.onSaved(); };
  const fileRef = useRef<HTMLInputElement>(null); const [photoFor, setPhotoFor] = useState<number | null>(null);
  return <Drawer title={g.id ? g.name : "Novo grupo"} onClose={p.onClose} footer={<>{g.id ? <ConfirmBtn label="Excluir grupo" confirm="Itens que usam este grupo vão ficar com pendência." onConfirm={async () => { await run(() => api.del(`/admin/option_groups/${g.id}`), "Excluído"); p.onSaved(); }} /> : <span />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar grupo</Btn></>}>
    <div className="grid3">
      <Field label="Nome" wide><Text id="g-name" value={g.name} onChange={(v) => setG({ ...g, name: v })} /></Field>
      <Field label="Mínimo"><Num id="g-min" value={g.min} onChange={(v) => setG({ ...g, min: v ?? 0 })} /></Field>
      <Field label="Máximo"><Num id="g-max" value={g.max} onChange={(v) => setG({ ...g, max: v ?? 1 })} /></Field>
      <Field label="Regra de preço"><Select id="g-rule" value={(g.rule || "sum") as "sum" | "fraction"} onChange={(v) => setG({ ...g, rule: v, allowRepeat: v === "fraction" ? true : g.allowRepeat })} options={[{ value: "sum", label: "Soma o acréscimo" }, { value: "fraction", label: "Meio a meio (diferença proporcional)" }]} /></Field>
    </div>
    <div className="grid2">
      <Field label="Papel no item" hint="Organiza a tela de montar e os relatórios"><Select id="g-role" value={(g.role || "") as GroupRole | ""} onChange={(v) => setG({ ...g, role: (v || undefined) as GroupRole | undefined })} options={[{ value: "", label: "—" }, ...ROLES]} /></Field>
      {!fraction && <Field label="Unidades grátis" hint={g.freeQuota ? `As ${g.freeQuota} escolhas mais caras saem de graça; o resto cobra o acréscimo` : "Açaí, poke, marmita: “3 complementos grátis”"}><Num id="g-quota" value={g.freeQuota} onChange={(v) => setG({ ...g, freeQuota: v || undefined })} /></Field>}
    </div>
    <div className="row"><Toggle checked={!!g.allowRepeat} onChange={(v) => setG({ ...g, allowRepeat: v })} label="Pode repetir a mesma opção (2× = inteira)" /><Field label="Litros por unidade (preço por litro)"><Num value={g.liters} onChange={(v) => setG({ ...g, liters: v })} /></Field></div>
    {fraction && opts.length > 0 && <p className="sentence">Preço base do grupo: <b>{BRL(fractionBase(g as OptionGroup))}</b>. Uma metade cobra (inteira − base) ÷ {g.max || 2}. Em combos e ofertas a regra é ignorada.</p>}
    <div className="tablewrap"><table>
      <thead><tr><th>Foto</th><th>Opção</th><th className="r">{fraction ? "Inteira" : "Acréscimo"}</th>{fraction && <th className="r">Metade cobra</th>}<th>PDV</th><th>Ativa</th><th /></tr></thead>
      <tbody>{opts.map((o, i) => {
        const fl = fraction ? fractionLabel(g as OptionGroup, o) : null;
        return <tr key={o.id}>
          <td>{o.imageUrl ? <img className="thumb" src={o.imageUrl} alt="" onClick={() => { setPhotoFor(i); fileRef.current?.click(); }} /> : <Btn sm onClick={() => { setPhotoFor(i); fileRef.current?.click(); }}>Foto</Btn>}</td>
          <td style={{ minWidth: 200 }}><Text value={o.name} onChange={(v) => setOpt(i, { name: v })} /></td>
          <td className="r" style={{ width: 110 }}>{fraction ? <Num value={o.fullPrice} onChange={(v) => setOpt(i, { fullPrice: v })} /> : <Num value={o.price} onChange={(v) => setOpt(i, { price: v ?? 0 })} />}</td>
          {fraction && <td className="r num">{fl!.isBase ? <Pill tone="good">preço base</Pill> : "+ " + BRL(fl!.half)}</td>}
          <td style={{ width: 120 }}><Text mono value={o.integrationCode} onChange={(v) => setOpt(i, { integrationCode: v })} /></td>
          <td><Toggle checked={o.active} onChange={(v) => setOpt(i, { active: v })} /></td>
          <td><Btn sm kind="ghost" onClick={() => setG({ ...g, options: opts.filter((_, j) => j !== i) })} title="Remover">✕</Btn></td>
        </tr>;
      })}</tbody>
    </table></div>
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
      const f = e.target.files?.[0]; if (!f || photoFor === null) return;
      try { const fd = new FormData(); fd.append("file", f); const m = await api.upload<{ url: string }>("/admin/media", fd); setOpt(photoFor, { imageUrl: m.url }); toast("Foto enviada"); } catch (er) { toast(errMsg(er), true); }
      e.target.value = "";
    }} />
    <div><Btn onClick={() => setG({ ...g, options: [...opts, { id: "o" + Date.now().toString(36), name: "", price: 0, fullPrice: fraction ? 0 : undefined, active: true }] })}>Adicionar opção</Btn></div>
  </Drawer>;
}

const ROLES: { value: GroupRole; label: string }[] = [
  { value: "size", label: "Tamanho" }, { value: "base", label: "Base, massa ou borda" }, { value: "flavor", label: "Sabor" }, { value: "protein", label: "Proteína" },
  { value: "addon", label: "Adicional" }, { value: "side", label: "Acompanhamento" }, { value: "sauce", label: "Molho" }, { value: "instruction", label: "Instrução (ponto, talheres)" },
  { value: "drink", label: "Bebida" }, { value: "dessert", label: "Sobremesa" },
];
