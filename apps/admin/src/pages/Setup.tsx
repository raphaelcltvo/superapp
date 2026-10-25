import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CARD_BRANDS, OFFLINE_PAYMENTS, VOUCHER_BRANDS, FEATURE_INFO, brandPalette, measureLabel, tagLabel, type CuisineFeature, type CuisineId, type PaymentCode, type SetupStepId, type Store, type Tenant } from "@cw/core";
import { BRL, Btn, Chips, Field, MediaInput, Num, Pill, Text, Toggle, errMsg, useAction, useAdmin, useLoad } from "../ui";

type Step = { id: SetupStepId; label: string; hint: string; optional?: boolean; done: boolean; detail: string; skipped: boolean };
type Status = { steps: Step[]; progress: { done: number; total: number }; cuisine: CuisineId | null; slug: string; menuUrl: string; state: { menuSource?: string; ordersMode?: string }; counts: { categories: number; items: number; groups: number } };
type CuisineInfo = { id: CuisineId; label: string; pitch: string; features: CuisineFeature[]; tips: string[]; categories: string[]; groups: { name: string; role: string; min: number; max: number; rule: string; freeQuota?: number; options: number }[]; items: { name: string; price: number; category: string; leadTimeHours?: number; measure?: { unit: "g" | "kg" | "ml" | "l" | "un"; amount: number }; serves?: string; tags?: string[] }[] };

/** Assistente de implantação: da marca ao cardápio no ar, na ordem em que uma operação de delivery nasce. */
export function SetupPage(p: { slots?: { ifood?: (onDone: () => void) => ReactNode; whatsapp?: (onDone: () => void) => ReactNode } }) {
  const st = useLoad<Status>("/admin/setup");
  const [cur, setCur] = useState<SetupStepId | null>(null);
  const s = st.data;
  useEffect(() => { if (s && !cur) setCur((s.steps.find((x) => !x.done && !x.skipped) || s.steps[0]).id); }, [s, cur]);
  if (!s || !cur) return null;
  const idx = s.steps.findIndex((x) => x.id === cur);
  const next = () => { st.reload(); const n = s.steps.slice(idx + 1).find((x) => !x.done) || s.steps[idx + 1]; if (n) setCur(n.id); window.scrollTo?.(0, 0); };
  const saved = () => st.reload();
  const step = s.steps[idx];
  return <>
    <div className="pagehead">
      <div><h1>Setup da marca</h1><p>Nove passos para sair do zero e receber pedidos no cardápio próprio. O que você já fez aparece marcado sozinho; dá para voltar a qualquer passo.</p></div>
      <div className="su-prog" aria-label={`${s.progress.done} de ${s.progress.total} passos obrigatórios`}><b className="num">{s.progress.done}/{s.progress.total}</b><div className="bar"><i style={{ width: `${(s.progress.done / s.progress.total) * 100}%` }} /></div></div>
    </div>
    <div className="su-wrap">
      <ol className="su-steps">
        {s.steps.map((x, i) => <li key={x.id}>
          <button className="su-step" aria-current={x.id === cur ? "step" : undefined} onClick={() => setCur(x.id)}>
            <span className={`su-n${x.done ? " ok" : ""}`} aria-hidden="true">{x.done ? "✓" : i + 1}</span>
            <span className="su-t"><b>{x.label}{x.optional && <em> · opcional</em>}</b><span>{x.done || x.id === cur ? x.detail : x.hint}</span></span>
          </button>
        </li>)}
      </ol>
      <section className="panel su-body" aria-labelledby="su-h">
        <header><div><small className="su-kicker">Passo {idx + 1} de {s.steps.length}</small><h2 id="su-h">{step.label}</h2></div>{step.done ? <Pill tone="good">pronto</Pill> : step.optional ? <Pill>opcional</Pill> : <Pill tone="warn">pendente</Pill>}</header>
        {cur === "marca" && <BrandStep status={s} onSaved={next} />}
        {cur === "culinaria" && <CuisineStep status={s} onSaved={next} />}
        {cur === "loja" && <StoreStep onSaved={next} />}
        {cur === "cardapio" && <MenuStep status={s} onSaved={saved} onNext={next} ifood={p.slots?.ifood} />}
        {cur === "pagamento" && <PaymentStep onSaved={next} />}
        {cur === "pedidos" && <OrdersStep status={s} onSaved={next} />}
        {cur === "whatsapp" && <WhatsAppStep onSaved={next} slot={p.slots?.whatsapp} />}
        {cur === "base" && <BaseStep onSkip={next} />}
        {cur === "publicar" && <PublishStep status={s} onSaved={saved} />}
      </section>
    </div>
  </>;
}

/* ---------------- 1. marca ---------------- */
const SWATCHES = ["#A3191F", "#D9480F", "#E8A317", "#2F6B3F", "#0F766E", "#1F5F8B", "#6D28D9", "#C2185B", "#3E2723", "#111111"];
function BrandStep(p: { status: Status; onSaved: () => void }) {
  const { api, dirty } = useAdmin(); const { run, busy } = useAction();
  const brand = useLoad<Tenant & { publishedVersionId?: string }>("/admin/brand");
  const [f, setF] = useState<{ name: string; slug: string; logoUrl?: string; color: string; whatsapp: string; instagram: string; legalName: string; cnpj: string } | null>(null);
  useEffect(() => { const t = brand.data; if (t && !f) setF({ name: t.name, slug: t.slug, logoUrl: t.branding.logoUrl, color: t.branding.colors.brand, whatsapp: t.settings.whatsapp || "", instagram: t.settings.instagram || "", legalName: t.settings.legalName || "", cnpj: t.settings.cnpj || "" }); }, [brand.data, f]);
  if (!f) return null;
  const pal = brandPalette(f.color);
  const locked = !!brand.data?.publishedVersionId;
  const host = p.status.menuUrl.replace(/\/[^/]*$/, "");
  return <div className="stack">
    <div className="grid2">
      <Field label="Nome da marca"><Text id="su-name" value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
      <Field label="Endereço do cardápio" hint={locked ? "Já publicado: o endereço não muda mais" : `${host}/${f.slug || "sua-marca"}`}><Text id="su-slug" mono value={f.slug} onChange={(v) => !locked && setF({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
      <Field label="WhatsApp de atendimento" hint="Aparece no cardápio e recebe os alertas da loja"><Text id="su-wa" value={f.whatsapp} placeholder="(21) 99999-9999" onChange={(v) => setF({ ...f, whatsapp: v })} /></Field>
      <Field label="Instagram"><Text value={f.instagram} placeholder="@suamarca" onChange={(v) => setF({ ...f, instagram: v })} /></Field>
    </div>
    <div className="grid2">
      <Field label="Logo" hint="Quadrado, fundo sólido, até 3 MB"><div className="row" style={{ flexWrap: "nowrap" }}>{f.logoUrl ? <img className="su-logo" src={f.logoUrl} alt="Logo atual" /> : <span className="su-logo" style={{ background: f.color }} />}<MediaInput id="su-logo" value={f.logoUrl} accept="image/*" onChange={(url) => setF({ ...f, logoUrl: url })} /></div></Field>
      <Field label="Cor principal" hint="Botões, preços e destaques do cardápio">
        <div className="su-sw" role="radiogroup" aria-label="Cor principal">
          {SWATCHES.map((c) => <button key={c} type="button" role="radio" aria-checked={f.color.toUpperCase() === c} aria-label={c} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}
          <label className="su-custom">outra<input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value.toUpperCase() })} /></label>
        </div>
      </Field>
    </div>
    <div className="su-preview" style={{ ["--b" as string]: pal.brand, ["--bd" as string]: pal.brandDeep, ["--bs" as string]: pal.brandSoft }} aria-label="Prévia das cores">
      <span className="su-pv-chip">Mais pedido</span><b>{f.name || "Sua marca"}</b><span className="su-pv-price">R$ 49,90</span><span className="su-pv-btn">Adicionar</span>
    </div>
    <details><summary className="small">Dados da empresa (rodapé do cardápio e nota)</summary>
      <div className="grid2" style={{ marginTop: 10 }}><Field label="Razão social"><Text value={f.legalName} onChange={(v) => setF({ ...f, legalName: v })} /></Field><Field label="CNPJ"><Text value={f.cnpj} onChange={(v) => setF({ ...f, cnpj: v })} /></Field></div>
    </details>
    <div className="row"><Btn kind="primary" id="su-brand-save" disabled={busy || f.name.trim().length < 2} onClick={async () => { if (await run(() => api.put("/admin/setup/brand", { ...f, slug: locked ? undefined : f.slug, logoUrl: f.logoUrl || "" }), "Marca salva")) { dirty(); p.onSaved(); } }}>Salvar e continuar</Btn></div>
  </div>;
}

/* ---------------- 2. culinária ---------------- */
function CuisineStep(p: { status: Status; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const list = useLoad<CuisineInfo[]>("/admin/setup/cuisines");
  const [sel, setSel] = useState<CuisineId | null>(p.status.cuisine);
  const [others, setOthers] = useState<CuisineId[]>([]);
  const c = list.data?.find((x) => x.id === sel);
  return <div className="stack">
    <p className="muted small">A culinária escolhe o modelo de cardápio, as regras do segmento (meio a meio, venda por peso, encomenda, cota grátis…) e as perguntas da triagem do cliente novo. Tudo continua editável.</p>
    <div className="su-cuis" role="radiogroup" aria-label="Culinária principal">
      {(list.data || []).map((x) => <button key={x.id} type="button" role="radio" aria-checked={sel === x.id} className="su-cu" data-cuisine={x.id} onClick={() => setSel(x.id)}>
        <b>{x.label}</b><span>{x.pitch}</span>
        {x.features.length > 0 && <span className="su-feats">{x.features.slice(0, 3).map((f) => <i key={f}>{FEATURE_INFO[f].label}</i>)}</span>}
      </button>)}
    </div>
    {c && <div className="su-tips">
      <h3>O que muda num cardápio de {c.label.toLowerCase()}</h3>
      <ul>{c.features.map((f) => <li key={f}><b>{FEATURE_INFO[f].label}.</b> {FEATURE_INFO[f].how}</li>)}{c.tips.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>}
    {sel && <Field label="Também vende (opcional)" hint="Ex.: pizzaria que vende esfiha. Ajuda a detectar itens e montar a triagem."><Chips value={others} onChange={setOthers} options={(list.data || []).filter((x) => x.id !== sel && x.id !== "generico").map((x) => ({ value: x.id, label: x.label }))} /></Field>}
    <div className="row"><Btn kind="primary" id="su-cuisine-save" disabled={busy || !sel} onClick={async () => { if (await run(() => api.put("/admin/setup/cuisine", { cuisine: sel, others }), "Culinária salva")) p.onSaved(); }}>Salvar e continuar</Btn></div>
  </div>;
}

/* ---------------- 3. loja ---------------- */
const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function StoreStep(p: { onSaved: () => void }) {
  const { api, setStoreId } = useAdmin(); const { run, busy } = useAction();
  const stores = useLoad<Store[]>("/admin/stores");
  const [f, setF] = useState<{ name: string; phone: string; address: Store["address"]; days: number[]; open: string; close: string; delivery: boolean; takeout: boolean; radiusKm?: number; fee?: number; etaMin?: number; etaMax?: number } | null>(null);
  useEffect(() => {
    if (f || !stores.data) return;
    const s = stores.data[0]; const z = s?.zones.find((x) => x.kind === "radius") || s?.zones[0];
    setF({ name: s?.name || "", phone: s?.phone || "", address: s?.address || { street: "", number: "", district: "", city: "", state: "RJ", postalCode: "" }, days: s?.hours.length ? [...new Set(s.hours.map((h) => h.weekday))] : [0, 2, 3, 4, 5, 6], open: s?.hours[0]?.open || "18:00", close: s?.hours[0]?.close || "23:30", delivery: s?.modes.delivery ?? true, takeout: s?.modes.takeout ?? true, radiusKm: z?.radiusKm ?? 5, fee: z?.fee ?? 7.9, etaMin: z?.etaMin ?? 35, etaMax: z?.etaMax ?? 55 });
  }, [stores.data, f]);
  if (!f) return null;
  const a = f.address; const setA = (x: Partial<Store["address"]>) => setF({ ...f, address: { ...a, ...x } });
  const varied = (stores.data?.[0]?.hours || []).some((h) => h.open !== f.open || h.close !== f.close);
  const ok = f.name.trim().length > 1 && a.street && a.number && a.district && a.city && a.state.length === 2 && f.days.length > 0 && (f.delivery || f.takeout);
  return <div className="stack">
    <div className="grid2">
      <Field label="Nome da loja" hint="Ex.: Forneria Original · Barra"><Text id="su-store" value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
      <Field label="Telefone da loja"><Text value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></Field>
    </div>
    <div className="grid3">
      <Field label="CEP"><Text id="su-cep" value={a.postalCode} placeholder="00000-000" onChange={(v) => setA({ postalCode: v })} /></Field>
      <Field label="Rua" wide><Text id="su-street" value={a.street} onChange={(v) => setA({ street: v })} /></Field>
      <Field label="Número"><Text id="su-number" value={a.number} onChange={(v) => setA({ number: v })} /></Field>
      <Field label="Bairro"><Text id="su-district" value={a.district} onChange={(v) => setA({ district: v })} /></Field>
      <Field label="Cidade"><Text id="su-city" value={a.city} onChange={(v) => setA({ city: v })} /></Field>
      <Field label="UF"><Text id="su-uf" value={a.state} onChange={(v) => setA({ state: v.toUpperCase().slice(0, 2) })} /></Field>
    </div>
    <Field label="Dias de funcionamento" hint={varied ? "Hoje há horários diferentes por dia; salvar aqui iguala todos" : "Horário diferente por dia: ajuste depois em Lojas e entrega"}><Chips value={f.days} onChange={(v) => setF({ ...f, days: v })} options={WD.map((l, i) => ({ value: i, label: l }))} /></Field>
    <div className="row"><label className="small">Abre <input type="time" value={f.open} onChange={(e) => setF({ ...f, open: e.target.value })} /></label><label className="small">Fecha <input type="time" value={f.close} onChange={(e) => setF({ ...f, close: e.target.value })} /></label><span className="small muted">Pode passar da meia-noite</span></div>
    <div className="row"><Toggle checked={f.delivery} onChange={(v) => setF({ ...f, delivery: v })} label="Entrega" /><Toggle checked={f.takeout} onChange={(v) => setF({ ...f, takeout: v })} label="Retirada no balcão" /></div>
    {f.delivery && <div className="grid4">
      <Field label="Raio de entrega (km)"><Num id="su-radius" value={f.radiusKm} onChange={(v) => setF({ ...f, radiusKm: v })} /></Field>
      <Field label="Taxa (R$)"><Num id="su-fee" value={f.fee} onChange={(v) => setF({ ...f, fee: v })} /></Field>
      <Field label="Tempo mínimo (min)"><Num value={f.etaMin} onChange={(v) => setF({ ...f, etaMin: v })} /></Field>
      <Field label="Tempo máximo (min)"><Num value={f.etaMax} onChange={(v) => setF({ ...f, etaMax: v })} /></Field>
    </div>}
    {f.delivery && <p className="small muted">Começe com um raio único. Áreas desenhadas no mapa, com taxa e tempo por bairro, ficam em Lojas e entrega.</p>}
    <div className="row"><Btn kind="primary" id="su-store-save" disabled={busy || !ok} onClick={async () => {
      const r = await run(() => api.put<{ store: Store }>("/admin/setup/store", { name: f.name, phone: f.phone || undefined, address: a, hours: f.days.sort().map((weekday) => ({ weekday, open: f.open, close: f.close })), modes: { delivery: f.delivery, takeout: f.takeout }, delivery: f.delivery ? { radiusKm: f.radiusKm || 5, fee: f.fee || 0, etaMin: f.etaMin || 30, etaMax: f.etaMax || 50 } : undefined }), "Loja salva");
      if (r) { setStoreId(r.store.id); p.onSaved(); }
    }}>Salvar e continuar</Btn></div>
  </div>;
}

/* ---------------- 4. cardápio ---------------- */
function MenuStep(p: { status: Status; onSaved: () => void; onNext: () => void; ifood?: (onDone: () => void) => ReactNode }) {
  const { api, go, dirty } = useAdmin(); const { run, busy } = useAction();
  const [src, setSrc] = useState<"ifood" | "modelo" | "zero" | null>((p.status.state.menuSource as "ifood") || null);
  const list = useLoad<CuisineInfo[]>("/admin/setup/cuisines");
  const [cz, setCz] = useState<CuisineId | null>(p.status.cuisine);
  const [samples, setSamples] = useState(true);
  const t = list.data?.find((x) => x.id === (cz || "generico"));
  const has = p.status.counts.items > 0;
  const apply = async (mode: "replace" | "merge") => { const r = await run(() => api.post<{ items: number }>("/admin/setup/template", { cuisine: t!.id, mode, withSamples: samples }), "Modelo aplicado ao rascunho"); if (r) { dirty(); p.onSaved(); } };
  return <div className="stack">
    {has && <div className="su-have"><b>{p.status.counts.categories} categorias · {p.status.counts.items} itens · {p.status.counts.groups} grupos de complemento</b><span className="muted small">no rascunho</span><Btn sm onClick={() => go("cardapio")}>Revisar itens</Btn><Btn sm kind="primary" onClick={p.onNext}>Continuar</Btn></div>}
    <div className="su-src" role="radiogroup" aria-label="Como montar o cardápio">
      {([["ifood", "Copiar do iFood", "Cole o link da sua loja no iFood: categorias, itens, fotos, complementos e preços vêm juntos."], ["modelo", "Começar pelo modelo", "Estrutura pronta da sua culinária com itens de exemplo para editar."], ["zero", "Montar do zero", "Crie categorias, itens e complementos à mão."]] as const).map(([id, label, txt]) => <button key={id} type="button" role="radio" aria-checked={src === id} className="su-cu" data-src={id} onClick={() => { setSrc(id); api.put("/admin/setup/state", { menuSource: id }).catch(() => {}); }}><b>{label}</b><span>{txt}</span></button>)}
    </div>
    {src === "ifood" && (p.ifood ? p.ifood(() => { dirty(); p.onSaved(); }) : <div className="su-have"><span>Importação do iFood</span><Btn sm onClick={() => go("importar")}>Abrir importação</Btn></div>)}
    {src === "modelo" && t && <div className="stack">
      <div className="row"><b>Modelo:</b><select aria-label="Modelo de culinária" value={t.id} onChange={(e) => setCz(e.target.value as CuisineId)}>{(list.data || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select><Toggle checked={samples} onChange={setSamples} label="Incluir itens de exemplo" /></div>
      <div className="su-tpl">
        <div><h3>Categorias</h3><ol>{t.categories.map((c) => <li key={c}>{c}</li>)}</ol></div>
        <div><h3>Complementos</h3><ul>{t.groups.map((g) => <li key={g.name}><b>{g.name}</b> <span className="small muted">{g.rule === "fraction" ? "meio a meio" : g.min === g.max ? `escolhe ${g.min}` : `${g.min} a ${g.max}`}{g.freeQuota ? ` · ${g.freeQuota} grátis` : ""} · {g.options} opções</span></li>)}</ul></div>
        {samples && <div><h3>Itens de exemplo</h3><ul>{t.items.map((i) => <li key={i.name}><span>{i.name}</span> <span className="small muted">{BRL(i.price)}{i.measure ? ` · ${measureLabel(i.measure)}` : ""}{i.serves ? ` · ${i.serves}` : ""}{i.leadTimeHours ? ` · encomenda ${i.leadTimeHours} h` : ""}{i.tags?.length ? ` · ${i.tags.map(tagLabel).join(", ")}` : ""}</span></li>)}</ul></div>}
      </div>
      <div className="row">{has ? <><Btn kind="primary" disabled={busy} onClick={() => apply("merge")}>Juntar ao que já existe</Btn><Btn kind="danger" disabled={busy} onClick={() => apply("replace")}>Substituir o cardápio</Btn></> : <Btn kind="primary" id="su-tpl-apply" disabled={busy} onClick={() => apply("replace")}>Usar este modelo</Btn>}</div>
      <p className="small muted">Nada vai ao ar agora: o modelo entra no rascunho. Troque nomes, preços e fotos em Itens e categorias.</p>
    </div>}
    {src === "zero" && <div className="su-have"><span>Comece pelas categorias e pelos 10 itens que mais vendem.</span><Btn sm kind="primary" onClick={() => go("cardapio")}>Abrir Itens e categorias</Btn><Btn sm onClick={() => go("complementos")}>Complementos</Btn></div>}
  </div>;
}

/* ---------------- 5. pagamento ---------------- */
function PaymentStep(p: { onSaved: () => void }) {
  const { api, go } = useAdmin(); const { run, busy } = useAction();
  const stores = useLoad<Store[]>("/admin/stores");
  const online = useLoad<{ config: { enabled: boolean; gateway: string } | null }>("/admin/integrations/payments");
  const [on, setOn] = useState<PaymentCode[] | null>(null);
  const [cards, setCards] = useState<string[]>(CARD_BRANDS.slice(0, 3));
  const [vouchers, setVouchers] = useState<string[]>([]);
  useEffect(() => {
    const s = stores.data?.[0]; if (!s || on) return;
    const act = s.payments.filter((x) => x.active && !x.online).map((x) => x.code);
    setOn(act.length ? act : ["CREDIT_ON_DELIVERY", "DEBIT_ON_DELIVERY", "CASH"]);
    const cb = s.payments.find((x) => x.code === "CREDIT_ON_DELIVERY")?.brands; if (cb) setCards(cb);
    const vb = s.payments.find((x) => x.code === "VR_VA")?.brands; if (vb) setVouchers(vb);
  }, [stores.data, on]);
  if (!stores.data) return null;
  if (!stores.data.length) return <p className="muted">Cadastre a loja no passo anterior antes do pagamento.</p>;
  if (!on) return null;
  const tog = (c: PaymentCode, v: boolean) => setOn(v ? [...on, c] : on.filter((x) => x !== c));
  return <div className="stack">
    <div className="su-pay"><h3>Na entrega ou na retirada</h3><p className="small muted">Sem gateway, sem taxa de intermediação: o entregador leva a maquininha. O cliente escolhe a forma no cardápio e ela aparece no pedido.</p>
      {OFFLINE_PAYMENTS.map((x) => <div key={x.code} className="li"><Toggle checked={on.includes(x.code)} onChange={(v) => tog(x.code, v)} label={<><b>{x.label}</b> <span className="small muted">{x.hint}</span></>} /></div>)}
    </div>
    {(on.includes("CREDIT_ON_DELIVERY") || on.includes("DEBIT_ON_DELIVERY")) && <Field label="Bandeiras aceitas na maquininha"><Chips value={cards} onChange={setCards} options={CARD_BRANDS.map((b) => ({ value: b, label: b }))} /></Field>}
    {on.includes("VR_VA") && <Field label="Vales aceitos"><Chips value={vouchers} onChange={setVouchers} options={VOUCHER_BRANDS.map((b) => ({ value: b, label: b }))} /></Field>}
    <div className="su-have"><span><b>Pagamento online</b> (Pix e cartão no app) {online.data?.config?.enabled ? <Pill tone="good">ligado</Pill> : <Pill>opcional</Pill>}</span><span className="small muted">Precisa de conta no Mercado Pago, Pagar.me ou Asaas. Dá para ligar depois.</span><Btn sm onClick={() => go("pagamentos")}>Configurar online</Btn></div>
    <div className="row"><Btn kind="primary" id="su-pay-save" disabled={busy || !on.length} onClick={async () => { if (await run(() => api.put("/admin/setup/payments", { methods: on, cardBrands: cards, voucherBrands: vouchers }), "Pagamento salvo")) p.onSaved(); }}>Salvar e continuar</Btn></div>
  </div>;
}

/* ---------------- 6. pedidos ---------------- */
type OrdersCfg = { mode: "manager" | "pdv"; autoAccept: boolean; prepMinutes: number; deliveryMinutes: number; lateAfterMinutes: number; sound: boolean; printOnAccept: boolean; rejectReasons: string[] };
function OrdersStep(p: { status: Status; onSaved: () => void }) {
  const { api, go, toast } = useAdmin(); const { busy } = useAction();
  const cfg = useLoad<OrdersCfg>("/admin/settings/orders");
  const [c, setC] = useState<OrdersCfg | null>(null);
  useEffect(() => { if (!c) setC(cfg.data || (cfg.error ? { mode: (p.status.state.ordersMode as "pdv") || "manager", autoAccept: false, prepMinutes: 25, deliveryMinutes: 30, lateAfterMinutes: 10, sound: true, printOnAccept: false, rejectReasons: [] } : null)); }, [cfg.data, cfg.error, c, p.status.state.ordersMode]);
  if (!c) return null;
  const save = async () => {
    try { await api.put("/admin/setup/state", { ordersMode: c.mode }); await api.put("/admin/settings/orders", c).catch(() => {}); toast("Pedidos configurados"); p.onSaved(); } catch (e) { toast(errMsg(e), true); }
  };
  return <div className="stack">
    <div className="su-src" role="radiogroup" aria-label="Onde a loja recebe os pedidos">
      <button type="button" role="radio" aria-checked={c.mode === "manager"} className="su-cu" onClick={() => setC({ ...c, mode: "manager" })}><b>Gestor de pedidos do SuperApp</b><span>Quadro ao vivo no computador ou tablet da loja: novo pedido toca alerta, você aceita, imprime a comanda e avança até entregue. Sem PDV, sem custo extra.</span></button>
      <button type="button" role="radio" aria-checked={c.mode === "pdv"} className="su-cu" onClick={() => setC({ ...c, mode: "pdv" })}><b>Mandar para o meu PDV</b><span>Os pedidos entram direto no PDV (SAIPOS hoje) e os status voltam sozinhos. Use se a cozinha já trabalha pelo PDV.</span></button>
    </div>
    {c.mode === "manager" ? <div className="stack">
      <div className="row"><Toggle checked={c.autoAccept} onChange={(v) => setC({ ...c, autoAccept: v })} label="Aceitar pedidos automaticamente" /><Toggle checked={c.sound} onChange={(v) => setC({ ...c, sound: v })} label="Alerta sonoro em pedido novo" /><Toggle checked={c.printOnAccept} onChange={(v) => setC({ ...c, printOnAccept: v })} label="Imprimir comanda ao aceitar" /></div>
      <div className="grid3"><Field label="Preparo (min)"><Num value={c.prepMinutes} onChange={(v) => setC({ ...c, prepMinutes: v ?? 25 })} /></Field><Field label="Entrega (min)"><Num value={c.deliveryMinutes} onChange={(v) => setC({ ...c, deliveryMinutes: v ?? 30 })} /></Field><Field label="Atrasado depois de (min)"><Num value={c.lateAfterMinutes} onChange={(v) => setC({ ...c, lateAfterMinutes: v ?? 10 })} /></Field></div>
    </div> : <div className="su-have"><span>Conecte o PDV em Integrações. Até lá os pedidos aparecem no gestor.</span><Btn sm onClick={() => go("integracoes")}>Conectar SAIPOS</Btn></div>}
    <div className="row"><Btn kind="primary" id="su-orders-save" disabled={busy} onClick={save}>Salvar e continuar</Btn><Btn onClick={() => go("pedidos")}>Ver o gestor</Btn></div>
  </div>;
}

/* ---------------- 7. WhatsApp ---------------- */
function WhatsAppStep(p: { onSaved: () => void; slot?: (onDone: () => void) => ReactNode }) {
  const { go } = useAdmin();
  return <div className="stack">
    <p className="small">O WhatsApp é o canal do CRM: confirma o pedido, avisa quando sai para entrega, recebe as respostas dos clientes e dispara as campanhas de recompra. Pagamento online e PDV são opcionais; o WhatsApp é o que mais pesa na recompra.</p>
    {p.slot ? p.slot(p.onSaved) : <div className="su-have"><span>Conexão do WhatsApp</span><Btn sm kind="primary" onClick={() => go("mensagens")}>Conectar</Btn></div>}
  </div>;
}

/* ---------------- 8. base ---------------- */
function BaseStep(p: { onSkip: () => void }) {
  const { go, api } = useAdmin();
  return <div className="stack">
    <p className="small">Com a base de clientes e pedidos de outros canais (iFood, PDV, planilha), o algoritmo encontra os perfis de consumo da marca: quem pede sozinho ou para a família, quem fica nos clássicos e quem experimenta. Esses perfis viram as perguntas da triagem do cliente novo, o topo do cardápio de quem volta e os segmentos do CRM.</p>
    <ul className="small su-list"><li>Planilha ou CSV de clientes: telefone, nome, e-mail, aniversário, aceite de WhatsApp.</li><li>Planilha de pedidos: data, valor, telefone, canal e, se tiver, os itens.</li><li>Sem base, a triagem usa o roteiro da culinária e aprende com os primeiros pedidos.</li></ul>
    <div className="row"><Btn kind="primary" onClick={() => go("integracoes")}>Importar clientes e pedidos</Btn><Btn onClick={async () => { await api.put("/admin/setup/state", { skipped: ["base"] }).catch(() => {}); p.onSkip(); }}>Fazer depois</Btn></div>
  </div>;
}

/* ---------------- 9. publicar ---------------- */
function PublishStep(p: { status: Status; onSaved: () => void }) {
  const { api, go, toast, onPublished } = useAdmin(); const { busy } = useAction();
  const audit = useLoad<{ level: "erro" | "aviso"; where: string; message: string }[]>("/admin/audit");
  const [pub, setPub] = useState(false);
  const errs = (audit.data || []).filter((x) => x.level === "erro"); const warns = (audit.data || []).filter((x) => x.level === "aviso");
  const pending = p.status.steps.filter((s) => !s.done && !s.optional && s.id !== "publicar");
  const photos = useMemo(() => warns.filter((w) => w.message === "Sem foto").length, [warns]);
  return <div className="stack">
    {pending.length > 0 && <div className="issue aviso"><span>Ainda falta: {pending.map((s) => s.label).join(", ")}. Dá para publicar assim e completar depois.</span></div>}
    {errs.length > 0 ? <div className="stack"><b>{errs.length} {errs.length === 1 ? "erro impede" : "erros impedem"} a publicação</b>{errs.slice(0, 8).map((e, i) => <div key={i} className="issue erro"><span><b>{e.where}:</b> {e.message}</span></div>)}<div><Btn sm onClick={() => go("publicar")}>Ver todos e corrigir</Btn></div></div>
      : <p className="small" style={{ color: "var(--good)" }}>Nenhum erro de preço, grupo ou link.</p>}
    {photos > 0 && <p className="small muted">{photos} itens sem foto. Publicar sem foto funciona, mas itens com foto vendem mais.</p>}
    <div className="row">
      <Btn kind="primary" id="su-publish" disabled={busy || errs.length > 0} onClick={async () => { try { await api.post("/admin/publish", { notes: "Primeira publicação pelo Setup" }); setPub(true); onPublished?.(); toast("Cardápio publicado"); p.onSaved(); } catch (e) { toast(errMsg(e), true); audit.reload(); } }}>Publicar cardápio</Btn>
    </div>
    {(pub || p.status.steps.find((s) => s.id === "publicar")?.done) && <div className="su-live"><b>Seu cardápio está no ar</b><div className="codebox">{p.status.menuUrl}</div><div className="row"><Btn sm onClick={() => { navigator.clipboard?.writeText(p.status.menuUrl).then(() => toast("Link copiado")).catch(() => {}); }}>Copiar link</Btn><Btn sm onClick={() => go("pedidos")}>Abrir o gestor de pedidos</Btn></div><p className="small muted">Coloque o link na bio do Instagram, no Google Meu Negócio e no status do WhatsApp.</p></div>}
  </div>;
}
