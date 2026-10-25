import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Order, OrderStatus } from "@cw/core";
import { BRL, Btn, Drawer, Empty, Field, Num, Pill, Select, Tabs, Text, Toggle, dt, errMsg, useAction, useAdmin, useLoad } from "../ui";

export const STATUS: Record<OrderStatus, { label: string; tone?: "good" | "warn" | "bad" | "accent" }> = {
  awaiting_payment: { label: "Aguardando pagamento", tone: "warn" }, payment_failed: { label: "Pagamento não concluído", tone: "bad" },
  created: { label: "Recebido", tone: "warn" }, sent_to_pos: { label: "No PDV", tone: "accent" }, pos_error: { label: "Erro no PDV", tone: "bad" }, confirmed: { label: "Confirmado", tone: "accent" },
  ready: { label: "Pronto", tone: "accent" }, dispatched: { label: "Saiu para entrega", tone: "accent" }, concluded: { label: "Entregue", tone: "good" }, cancelled: { label: "Cancelado", tone: "bad" },
};
const PAY: Record<string, string> = { CARD_ONLINE: "Cartão online", PIX_ONLINE: "Pix", CARD_ON_DELIVERY: "Cartão na entrega", CREDIT_ON_DELIVERY: "Crédito", DEBIT_ON_DELIVERY: "Débito", VR_VA: "VR/VA", CASH: "Dinheiro" };

export function OrdersPage() {
  const [tab, setTab] = useState<"gestor" | "historico">(() => { try { return (localStorage.getItem("cw:orders-tab") as "historico") || "gestor"; } catch { return "gestor"; } });
  const pick = (t: "gestor" | "historico") => { setTab(t); try { localStorage.setItem("cw:orders-tab", t); } catch { /* sem armazenamento */ } };
  return <>
    <div className="pagehead"><div><h1>Pedidos</h1><p>{tab === "gestor" ? "Gestor ao vivo: aceite, prepare e despache sem PDV. Atualiza sozinho a cada poucos segundos e toca quando chega pedido." : "Todos os pedidos do cardápio próprio. Com a SAIPOS ligada, eles entram no PDV na hora e os status voltam pelo webhook."}</p></div></div>
    <Tabs value={tab} onChange={pick} tabs={[{ value: "gestor", label: "Gestor ao vivo" }, { value: "historico", label: "Histórico" }]} />
    {tab === "gestor" ? <LiveBoard /> : <History />}
  </>;
}

/* ============================== gestor ao vivo ============================== */

type Column = "novos" | "agendados" | "em_preparo" | "prontos" | "em_rota" | "concluidos";
type Card = {
  id: string; displayId: string; createdAt: string; scheduledFor?: string; status: OrderStatus; column: Column;
  customer: { name?: string; phone?: string; orders: number }; isFirstOrder: boolean; mode: "DELIVERY" | "TAKEOUT"; address?: string; addressFull?: string;
  lines: { qty: number; name: string; choices: { qty: number; name: string; free?: boolean; fraction?: string; extra?: number }[]; notes?: string; total: number }[];
  subtotal: number; discount: number; deliveryFee: number; fees: { label: string; amount: number }[]; cashbackUsed: number; total: number;
  payment: { code: string; changeFor?: number; online?: string; paid: boolean; line: string }; notes?: string;
  phaseStartedAt: string; minutesInStatus: number; slaMinutes?: number; late: boolean; dueAt?: string; posError?: string; source?: string;
};
type Settings = { mode: "manager" | "pdv"; autoAccept: boolean; prepMinutes: number; deliveryMinutes: number; lateAfterMinutes: number; sound: boolean; printOnAccept: boolean; rejectReasons: string[] };
type Board = { unchanged: false; cursor: string; now: string; settings: Settings; columns: Record<Column, Card[]>; counts: Record<Column, number>; awaitingPayment: number; stores: { id: string; name: string; status: string; pausedReason?: string }[] };
type Poll = Board | { unchanged: true; cursor: string; now: string };

const COLS: { id: Column; label: string; empty: string }[] = [
  { id: "novos", label: "Novos", empty: "Nenhum pedido esperando aceite" },
  { id: "agendados", label: "Agendados", empty: "Sem encomendas para depois" },
  { id: "em_preparo", label: "Em preparo", empty: "Cozinha livre" },
  { id: "prontos", label: "Prontos", empty: "Nada esperando entregador ou retirada" },
  { id: "em_rota", label: "Em rota", empty: "Nenhum pedido na rua" },
  { id: "concluidos", label: "Concluídos hoje", empty: "Ainda nada hoje" },
];

const ls = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };

/** Bipe de pedido novo com WebAudio (precisa de um clique na página antes, regra dos navegadores). */
function useAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const timer = useRef<number | null>(null);
  const [ringing, setRinging] = useState(false);
  const [locked, setLocked] = useState(false);
  const unlock = useCallback(() => {
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctxRef.current ||= new AC();
      if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
      setLocked(ctxRef.current.state !== "running");
    } catch { /* sem áudio */ }
  }, []);
  useEffect(() => { const f = () => unlock(); window.addEventListener("pointerdown", f); window.addEventListener("keydown", f); return () => { window.removeEventListener("pointerdown", f); window.removeEventListener("keydown", f); }; }, [unlock]);
  const beep = useCallback(() => {
    const ac = ctxRef.current; if (!ac || ac.state !== "running") { setLocked(true); return; }
    const t0 = ac.currentTime;
    for (const [i, f] of [880, 1175, 880].entries()) {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
      const s = t0 + i * 0.18; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.start(s); o.stop(s + 0.17);
    }
  }, []);
  const start = useCallback(() => { if (timer.current) return; setRinging(true); beep(); timer.current = window.setInterval(beep, 2500); }, [beep]);
  const stop = useCallback(() => { if (timer.current) window.clearInterval(timer.current); timer.current = null; setRinging(false); }, []);
  useEffect(() => stop, [stop]);
  return { start, stop, ringing, locked, unlock };
}

/** Pisca o título da aba enquanto houver pedido novo sem visto. */
function useTitleBlink(on: boolean, text: string) {
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    const orig = document.title; let flip = false;
    const t = window.setInterval(() => { flip = !flip; document.title = flip ? text : orig; }, 1000);
    return () => { window.clearInterval(t); document.title = orig; };
  }, [on, text]);
}

function LiveBoard() {
  const { api, toast, storeId } = useAdmin(); const { run, busy } = useAction();
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [skew, setSkew] = useState(0); // relógio do servidor − relógio local
  const [tick, setTick] = useState(0);
  const [muted, setMuted] = useState(() => ls.get("cw:kb-muted") === "1");
  const [unseen, setUnseen] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Card | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileCol, setMobileCol] = useState<Column>("novos");
  const cursor = useRef(""); const known = useRef<Set<string> | null>(null); const printRef = useRef<HTMLIFrameElement>(null);
  const alarm = useAlarm();
  useTitleBlink(unseen.length > 0, `(${unseen.length}) Pedido novo!`);

  const load = useCallback(async (force = false) => {
    try {
      const q = new URLSearchParams(); if (storeId) q.set("storeId", storeId); if (cursor.current && !force) q.set("cursor", cursor.current);
      const r = await api.get<Poll>(`/admin/orders/board?${q}`);
      setSkew(+new Date(r.now) - Date.now()); setErr("");
      if (r.unchanged) return;
      cursor.current = r.cursor; setB(r);
      const ids = r.columns.novos.map((c) => c.id).concat(r.columns.agendados.filter((c) => c.status === "created").map((c) => c.id));
      if (known.current) {
        const fresh = ids.filter((id) => !known.current!.has(id));
        if (fresh.length) { setUnseen((u) => [...new Set([...u, ...fresh])]); toast(fresh.length === 1 ? "Pedido novo chegou" : `${fresh.length} pedidos novos`); }
      }
      known.current = new Set([...(known.current || []), ...ids]);
      setUnseen((u) => u.filter((id) => ids.includes(id)));
    } catch (e) { setErr(errMsg(e)); }
  }, [api, storeId, toast]);

  // sondagem: 4 s com a aba visível, 20 s escondida
  useEffect(() => {
    let alive = true; let t: number;
    const loop = async () => { await load(); if (!alive) return; t = window.setTimeout(loop, typeof document !== "undefined" && document.hidden ? 20000 : 4000); };
    loop();
    const vis = () => { if (!document.hidden) { window.clearTimeout(t); loop(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; window.clearTimeout(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  useEffect(() => { const t = window.setInterval(() => setTick((x) => x + 1), 15000); return () => window.clearInterval(t); }, []);
  useEffect(() => { if (unseen.length && b?.settings.sound && !muted) alarm.start(); else alarm.stop(); }, [unseen.length, b?.settings.sound, muted]); // eslint-disable-line

  const ack = () => { setUnseen([]); alarm.stop(); };
  const nowMs = Date.now() + skew; void tick;
  const after = async (fn: () => Promise<unknown>, ok: string) => { const r = await run(fn, ok); if (r) { ack(); cursor.current = ""; await load(true); } return r; };
  const printTicket = (c: Card) => {
    const f = printRef.current; if (!f) return;
    const doc = f.contentDocument; if (!doc) return;
    doc.open(); doc.write(ticketHtml(c, b?.stores.find((s) => s.id === storeId)?.name)); doc.close();
    try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { toast("Não deu para abrir a impressão", true); }
  };
  const accept = async (c: Card, prep?: number) => {
    const r = await after(() => api.post(`/admin/orders/${c.id}/accept`, prep ? { prepMinutes: prep } : {}), `Pedido #${c.displayId} aceito`);
    if (r && b?.settings.printOnAccept) printTicket(c);
  };
  const move = (c: Card, status: OrderStatus, ok: string) => after(() => api.post(`/admin/orders/${c.id}/status`, { status }), ok);
  const store = b?.stores.find((s) => s.id === storeId) || b?.stores[0];

  if (!b) return err ? <Empty title="Não foi possível carregar o gestor">{err}</Empty> : <Empty title="Carregando pedidos…" />;
  return <div className="kb-wrap">
    <div className="kb-bar">
      <div className="row">
        {store && (store.status === "paused" ? <Pill tone="bad">Loja pausada{store.pausedReason ? ` · ${store.pausedReason}` : ""}</Pill> : <Pill tone="good">Recebendo pedidos</Pill>)}
        {b.settings.autoAccept && <Pill tone="accent">aceite automático</Pill>}
        {b.awaitingPayment > 0 && <span className="small muted">{b.awaitingPayment} aguardando pagamento online</span>}
        {err && <span className="small down">Sem conexão: {err}</span>}
      </div>
      <div className="row">
        {unseen.length > 0 && <Btn sm kind="primary" id="kb-ack" onClick={ack}>Ciente · {unseen.length} novo{unseen.length > 1 ? "s" : ""}</Btn>}
        {alarm.locked && !muted && <Btn sm onClick={alarm.unlock} title="O navegador só toca som depois de um clique">Ativar som</Btn>}
        <Btn sm kind="ghost" id="kb-mute" onClick={() => { const v = !muted; setMuted(v); ls.set("cw:kb-muted", v ? "1" : "0"); }}>{muted ? "Som desligado" : "Som ligado"}</Btn>
        {store && <Btn sm id="kb-pause" disabled={busy} onClick={() => after(() => api.post(`/admin/stores/${store.id}/pause`, { paused: store.status !== "paused" }), store.status === "paused" ? "Loja reaberta" : "Loja pausada")}>{store.status === "paused" ? "Reabrir loja" : "Pausar loja"}</Btn>}
        <Btn sm id="kb-settings" onClick={() => setShowSettings(true)}>Configurar</Btn>
      </div>
    </div>
    <div className="kb-colnav" role="tablist" aria-label="Colunas">{COLS.map((c) => <button key={c.id} role="tab" aria-selected={mobileCol === c.id} onClick={() => { setMobileCol(c.id); document.getElementById(`kb-col-${c.id}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }); }}>{c.label} <span className="num">{b.counts[c.id]}</span></button>)}</div>
    <div className="kb-board">
      {COLS.map((col) => <section key={col.id} id={`kb-col-${col.id}`} className={`kb-col kb-${col.id}`} aria-label={col.label}>
        <header><h3>{col.label}</h3><span className="kb-count num">{b.counts[col.id]}</span></header>
        <div className="kb-cards">
          {b.columns[col.id].length ? b.columns[col.id].map((c) => <OrderCard key={c.id} c={c} nowMs={nowMs} isNew={unseen.includes(c.id)} busy={busy} settings={b.settings}
            onOpen={() => setOpen(c.id)} onAccept={(p) => accept(c, p)} onReject={() => setRejecting(c)} onMove={(s, ok) => move(c, s, ok)} onPrint={() => printTicket(c)} />)
            : <p className="kb-empty">{col.empty}</p>}
        </div>
      </section>)}
    </div>
    <iframe ref={printRef} id="kb-print-frame" title="Comanda" className="kb-print" aria-hidden="true" tabIndex={-1} />
    {rejecting && <RejectDialog card={rejecting} reasons={b.settings.rejectReasons} onClose={() => setRejecting(null)} onReject={async (reason) => { if (await after(() => api.post(`/admin/orders/${rejecting.id}/reject`, { reason }), `Pedido #${rejecting.displayId} recusado`)) setRejecting(null); }} />}
    {showSettings && <SettingsDrawer value={b.settings} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); cursor.current = ""; load(true); }} />}
    {open && <OrderDrawer id={open} onClose={() => { setOpen(null); cursor.current = ""; load(true); }} />}
  </div>;
}

const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => { const d = new Date(iso); const today = new Date(); const same = d.toDateString() === today.toDateString(); const tmr = new Date(+today + 864e5).toDateString() === d.toDateString(); return `${same ? "hoje" : tmr ? "amanhã" : d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} às ${hhmm(iso)}`; };
const waLink = (phone?: string, text?: string) => (phone ? `https://wa.me/${phone.replace(/\D/g, "").replace(/^(?!55)/, "55")}${text ? `?text=${encodeURIComponent(text)}` : ""}` : undefined);

function OrderCard(p: { c: Card; nowMs: number; isNew: boolean; busy: boolean; settings: Settings; onOpen: () => void; onAccept: (prep?: number) => void; onReject: () => void; onMove: (s: OrderStatus, ok: string) => void; onPrint: () => void }) {
  const { c } = p;
  const [prep, setPrep] = useState<number>(p.settings.prepMinutes);
  const mins = Math.max(0, Math.floor((p.nowMs - +new Date(c.phaseStartedAt)) / 60000));
  const ratio = c.slaMinutes ? mins / c.slaMinutes : 0;
  const tone = c.column === "concluidos" || c.column === "agendados" ? "" : ratio >= 1 ? "late" : ratio >= 0.7 ? "warn" : "ok";
  const pending = c.status === "created" || c.status === "pos_error";
  const action = c.column === "novos" || (c.column === "agendados" && pending) ? null
    : c.column === "em_preparo" ? { label: "Pronto", s: "ready" as const, ok: `#${c.displayId} pronto` }
    : c.column === "prontos" ? (c.mode === "DELIVERY" ? { label: "Saiu para entrega", s: "dispatched" as const, ok: `#${c.displayId} saiu para entrega` } : { label: "Retirado", s: "concluded" as const, ok: `#${c.displayId} retirado` })
    : c.column === "em_rota" ? { label: "Entregue", s: "concluded" as const, ok: `#${c.displayId} entregue` } : null;
  const first = (c.customer.name || "").split(" ")[0];
  return <article className={`kb-card ${tone} ${p.isNew ? "is-new" : ""} ${c.status === "cancelled" ? "is-cancel" : ""}`} data-order={c.displayId} data-status={c.status}>
    <header>
      <button className="kb-id" onClick={p.onOpen} title="Ver detalhes">#{c.displayId}</button>
      <span className="kb-mode">{c.mode === "DELIVERY" ? "Entrega" : "Retirada"}</span>
      {c.column === "agendados" && c.scheduledFor ? <span className="kb-time sched">{when(c.scheduledFor)}</span>
        : c.column === "concluidos" ? <span className="kb-time">{c.status === "cancelled" ? "cancelado" : "entregue"} {hhmm(c.phaseStartedAt)}</span>
        : <span className={`kb-time ${tone}`} title={c.slaMinutes ? `Esperado: ${c.slaMinutes} min nesta etapa` : undefined}>{fmtMin(mins)}</span>}
    </header>
    <div className="kb-who">
      <b>{c.customer.name || "Cliente"}</b>
      {c.isFirstOrder ? <Pill tone="accent">1º pedido</Pill> : c.customer.orders > 1 ? <span className="small muted">{c.customer.orders}º pedido</span> : null}
    </div>
    {c.address && c.mode === "DELIVERY" && <p className="kb-addr small">{c.address}</p>}
    {c.scheduledFor && c.column !== "agendados" && <p className="small"><Pill tone="warn">agendado {when(c.scheduledFor)}</Pill></p>}
    <ul className="kb-lines">{c.lines.map((l, i) => <li key={i}><b>{l.qty}×</b> {l.name}
      {l.choices.length > 0 && <span className="kb-choices">{l.choices.map((ch, j) => <span key={j}>{ch.qty > 1 ? `${ch.qty}× ` : ""}{ch.fraction ? `${ch.fraction} ` : ""}{ch.name}{ch.free ? <em className="kb-free"> grátis</em> : null}</span>)}</span>}
      {l.notes && <span className="kb-note">obs: {l.notes}</span>}</li>)}</ul>
    {c.notes && <p className="kb-note">Pedido: {c.notes}</p>}
    {c.posError && <p className="small down">PDV: {c.posError}</p>}
    <div className="kb-pay"><span>{c.payment.line}</span><b className="num">{BRL(c.total)}</b></div>
    {c.column !== "concluidos" && <footer>
      {pending ? <>
        <Btn sm kind="primary" disabled={p.busy} onClick={() => p.onAccept(prep !== p.settings.prepMinutes ? prep : undefined)}>Aceitar</Btn>
        <select aria-label="Tempo de preparo" className="kb-prep" value={prep} onChange={(e) => setPrep(Number(e.target.value))}>{[...new Set([15, 20, p.settings.prepMinutes, 30, 40, 50, 60])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}</select>
        <Btn sm kind="danger" disabled={p.busy} onClick={p.onReject}>Recusar</Btn>
      </> : action ? <Btn sm kind="primary" disabled={p.busy} onClick={() => p.onMove(action.s, action.ok)}>{action.label}</Btn> : null}
      <span className="kb-tools">
        <Btn sm kind="ghost" onClick={p.onPrint} title="Imprimir comanda">Imprimir</Btn>
        {c.customer.phone && <a className="btn sm ghost" href={waLink(c.customer.phone, `Oi ${first}! Sobre o seu pedido #${c.displayId}:`)} target="_blank" rel="noreferrer" title="Falar com o cliente no WhatsApp">WhatsApp</a>}
      </span>
    </footer>}
  </article>;
}

function RejectDialog(p: { card: Card; reasons: string[]; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState(p.reasons[0] || ""); const [other, setOther] = useState("");
  const final = reason === "__outro" ? other.trim() : reason;
  return <Drawer title={`Recusar pedido #${p.card.displayId}`} onClose={p.onClose} footer={<><Btn onClick={p.onClose}>Voltar</Btn><Btn kind="danger" id="kb-reject-confirm" disabled={final.length < 2} onClick={() => p.onReject(final)}>Recusar pedido</Btn></>}>
    <p className="small muted">O cliente é avisado{p.card.payment.paid ? " e o pagamento online é estornado automaticamente" : ""}. O cashback usado volta para a carteira.</p>
    <div className="kb-reasons" role="radiogroup">{[...p.reasons, "__outro"].map((r) => <label key={r} className="kb-reason"><input type="radio" name="kb-reason" checked={reason === r} onChange={() => setReason(r)} /> {r === "__outro" ? "Outro motivo" : r}</label>)}</div>
    {reason === "__outro" && <Field label="Motivo"><Text value={other} onChange={setOther} placeholder="Escreva o motivo" /></Field>}
  </Drawer>;
}

function SettingsDrawer(p: { value: Settings; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const [s, setS] = useState(p.value); const [reasons, setReasons] = useState(p.value.rejectReasons.join("\n"));
  const set = (x: Partial<Settings>) => setS({ ...s, ...x });
  const save = async () => { if (await run(() => api.put("/admin/settings/orders", { ...s, rejectReasons: reasons.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 12) }), "Gestor configurado")) p.onSaved(); };
  return <Drawer title="Configurar o gestor de pedidos" onClose={p.onClose} footer={<><span /><Btn kind="primary" disabled={busy} onClick={save}>Salvar</Btn></>}>
    <Field label="Quem comanda a cozinha" hint="Com PDV, o pedido entra na SAIPOS e os status voltam sozinhos; o gestor só acompanha.">
      <Select value={s.mode} onChange={(v) => set({ mode: v })} options={[{ value: "manager", label: "Este gestor (sem PDV)" }, { value: "pdv", label: "PDV (SAIPOS)" }]} />
    </Field>
    <Toggle checked={s.autoAccept} onChange={(v) => set({ autoAccept: v })} label="Aceitar pedidos automaticamente (entram direto em preparo)" />
    <div className="grid3">
      <Field label="Preparo (min)"><Num value={s.prepMinutes} onChange={(v) => set({ prepMinutes: v ?? 25 })} /></Field>
      <Field label="Entrega (min)"><Num value={s.deliveryMinutes} onChange={(v) => set({ deliveryMinutes: v ?? 30 })} /></Field>
      <Field label="Alerta de atraso (min)" hint="Tempo máximo esperando aceite ou retirada"><Num value={s.lateAfterMinutes} onChange={(v) => set({ lateAfterMinutes: v ?? 10 })} /></Field>
    </div>
    <div className="row"><Toggle checked={s.sound} onChange={(v) => set({ sound: v })} label="Tocar som quando chegar pedido" /><Toggle checked={s.printOnAccept} onChange={(v) => set({ printOnAccept: v })} label="Imprimir comanda ao aceitar" /></div>
    <Field label="Motivos de recusa" hint="Um por linha"><textarea value={reasons} onChange={(e) => setReasons(e.target.value)} rows={6} /></Field>
  </Drawer>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
/** Comanda de 80 mm: itens, escolhas (com "grátis" da cota), observações, endereço, pagamento e total. */
export function ticketHtml(c: Card, storeName?: string) {
  const lines = c.lines.map((l) => `<div class="it"><div class="row"><b>${l.qty}× ${esc(l.name)}</b><span>${BRL(l.total)}</span></div>${l.choices.map((ch) => `<div class="ch">• ${ch.qty > 1 ? ch.qty + "× " : ""}${ch.fraction ? esc(ch.fraction) + " " : ""}${esc(ch.name)}${ch.free ? " (grátis)" : ch.extra ? ` +${BRL(ch.extra)}` : ""}</div>`).join("")}${l.notes ? `<div class="ob">OBS: ${esc(l.notes)}</div>` : ""}</div>`).join("");
  const tot = [["Itens", c.subtotal], ...(c.discount ? [["Desconto", -c.discount]] : []), ...(c.cashbackUsed ? [["Cashback", -c.cashbackUsed]] : []), ...(c.mode === "DELIVERY" ? [["Entrega", c.deliveryFee]] : []), ...c.fees.map((f) => [f.label, f.amount])] as [string, number][];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pedido #${esc(c.displayId)}</title><style>
@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;width:74mm;margin:0;color:#000}
h1{font-size:20px;margin:0 0 2px;text-align:center}.c{text-align:center}.hr{border-top:1px dashed #000;margin:6px 0}.row{display:flex;justify-content:space-between;gap:6px}
.it{margin:4px 0}.ch{padding-left:8px}.ob{padding-left:8px;font-weight:700}.big{font-size:15px;font-weight:700}.box{border:1px solid #000;padding:4px;margin:4px 0;font-weight:700}
</style></head><body>
${storeName ? `<div class="c">${esc(storeName)}</div>` : ""}<h1>#${esc(c.displayId)}</h1>
<div class="c big">${c.mode === "DELIVERY" ? "ENTREGA" : "RETIRADA"}</div>
<div class="c">${new Date(c.createdAt).toLocaleString("pt-BR")}</div>
${c.scheduledFor ? `<div class="box c">AGENDADO: ${new Date(c.scheduledFor).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>` : ""}
<div class="hr"></div><div><b>${esc(c.customer.name || "Cliente")}</b>${c.isFirstOrder ? " · 1º PEDIDO" : ""}</div>${c.customer.phone ? `<div>${esc(c.customer.phone)}</div>` : ""}
${c.addressFull ? `<div>${esc(c.addressFull)}</div>` : ""}
<div class="hr"></div>${lines}${c.notes ? `<div class="box">OBS DO PEDIDO: ${esc(c.notes)}</div>` : ""}
<div class="hr"></div>${tot.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${v < 0 ? "− " + BRL(-v) : BRL(v)}</span></div>`).join("")}
<div class="row big"><span>TOTAL</span><span>${BRL(c.total)}</span></div>
<div class="box">${esc(c.payment.line)}</div>
<div class="hr"></div><div class="c">Obrigado!</div></body></html>`;
}

/* ============================== histórico ============================== */

function History() {
  const [st, setSt] = useState<string>("");
  const list = useLoad<Order[]>(`/admin/orders?limit=150${st ? `&status=${st}` : ""}`, [st]);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => list.data || [], [list.data]);
  return <>
    <div className="row between"><span className="small muted">{rows.length} pedidos</span>
      <div className="row"><Select value={st} onChange={setSt} options={[{ value: "", label: "Todos os status" }, ...Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label }))]} /><Btn onClick={list.reload}>Atualizar</Btn></div></div>
    {rows.length ? <div className="tablewrap"><table>
      <thead><tr><th>#</th><th>Quando</th><th>Itens</th><th>Pagamento</th><th>Origem</th><th className="r">Total</th><th>Status</th></tr></thead>
      <tbody>{rows.map((o) => <tr key={o.id} className="click" onClick={() => setOpen(o.id)}>
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
    <div className="row"><Pill tone={STATUS[d.status]?.tone}>{STATUS[d.status]?.label}</Pill><span className="muted small">{dt(d.createdAt)} · {d.mode === "DELIVERY" ? "Entrega" : "Retirada"} · {PAY[d.payment.code]}{d.payment.changeFor ? ` · troco para ${BRL(d.payment.changeFor)}` : ""}{d.scheduledFor ? ` · agendado ${dt(d.scheduledFor)}` : ""}</span></div>
    {d.pos?.error && <div className="issue erro"><span><b>SAIPOS:</b> {d.pos.error}</span></div>}
    {d.payment.online && <section className="panel"><header><h3>Pagamento online</h3><Pill tone={d.payment.online.status === "paid" ? "good" : d.payment.online.status === "pending" ? "warn" : d.payment.online.status === "refunded" ? "accent" : "bad"}>{{ pending: "Aguardando", paid: "Pago", failed: "Recusado", expired: "Expirado", refunded: "Estornado" }[d.payment.online.status]}</Pill></header>
      <p className="small">{d.payment.online.method === "pix" ? "Pix" : `Cartão ${d.payment.online.card?.brand || ""} •••• ${d.payment.online.card?.last4 || ""}${(d.payment.online.card?.installments || 1) > 1 ? ` em ${d.payment.online.card!.installments}x` : ""}`} · {d.payment.online.gateway} · cobrança <span className="mono">{d.payment.online.chargeId}</span>{d.payment.online.paidAt ? ` · pago ${dt(d.payment.online.paidAt)}` : ""}{d.payment.online.refundedAt ? ` · estornado ${dt(d.payment.online.refundedAt)}` : ""}</p>
      {d.payment.online.failureReason && <p className="small down">{d.payment.online.failureReason}</p>}
      {d.payment.online.status === "paid" && <div><Btn sm disabled={busy} onClick={() => act(() => api.post(`/admin/orders/${d.id}/refund`, {}), "Estorno solicitado")}>Estornar valor total</Btn></div>}
    </section>}
    <div className="tablewrap"><table><tbody>
      {d.lines.map((l, i) => <tr key={i}><td><b>{l.qty}× {l.name}</b><div className="small muted">{l.choices.map((c) => `${c.fraction && c.fraction !== "inteira" ? c.fraction + " " : ""}${c.name}${c.free ? " (grátis)" : c.unitDelta ? ` (+${BRL(c.unitDelta)})` : ""}`).join(" · ")}{l.notes ? ` · obs: ${l.notes}` : ""}</div></td><td className="r">{BRL(l.total)}</td></tr>)}
      <tr><td>Itens</td><td className="r">{BRL(d.subtotal)}</td></tr>
      {d.discount > 0 && <tr><td>Desconto</td><td className="r">− {BRL(d.discount)}</td></tr>}
      {d.cashbackUsed > 0 && <tr><td>Cashback usado</td><td className="r">− {BRL(d.cashbackUsed)}</td></tr>}
      <tr><td>Entrega{d.baseDeliveryFee && d.deliveryFee < d.baseDeliveryFee ? <span className="small muted"> (de {BRL(d.baseDeliveryFee)})</span> : null}</td><td className="r">{BRL(d.deliveryFee)}</td></tr>
      {(d.fees || []).map((f) => <tr key={f.label}><td>{f.label}</td><td className="r">{BRL(f.amount)}</td></tr>)}
      <tr><td><b>Total</b></td><td className="r"><b>{BRL(d.total)}</b></td></tr>
    </tbody></table></div>
    {d.address && <p className="small">{d.address.street}, {d.address.number}{d.address.complement ? ` · ${d.address.complement}` : ""} · {d.address.district} · {d.address.city}/{d.address.state}</p>}
    {d.notes && <p className="small">Observação: {d.notes}</p>}
    {d.cashbackEarned > 0 && <p className="small">Cashback do pedido: <b>{BRL(d.cashbackEarned)}</b> {d.status === "concluded" ? "creditado" : "(credita na entrega)"}</p>}
    <section className="panel"><header><h3>Linha do tempo</h3></header>
      <div className="list">{d.statusHistory.map((h, i) => <div key={i} className="li"><Pill tone={STATUS[h.status]?.tone}>{STATUS[h.status]?.label || h.status}</Pill><span className="grow small">{h.note}</span><span className="small muted">{h.by} · {dt(h.at)}</span></div>)}</div>
    </section>
    {d.pos?.payload ? <details><summary className="small">JSON enviado à SAIPOS</summary><div className="codebox">{JSON.stringify(d.pos.payload, null, 2)}</div></details> : null}
  </Drawer>;
}
