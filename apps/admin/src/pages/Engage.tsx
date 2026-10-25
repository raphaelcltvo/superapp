import { useState } from "react";
import { PLAYBOOKS, type CampaignTarget, type Category, type Coupon, type EngagementSettings, type FvQuestion } from "@cw/core";
import { BRL, Btn, Empty, Field, Num, Pill, Select, Tabs, Text, Tile, Toggle, dt, pct, useAction, useAdmin, useLoad } from "../ui";
import { Bars } from "../charts";

type Report = {
  days: number; nps: Nps; prevNps: Nps; distribution: number[]; responseRate: number;
  reasonsLow: Row[]; reasonsHigh: Row[]; wantToTry: Row[];
  detractors: { total: number; recovered: number; credit: number };
  comments: { orderId: string; displayId: string; at: string; nps: number; kind: string; reasons: string[]; comment?: string; customer: string; creditGiven?: number }[];
  triage: { shown: number; answered: number; skipped: number; answers: { key: string; value: number }[] };
  effects: { name: string; label: string; sessions: number; conversion: number }[]; baseline: number; sessions: number;
};
type Nps = { nps: number; n: number; promotores: number; neutros: number; detratores: number };
type Row = { label: string; value: number };

const ANSWER: Record<string, string> = {
  "party:solo": "Pra quantos · só eu", "party:dupla": "Pra quantos · a dois", "party:galera": "Pra quantos · galera",
  "mood:salgada": "Vontade · salgada", "mood:doce": "Vontade · doce", "mood:ambas": "Vontade · as duas",
  "craving:de_sempre": "O de sempre", "craving:novidade": "Algo novo",
};
const KIND_TXT: Record<string, string> = { party: "Pra quantas pessoas", mood: "Salgada ou doce", craving: "O de sempre ou novidade", avoid: "O que não come" };

export function EngagePage() {
  const [tab, setTab] = useState<"resultados" | "primeira" | "triagem" | "pos" | "efeitos">("resultados");
  return <>
    <div className="pagehead"><div><h1>Pesquisa e engajamento</h1><p>Uma pergunta de 1 toque antes de pedir, a avaliação depois da entrega e os sinais que chamam atenção na hora certa. Tudo volta para o cardápio de cada cliente.</p></div></div>
    <Tabs value={tab} onChange={setTab} tabs={[{ value: "resultados", label: "Resultados" }, { value: "primeira", label: "Primeira visita" }, { value: "triagem", label: "Triagem (clientes)" }, { value: "pos", label: "Pós-pedido" }, { value: "efeitos", label: "Efeitos na jornada" }]} />
    {tab === "resultados" ? <Results /> : tab === "primeira" ? <FirstVisitTab /> : <SettingsTab tab={tab} />}
  </>;
}

/* ---------------- resultados ---------------- */
function NpsColumns({ dist }: { dist: number[] }) {
  const max = Math.max(1, ...dist); const W = 440, H = 150, B = 22, gap = 6, w = (W - gap * 10) / 11;
  const color = (n: number) => (n <= 6 ? "var(--bad)" : n <= 8 ? "var(--axis)" : "var(--good)");
  return <div>
    <div className="row small" style={{ gap: 14, marginBottom: 6 }}>
      {[["Detratores (0–6)", "var(--bad)"], ["Neutros (7–8)", "var(--axis)"], ["Promotores (9–10)", "var(--good)"]].map(([l, c]) => <span key={l} className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}</span>)}
    </div>
    <svg className="viz" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Distribuição das notas de 0 a 10">
      <line className="axis" x1={0} x2={W} y1={H - B} y2={H - B} />
      {dist.map((v, n) => { const h = ((H - B - 14) * v) / max; const x = n * (w + gap); return <g key={n}><title>{`Nota ${n}: ${v} respostas`}</title>
        <rect x={x} y={H - B - h} width={w} height={h} rx={3} fill={color(n)} />
        {v > 0 && <text x={x + w / 2} y={H - B - h - 4} textAnchor="middle">{v}</text>}
        <text x={x + w / 2} y={H - 6} textAnchor="middle">{n}</text></g>; })}
    </svg>
  </div>;
}

function Results() {
  const [days, setDays] = useState("30");
  const r = useLoad<Report>(`/admin/engagement/report?days=${days}`, [days]);
  const d = r.data;
  return <div className="stack">
    <div className="row"><span className="small muted">Período</span><div style={{ width: 140 }}><Select value={days} onChange={setDays} options={[{ value: "7", label: "7 dias" }, { value: "30", label: "30 dias" }, { value: "90", label: "90 dias" }]} /></div></div>
    {!d ? (r.error ? <Empty title="Não deu para carregar">{r.error}</Empty> : null) : <>
      <div className="grid4">
        <Tile k="NPS" v={d.nps.n ? d.nps.nps : "—"} d={d.prevNps.n ? <span className={d.nps.nps >= d.prevNps.nps ? "up" : "down"}>{d.nps.nps >= d.prevNps.nps ? "▲" : "▼"} {Math.abs(d.nps.nps - d.prevNps.nps)} pts vs período anterior</span> : <span className="muted">sem base anterior</span>} />
        <Tile k="Respostas" v={d.nps.n} d={<span className="muted">{pct(d.responseRate)} dos pedidos entregues</span>} />
        <Tile k="Detratores que voltaram" v={d.detractors.total ? `${d.detractors.recovered} de ${d.detractors.total}` : "—"} d={<span className="muted">{BRL(d.detractors.credit)} em crédito de desculpas</span>} />
        <Tile k="Triagem respondida" v={d.triage.shown ? pct((d.triage.answered / d.triage.shown) * 100) : "—"} d={<span className="muted">{d.triage.answered} de {d.triage.shown} perguntas</span>} />
      </div>
      <div className="grid2">
        <section className="panel"><header><h3>Notas de 0 a 10</h3><span className="small muted">{d.nps.promotores} promotores · {d.nps.neutros} neutros · {d.nps.detratores} detratores</span></header>
          {d.nps.n ? <NpsColumns dist={d.distribution} /> : <Empty title="Sem respostas no período" />}
        </section>
        <section className="panel"><header><h3>Quero provar da próxima vez</h3><p>Vira o card do topo na próxima visita de quem respondeu</p></header>
          {d.wantToTry.length ? <Bars rows={d.wantToTry} format={(v) => String(v)} /> : <Empty title="Ninguém escolheu ainda" />}
        </section>
      </div>
      <div className="grid2">
        <section className="panel"><header><h3>O que deu errado (notas até 8)</h3></header>{d.reasonsLow.length ? <Bars rows={d.reasonsLow} format={(v) => String(v)} color="var(--s2)" /> : <Empty title="Nada reclamado" />}</section>
        <section className="panel"><header><h3>O que mais agradou (9 e 10)</h3></header>{d.reasonsHigh.length ? <Bars rows={d.reasonsHigh} format={(v) => String(v)} /> : <Empty title="Sem respostas" />}</section>
      </div>
      <section className="panel"><header><h3>Efeitos na jornada</h3><p>Conversão das sessões que viram cada efeito, contra {pct(d.baseline)} de todas as {d.sessions.toLocaleString("pt-BR")} sessões. É associação, não causa: para medir o ganho real, desligue um efeito por uma semana e compare.</p></header>
        <div className="tablewrap"><table>
          <thead><tr><th>Efeito</th><th className="r">Sessões</th><th className="r">Viraram pedido</th><th className="r">vs todas as sessões</th></tr></thead>
          <tbody>{d.effects.map((e) => <tr key={e.name}><td><b>{e.label}</b></td><td className="r">{e.sessions.toLocaleString("pt-BR")}</td><td className="r">{e.sessions ? pct(e.conversion) : "—"}</td><td className="r small">{e.sessions ? <span className={e.conversion >= d.baseline ? "up" : "down"}>{e.conversion >= d.baseline ? "+" : "−"}{Math.abs(e.conversion - d.baseline).toFixed(1).replace(".", ",")} p.p.</span> : "—"}</td></tr>)}</tbody>
        </table></div>
      </section>
      <div className="split">
        <section className="panel"><header><h3>Comentários recentes</h3><p>Detratores recebem crédito automático e a loja é avisada no WhatsApp</p></header>
          {d.comments.length ? <div className="list">{d.comments.map((c) => <div className="li" key={c.orderId} style={{ alignItems: "flex-start" }}>
            <Pill tone={c.kind === "promotor" ? "good" : c.kind === "detrator" ? "bad" : undefined}>{c.nps}</Pill>
            <span className="grow"><b>{c.customer}</b> <span className="small muted">· pedido #{c.displayId} · {dt(c.at)}</span>
              <span className="small" style={{ display: "block" }}>{c.reasons.join(" · ") || "sem motivo"}{c.comment ? ` — “${c.comment}”` : ""}</span>
              {c.creditGiven ? <span className="small up">crédito de {BRL(c.creditGiven)} enviado</span> : null}</span>
          </div>)}</div> : <Empty title="Sem comentários no período" />}
        </section>
        <section className="panel"><header><h3>Respostas da triagem</h3><p>{d.triage.skipped} pularam</p></header>
          {d.triage.answers.length ? <Bars rows={d.triage.answers.filter((a) => ANSWER[a.key]).map((a) => ({ label: ANSWER[a.key], value: a.value }))} format={(v) => String(v)} /> : <Empty title="Ninguém respondeu ainda" />}
        </section>
      </div>
    </>}
  </div>;
}

/* ---------------- configurações ---------------- */
function SettingsTab({ tab }: { tab: "triagem" | "pos" | "efeitos" }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const s = useLoad<EngagementSettings>("/admin/engagement/settings");
  const items = useLoad<{ id: string; name: string; active: boolean }[]>("/admin/items");
  const coupons = useLoad<(Coupon & { id: string })[]>("/admin/coupons");
  if (!s.data) return null;
  const v = s.data; const set = (x: Partial<EngagementSettings>) => s.setData({ ...v, ...x });
  const T = v.triage, P = v.postOrder, E = v.effects;
  const itemOpts = [{ value: "", label: "— regra da vitrine —" }, ...(items.data || []).filter((i) => i.active).map((i) => ({ value: i.id, label: i.name }))];
  const save = <Btn kind="primary" disabled={busy} onClick={() => run(() => api.put("/admin/engagement/settings", v), "Configuração salva. Já vale no cardápio.")}>Salvar</Btn>;

  if (tab === "triagem") return <div className="split">
    <section className="panel">
      <Toggle checked={T.enabled} onChange={(x) => set({ triage: { ...T, enabled: x } })} label="Perguntar para quem já comprou, ao abrir o cardápio" />
      <div className="grid2">
        <Field label="Perguntar de novo depois de (dias)" hint="Por cliente. Mais que isso cansa."><Num value={T.cooldownDays} onChange={(x) => set({ triage: { ...T, cooldownDays: x ?? 3 } })} /></Field>
        <Field label="A resposta vale por (horas)" hint="Quantas pessoas e a vontade mudam a cada pedido"><Num value={T.occasionHours} onChange={(x) => set({ triage: { ...T, occasionHours: x ?? 6 } })} /></Field>
      </div>
      <section className="panel"><header><h3>Perguntas (uma por visita, em rodízio)</h3></header>
        {T.questions.map((q, i) => <div key={q.kind} className="grid2" style={{ alignItems: "end" }}>
          <Field label={KIND_TXT[q.kind]}><Text value={q.title} onChange={(x) => set({ triage: { ...T, questions: T.questions.map((y, j) => (j === i ? { ...y, title: x } : y)) } })} /></Field>
          <Toggle checked={q.enabled} onChange={(x) => set({ triage: { ...T, questions: T.questions.map((y, j) => (j === i ? { ...y, enabled: x } : y)) } })} label={q.enabled ? "Ligada" : "Desligada"} />
        </div>)}
      </section>
      <section className="panel"><header><h3>O que aparece no topo depois da resposta</h3></header>
        <div className="grid3">
          {(["solo", "dupla", "galera"] as const).map((k) => <Field key={k} label={k === "solo" ? "Só eu" : k === "dupla" ? "A dois" : "Família ou galera"}><Select value={T.partyItems[k] || ""} onChange={(x) => set({ triage: { ...T, partyItems: { ...T.partyItems, [k]: x || undefined } } })} options={itemOpts} /></Field>)}
        </div>
        <Field label="Para quem quer algo novo"><Select value={T.noveltyItemId || ""} onChange={(x) => set({ triage: { ...T, noveltyItemId: x || undefined } })} options={itemOpts} /></Field>
      </section>
      <section className="panel"><header><h3>“O que você não come”</h3><p>Itens e sabores com essas palavras vão para o fim e ganham aviso</p></header>
        {T.avoidTags.map((t, i) => <div key={i} className="grid2">
          <Field label="Rótulo"><Text value={t.label} onChange={(x) => set({ triage: { ...T, avoidTags: T.avoidTags.map((y, j) => (j === i ? { ...y, label: x, id: y.id || x.toLowerCase() } : y)) } })} /></Field>
          <Field label="Palavras (separadas por vírgula)"><Text value={t.keywords.join(", ")} onChange={(x) => set({ triage: { ...T, avoidTags: T.avoidTags.map((y, j) => (j === i ? { ...y, keywords: x.split(",").map((w) => w.trim()).filter(Boolean) } : y)) } })} /></Field>
        </div>)}
        <div className="row"><Btn sm onClick={() => set({ triage: { ...T, avoidTags: [...T.avoidTags, { id: `tag${T.avoidTags.length + 1}`, label: "Novo", keywords: ["palavra"] }] } })}>Adicionar</Btn>{T.avoidTags.length > 0 && <Btn sm kind="danger" onClick={() => set({ triage: { ...T, avoidTags: T.avoidTags.slice(0, -1) } })}>Remover último</Btn>}</div>
      </section>
      <div>{save}</div>
    </section>
    <section className="panel" style={{ position: "sticky", top: 70 }}><header><h2>Como o cliente vê</h2></header>
      <p className="sentence">Ao abrir o cardápio, quem já pediu vê uma folha curta: <b>“{T.questions.find((q) => q.enabled)?.title || "—"}”</b> com 2 a 4 botões grandes e “Pular”. Um toque, e o cardápio se arruma na hora: o card do topo muda, as categorias reordenam e o que a pessoa evita vai para o fim.</p>
      <p className="small muted">Clientes novos nunca veem a triagem (para eles, a primeira tela é o pedido). Respostas ficam no perfil do cliente, no CRM.</p>
    </section>
  </div>;

  if (tab === "pos") return <div className="split">
    <section className="panel">
      <Toggle checked={P.enabled} onChange={(x) => set({ postOrder: { ...P, enabled: x } })} label="Pedir avaliação na tela do pedido (depois que sai para entrega)" />
      <Field label="Motivos para notas até 8 (separados por vírgula)"><Text value={P.reasonsLow.join(", ")} onChange={(x) => set({ postOrder: { ...P, reasonsLow: x.split(",").map((w) => w.trim()).filter(Boolean) } })} /></Field>
      <Field label="Motivos para 9 e 10"><Text value={P.reasonsHigh.join(", ")} onChange={(x) => set({ postOrder: { ...P, reasonsHigh: x.split(",").map((w) => w.trim()).filter(Boolean) } })} /></Field>
      <div className="grid2">
        <Field label="Crédito automático para nota até 6 (R$)" hint="0 desliga. Entra como cashback."><Num value={P.detractorCredit} onChange={(x) => set({ postOrder: { ...P, detractorCredit: x ?? 0 } })} /></Field>
        <Field label="Crédito vence em (dias)"><Num value={P.creditExpiresInDays} onChange={(x) => set({ postOrder: { ...P, creditExpiresInDays: x ?? 30 } })} /></Field>
        <Field label="WhatsApp que recebe o alerta" hint="DDI + DDD + número"><Text value={P.alertPhone} onChange={(x) => set({ postOrder: { ...P, alertPhone: x.replace(/\D/g, "") || undefined } })} /></Field>
        <Field label="Link de avaliação no Google" hint="Mostrado só para notas 9 e 10"><Text value={P.googleReviewUrl} onChange={(x) => set({ postOrder: { ...P, googleReviewUrl: x || undefined } })} /></Field>
      </div>
      <div>{save}</div>
    </section>
    <section className="panel" style={{ position: "sticky", top: 70 }}><header><h2>O que acontece com cada nota</h2></header>
      <div className="list">
        <div className="li"><Pill tone="bad">0–6</Pill><span className="grow small">Recebe {BRL(P.detractorCredit)} de crédito na hora, a loja recebe o alerta{P.alertPhone ? ` em +${P.alertPhone}` : " (configure o WhatsApp)"} e o evento <code>feedback.detractor</code> vai para os webhooks.</span></div>
        <div className="li"><Pill>7–8</Pill><span className="grow small">Perguntamos o que faltou para o 10 e guardamos o “quero provar”.</span></div>
        <div className="li"><Pill tone="good">9–10</Pill><span className="grow small">{P.googleReviewUrl ? "Convidamos a avaliar no Google." : "Agradecemos (adicione o link do Google para pedir a avaliação)."}</span></div>
      </div>
      <p className="small muted">A automação “Pesquisa 1h após a entrega” continua mandando o link no WhatsApp para quem fechou o app antes.</p>
    </section>
  </div>;

  return <div className="split">
    <section className="panel">
      <p className="small muted">Regra de dose: no máximo um efeito a cada 8 segundos e um cupom por visita (o pop-up ou o “antes de ir”, nunca os dois). Quem ativou “reduzir movimento” no celular vê contornos fixos no lugar do brilho.</p>
      <Toggle checked={E.vibrate} onChange={(x) => set({ effects: { ...E, vibrate: x } })} label="Vibrar em momentos-chave (Android; no iPhone o navegador não permite)" />
      <Toggle checked={E.glowCta} onChange={(x) => set({ effects: { ...E, glowCta: x } })} label="Brilho no botão Adicionar quando a montagem fica pronta" />
      <Toggle checked={E.statusBuzz} onChange={(x) => set({ effects: { ...E, statusBuzz: x } })} label="Vibrar quando o pedido muda de status" />
      <div className="grid3">
        <Field label="Brilho na sugestão “1 toque” após (s)" hint="0 desliga"><Num value={E.glowPresetSeconds} onChange={(x) => set({ effects: { ...E, glowPresetSeconds: x ?? 0 } })} /></Field>
        <Field label="Empurrão do frete grátis quando faltar até (R$)" hint="0 desliga"><Num value={E.freeShippingNudge} onChange={(x) => set({ effects: { ...E, freeShippingNudge: x ?? 0 } })} /></Field>
        <Field label="“Sua sacola continua aqui” ao voltar após (s)" hint="0 desliga"><Num value={E.returnAfterSeconds} onChange={(x) => set({ effects: { ...E, returnAfterSeconds: x ?? 0 } })} /></Field>
      </div>
      <section className="panel"><header><h3>Antes de ir</h3><p>Aparece uma vez por visita: no computador quando o mouse vai fechar a aba; no celular no botão voltar; e quando a pessoa volta ao app com a sacola cheia</p></header>
        <Toggle checked={E.exitIntent.enabled} onChange={(x) => set({ effects: { ...E, exitIntent: { ...E.exitIntent, enabled: x } } })} label="Ligado" />
        <div className="grid2">
          <Field label="Título"><Text value={E.exitIntent.title} onChange={(x) => set({ effects: { ...E, exitIntent: { ...E.exitIntent, title: x } } })} /></Field>
          <Field label="Cupom oferecido" hint="Sem cupom, só lembra que a sacola fica guardada"><Select value={E.exitIntent.couponId || ""} onChange={(x) => set({ effects: { ...E, exitIntent: { ...E.exitIntent, couponId: x || undefined } } })} options={[{ value: "", label: "Sem cupom" }, ...(coupons.data || []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]} /></Field>
          <Field label="Texto" wide><Text value={E.exitIntent.text} onChange={(x) => set({ effects: { ...E, exitIntent: { ...E.exitIntent, text: x } } })} /></Field>
        </div>
      </section>
      <div>{save}</div>
    </section>
    <section className="panel" style={{ position: "sticky", top: 70 }}><header><h2>Onde cada efeito aparece</h2></header>
      <div className="list">
        {[["Montagem", "Botão brilha 3 vezes quando completa; a sugestão “1 toque” brilha se a pessoa travar."], ["Sacola", "A barra do frete pulsa quando falta pouco; a barra da sacola brilha na volta ao app."], ["Saída", "“Antes de ir” com a sacola guardada e, se houver, o cupom."], ["Pedido", "Vibra a cada status e abre a avaliação quando sai para entrega."]].map(([a, b]) => <div className="li" key={a}><b style={{ minWidth: 80 }}>{a}</b><span className="grow small">{b}</span></div>)}
      </div>
    </section>
  </div>;
}

/* ---------------- primeira visita ---------------- */
type FvAdmin = {
  source: "personas" | "playbook"; questions: FvQuestion[]; customers: number; ticketRange?: [number, number];
  personas: { id: string; name: string; share: number; customers: number; avgTicket: number; top?: string }[];
  report: { shown: number; answered: number; skipped: number; leads: number; coupons: number; converted: number };
};

function FirstVisitTab() {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const s = useLoad<EngagementSettings>("/admin/engagement/settings");
  const [days, setDays] = useState("30");
  const fa = useLoad<FvAdmin>(`/admin/engagement/first-visit?days=${days}`, [days]);
  const items = useLoad<{ id: string; name: string; active: boolean }[]>("/admin/items");
  const cats = useLoad<(Category & { id: string })[]>("/admin/categories");
  const coupons = useLoad<(Coupon & { id: string })[]>("/admin/coupons");
  if (!s.data) return null;
  const v = s.data; const F = v.firstVisit; const camps = v.campaigns || [];
  const setF = (x: Partial<typeof F>) => s.setData({ ...v, firstVisit: { ...F, ...x } });
  const setC = (list: CampaignTarget[]) => s.setData({ ...v, campaigns: list });
  const save = <Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/engagement/settings", s.data), "Salvo. Já vale no cardápio.")) fa.reload(); }}>Salvar</Btn>;
  const targetOpts = [...(cats.data || []).filter((c) => c.visible).map((c) => ({ value: `category:${c.id}`, label: `Categoria · ${c.name}` })), ...(items.data || []).filter((i) => i.active).map((i) => ({ value: `item:${i.id}`, label: i.name }))];
  const tval = (t: CampaignTarget["target"]) => (t.kind === "item" ? `item:${t.itemId}` : `category:${t.categoryId}`);
  const tparse = (x: string): CampaignTarget["target"] => { const [k, id] = x.split(":"); return k === "item" ? { kind: "item", itemId: id } : { kind: "category", categoryId: id }; };
  const r = fa.data?.report; const rate = (a: number, b: number) => (b ? pct((a / b) * 100) : "—");
  const setQ = (i: number, q: Partial<FvQuestion>) => setF({ playbook: F.playbook.map((x, j) => (j === i ? { ...x, ...q } : x)) });

  return <div className="stack">
    <div className="grid4">
      <Tile k="Triagens abertas" v={r ? r.shown : "—"} d={<span className="muted">últimos {days} dias</span>} />
      <Tile k="Responderam" v={r ? rate(r.answered, r.shown) : "—"} d={<span className="muted">{r?.answered ?? 0} visitantes · {r?.skipped ?? 0} pularam</span>} />
      <Tile k="Deixaram contato" v={r ? rate(r.leads, r.answered) : "—"} d={<span className="muted">{r?.leads ?? 0} leads no CRM · {r?.coupons ?? 0} cupons liberados</span>} />
      <Tile k="Viraram pedido" v={r ? rate(r.converted, r.answered) : "—"} d={<span className="muted">{r?.converted ?? 0} de quem respondeu, na mesma visita</span>} />
    </div>
    <div className="row"><span className="small muted">Período</span><div style={{ width: 140 }}><Select value={days} onChange={setDays} options={[{ value: "7", label: "7 dias" }, { value: "30", label: "30 dias" }, { value: "90", label: "90 dias" }]} /></div></div>
    <div className="split">
      <section className="panel">
        <Toggle checked={F.enabled} onChange={(x) => setF({ enabled: x })} label="Triagem para quem entra pela primeira vez" />
        <div className="grid2">
          <Field label="Como o cupom aparece" hint={F.mode === "gate" ? "O cupom aparece primeiro e só libera com respostas + celular + e-mail" : "Responde e ganha; o contato é opcional"}><Select value={F.mode} onChange={(x) => setF({ mode: x })} options={[{ value: "reward", label: "Recompensa" }, { value: "gate", label: "Portão" }]} /></Field>
          <Field label="Cupom de boas-vindas"><Select value={F.couponId || ""} onChange={(x) => setF({ couponId: x || undefined })} options={[{ value: "", label: "Sem cupom" }, ...(coupons.data || []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]} /></Field>
          <Field label="De onde vêm as perguntas" hint={fa.data ? (fa.data.source === "personas" ? `Hoje: personas de ${fa.data.customers} clientes da base` : "Hoje: roteiro do segmento (base pequena ou desligada)") : undefined}><Select value={F.source} onChange={(x) => setF({ source: x })} options={[{ value: "auto", label: "Personas da base" }, { value: "playbook", label: "Só o roteiro" }]} /></Field>
          <Field label="Perguntas por visita"><Num value={F.maxQuestions} onChange={(x) => setF({ maxQuestions: Math.max(1, Math.min(3, x ?? 3)) })} /></Field>
          <Field label="Quem vem de campanha vê a triagem após (s)" hint="0 = nunca: quem clicou no anúncio vai direto ao produto"><Num value={F.afterCampaignSeconds} onChange={(x) => setF({ afterCampaignSeconds: x ?? 0 })} /></Field>
          <Field label="Roteiro do segmento"><Select value={F.segment} onChange={(x) => setF({ segment: x })} options={[{ value: "pizza", label: "Pizzaria" }, { value: "generico", label: "Genérico" }]} /></Field>
        </div>
        <section className="panel"><header><h3>Roteiro (sem base, ou quando a base não separa bem)</h3><p>O que já funciona no segmento. Os títulos e as opções valem também quando as perguntas vêm das personas.</p></header>
          {F.playbook.map((q, i) => <div key={q.id} className="stack" style={{ gap: 8, borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 12 : 0 }}>
            <div className="grid2" style={{ alignItems: "end" }}>
              <Field label={q.dim === "party" ? "Pessoas / tamanho" : q.dim === "deal" ? "Oferta pronta ou montar" : "Doce"}><Text value={q.title} onChange={(x) => setQ(i, { title: x })} /></Field>
              <Toggle checked={q.enabled !== false} onChange={(x) => setQ(i, { enabled: x })} label={q.enabled !== false ? "Ligada" : "Desligada"} />
            </div>
            <div className="grid3">{q.options.map((o, j) => <Field key={o.id} label={`Opção ${j + 1}`}><Text value={o.label} onChange={(x) => setQ(i, { options: q.options.map((y, k) => (k === j ? { ...y, label: x } : y)) })} /></Field>)}</div>
          </div>)}
          <div className="row"><Btn sm onClick={() => setF({ playbook: PLAYBOOKS[F.segment] })}>Voltar ao roteiro padrão do segmento</Btn></div>
        </section>
        <section className="panel"><header><h3>Topo por campanha</h3><p>Quem chega pelo anúncio vê primeiro o produto ou a categoria do criativo. Use os mesmos valores do link (utm_source, utm_campaign, utm_content).</p></header>
          {camps.map((c, i) => <div key={c.id} className="stack" style={{ gap: 8, borderTop: i ? "1px solid var(--line)" : undefined, paddingTop: i ? 12 : 0 }}>
            <div className="grid3">
              <Field label="Origem (utm_source)"><Text value={c.source} placeholder="instagram" onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, source: x || undefined } : y)))} /></Field>
              <Field label="Campanha (utm_campaign)"><Text value={c.campaign} placeholder="qualquer" onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, campaign: x || undefined } : y)))} /></Field>
              <Field label="Criativo (utm_content)"><Text value={c.content} placeholder="qualquer" onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, content: x || undefined } : y)))} /></Field>
            </div>
            <div className="grid3">
              <Field label="Mostra no topo"><Select value={tval(c.target)} onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, target: tparse(x) } : y)))} options={targetOpts.length ? targetOpts : [{ value: tval(c.target), label: "—" }]} /></Field>
              <Field label="Chamada"><Text value={c.kicker} onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, kicker: x } : y)))} /></Field>
              <Field label="Linha de apoio"><Text value={c.sub} onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, sub: x || undefined } : y)))} /></Field>
            </div>
            <div className="row"><Toggle checked={c.active} onChange={(x) => setC(camps.map((y, j) => (j === i ? { ...y, active: x } : y)))} label="Ativa" /><Btn sm kind="danger" onClick={() => setC(camps.filter((_, j) => j !== i))}>Remover</Btn></div>
          </div>)}
          <div className="row"><Btn sm onClick={() => setC([...camps, { id: `cp_${Date.now().toString(36)}`, active: true, source: "instagram", target: targetOpts[0] ? tparse(targetOpts[0].value) : { kind: "category", categoryId: "" }, kicker: "Você veio pelo anúncio" }])}>Adicionar campanha</Btn></div>
        </section>
        <div>{save}</div>
      </section>
      <section className="panel" style={{ position: "sticky", top: 70 }}>
        <header><h2>Personas da base</h2><p>{fa.data?.customers ? `${fa.data.customers} clientes, agrupados por como pedem` : "A base ainda não tem clientes suficientes (30+). Vale o roteiro."}</p></header>
        {fa.data?.personas.length ? <div className="list">{fa.data.personas.map((p) => <div key={p.id} className="li" style={{ alignItems: "flex-start" }}>
          <Pill tone="accent">{pct(p.share * 100)}</Pill>
          <span className="grow"><b>{p.name}</b><span className="small muted" style={{ display: "block" }}>{p.customers} clientes · ticket médio {BRL(p.avgTicket)}</span>{p.top && <span className="small" style={{ display: "block" }}>Mais pede: {p.top}</span>}</span>
        </div>)}</div> : <Empty title="Sem personas ainda" />}
        <header style={{ marginTop: 12 }}><h3>Perguntas da vez</h3><p>{fa.data?.source === "personas" ? "Escolhidas pelo que mais separa as personas" : "Do roteiro do segmento"}</p></header>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{(fa.data?.questions || []).map((q) => <li key={q.id}>{q.title} <span className="muted">({q.options.map((o) => o.label).join(" · ")})</span></li>)}</ol>
        <p className="small muted">Ninguém cria senha aqui: o celular é confirmado por código só na hora de pedir, e a senha só aparece para quem paga online.</p>
      </section>
    </div>
  </div>;
}
