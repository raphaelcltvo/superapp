/**
 * Engajamento do cardápio do cliente: triagem de 1 toque, "antes de ir", "sua sacola continua aqui",
 * brilho no botão certo, empurrão do frete grátis, vibração e a pesquisa pós-pedido.
 *
 * Regras de dose (iguais ao plano de UX):
 *  - no máximo 1 efeito a cada 8 s (nunca dois chamando atenção ao mesmo tempo);
 *  - no máximo 1 cupom por visita (pop-up OU "antes de ir");
 *  - "reduzir movimento" troca brilho por contorno fixo; vibração só onde o aparelho suporta (Android).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { createClient } from "@cw/client";
import type { TriageQuestion } from "@cw/core";
import { brl } from "./parts";
import type { Menu } from "./types";
import "./engage.css";

type Api = ReturnType<typeof createClient>;
export interface EngageEffects {
  vibrate: boolean; glowCta: boolean; glowPresetSeconds: number; freeShippingNudge: number;
  exitIntent: { enabled: boolean; title: string; text: string; coupon?: { code: string; name: string; type: string; value: number } };
  returnAfterSeconds: number; statusBuzz: boolean;
}
export interface EngageMenu {
  triage?: TriageQuestion | null;
  engagement?: { effects: EngageEffects; postOrder: { enabled: boolean; reasonsLow: string[]; reasonsHigh: string[]; detractorCredit: number }; avoid: string[]; occasion: unknown };
}
export const engageOf = (m: Menu | null) => (m as (Menu & EngageMenu) | null)?.engagement;

const ss = {
  get(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

/* ---------------- contexto: um único "orçamento de atenção" por visita ---------------- */
interface Fx { fx?: EngageEffects; track: (n: string, p?: Record<string, unknown>) => void; allow: (kind: string) => boolean; buzz: (p: number | number[]) => void; couponOffered: () => boolean; markCoupon: () => void }
const noop: Fx = { track: () => {}, allow: () => false, buzz: () => {}, couponOffered: () => true, markCoupon: () => {} };
export const EngageCtx = createContext<Fx>(noop);
export const useFx = () => useContext(EngageCtx);

export function useFxValue(slug: string, fx: EngageEffects | undefined, track: Fx["track"]): Fx {
  const last = useRef(0);
  return useMemo(() => ({
    fx, track,
    allow: (kind: string) => {
      if (!fx) return false;
      const now = Date.now(); if (now - last.current < 8000) return false;
      last.current = now; track(kind); return true;
    },
    buzz: (p: number | number[]) => { try { if (fx?.vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(p); } catch { /* sem vibração */ } },
    couponOffered: () => !!ss.get(`cw:coupon-offered:${slug}`),
    markCoupon: () => ss.set(`cw:coupon-offered:${slug}`, "1"),
  }), [fx, track, slug]);
}

/** Brilho quando a montagem fica pronta (transição de "falta" para "pronto"). */
export function useReadyGlow(ready: boolean) {
  const f = useFx(); const prev = useRef(ready); const [on, setOn] = useState(false);
  useEffect(() => {
    if (ready && !prev.current && f.fx?.glowCta && f.allow("fx_glow_cta")) { setOn(true); f.buzz(18); const t = setTimeout(() => setOn(false), 2400); prev.current = ready; return () => clearTimeout(t); }
    prev.current = ready;
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}

/** Brilho na sugestão "1 toque" se a pessoa ficar parada na montagem sem escolher. */
export function useIdleGlow(active: boolean, resetKey: unknown) {
  const f = useFx(); const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(false);
    const s = f.fx?.glowPresetSeconds || 0;
    if (!active || !s) return;
    const t = setTimeout(() => { if (f.allow("fx_glow_preset")) setOn(true); }, s * 1000);
    return () => clearTimeout(t);
  }, [active, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}

/** Empurrão do frete grátis: quando falta pouco, a barra pulsa uma vez (por valor alvo, por visita). */
export function useNudge(progress: { missing: number; target: number } | undefined, slug: string) {
  const f = useFx(); const [on, setOn] = useState(false);
  const near = !!progress && !!f.fx?.freeShippingNudge && progress.missing > 0 && progress.missing <= f.fx.freeShippingNudge;
  useEffect(() => {
    if (!near || !progress) return;
    const k = `cw:nudge:${slug}:${progress.target}`;
    if (ss.get(k) || !f.allow("fx_free_ship_nudge")) return;
    ss.set(k, "1"); setOn(true); f.buzz([20, 60, 20]);
    const t = setTimeout(() => setOn(false), 2600); return () => clearTimeout(t);
  }, [near]); // eslint-disable-line react-hooks/exhaustive-deps
  return { near, on };
}

/* ---------------- "antes de ir" e "sua sacola continua aqui" ---------------- */
export function useExitAndReturn(o: { slug: string; enabled: boolean; menuReady: boolean; busy: boolean; cartCount: number; onExit: (via: string) => void; onReturn: () => void }) {
  const f = useFx(); const ref = useRef(o); ref.current = o;
  const shownKey = `cw:exit:${o.slug}`;
  useEffect(() => {
    if (!o.menuReady || !o.enabled) return;
    const fire = (via: string) => {
      const c = ref.current;
      if (ss.get(shownKey) || c.busy) return false;
      ss.set(shownKey, "1"); f.track("exit_shown", { via, cart: c.cartCount }); c.onExit(via); return true;
    };
    // computador: o mouse sai pela parte de cima (indo fechar a aba)
    const out = (e: MouseEvent) => { if (e.clientY <= 0 && !e.relatedTarget) fire("mouse"); };
    // celular: o "voltar" do navegador abre o "antes de ir" uma vez; o segundo voltar sai de verdade
    let trapped = false;
    try { if (!ss.get(shownKey)) { history.pushState({ cwTrap: 1 }, ""); trapped = true; } } catch { /* sem history */ }
    const pop = () => { if (trapped) { trapped = false; fire("back"); } };
    document.addEventListener("mouseout", out); window.addEventListener("popstate", pop);
    // fechou o app (aba em segundo plano) e voltou depois de um tempo
    let hiddenAt = 0;
    const vis = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      const secs = hiddenAt ? (Date.now() - hiddenAt) / 1000 : 0; hiddenAt = 0;
      const min = f.fx?.returnAfterSeconds || 0;
      if (min && secs >= min && ref.current.cartCount > 0 && !ref.current.busy) {
        if (!fire("return")) { f.track("return_toast", { secs: Math.round(secs) }); ref.current.onReturn(); }
      }
    };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("mouseout", out); window.removeEventListener("popstate", pop); document.removeEventListener("visibilitychange", vis); };
  }, [o.menuReady, o.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ExitSheet({ fx, cartCount, subtotal, name, onApply, onStay, onLeave }: { fx: EngageEffects; cartCount: number; subtotal: number; name: string; onApply: (code: string) => void; onStay: () => void; onLeave: () => void }) {
  const f = useFx();
  const coupon = !f.couponOffered() ? fx.exitIntent.coupon : undefined;
  useEffect(() => { if (coupon) f.markCoupon(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const benefit = coupon ? (coupon.type === "percent" ? `${coupon.value}% de desconto` : coupon.type === "amount" ? `${brl(coupon.value)} de desconto` : "Frete grátis") : "";
  return (
    <>
      <div className="overlay on" onClick={onStay} aria-hidden="true" />
      <div className="eg-sheet" role="dialog" aria-label={fx.exitIntent.title}>
        <b className="eg-t">{fx.exitIntent.title}</b>
        <p>{cartCount > 0 ? `Sua sacola com ${cartCount} ${cartCount === 1 ? "item" : "itens"} (${brl(subtotal)}) fica guardada.` : `A ${name} fica aqui quando bater a fome.`} {coupon ? fx.exitIntent.text : ""}</p>
        {coupon && <div className="eg-coupon"><code>{coupon.code}</code><span>{benefit}</span></div>}
        <div className="eg-acts">
          {coupon ? <button className="btn-brand" onClick={() => { onApply(coupon.code); f.track("exit_coupon_applied", { code: coupon.code }); }}>{cartCount ? "Aplicar e fechar o pedido" : "Aplicar e ver o cardápio"}</button>
            : <button className="btn-brand" onClick={onStay}>{cartCount ? "Fechar o pedido" : "Continuar vendo"}</button>}
          <button className="link muted" onClick={onLeave}>Sair mesmo</button>
        </div>
      </div>
    </>
  );
}

/* ---------------- triagem de 1 toque (cliente que já comprou) ---------------- */
export function TriageSheet({ q, name, api, base, sessionId, onDone }: { q: TriageQuestion; name?: string; api: Api; base: string; sessionId: string; onDone: (msg: string, answered: boolean) => void }) {
  const f = useFx(); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { f.track("triage_shown", { kind: q.kind }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useCallback(async (kind: string, values: string[]) => {
    setBusy(true);
    try { const r = await api.post<{ message: string }>(`${base}/triage`, { kind, values, sessionId }); if (kind !== "skip") f.buzz(15); onDone(r.message, kind !== "skip"); }
    catch { onDone("", false); }
  }, [api, base, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = (name || "").split(" ")[0];
  return (
    <>
      <div className="overlay on" onClick={() => !busy && send("skip", [])} aria-hidden="true" />
      <div className="eg-sheet eg-triage" role="dialog" aria-label={q.title}>
        <small className="eg-k">{first ? `Oi, ${first}! ` : ""}Uma pergunta rápida</small>
        <b className="eg-t">{q.title}</b>
        <div className={`eg-opts${q.options.length > 3 ? " wrap" : ""}`}>
          {q.options.map((o) => {
            const on = sel.includes(o.id);
            return <button key={o.id} disabled={busy} className={`eg-opt${on ? " on" : ""}`} aria-pressed={q.multi ? on : undefined}
              onClick={() => { if (!q.multi) { send(q.kind, [o.id]); return; } setSel(o.id === "nada" ? ["nada"] : on ? sel.filter((x) => x !== o.id) : [...sel.filter((x) => x !== "nada"), o.id]); }}>{o.label}</button>;
          })}
        </div>
        <div className="eg-acts">
          {q.multi && <button className="btn-brand" disabled={busy || !sel.length} onClick={() => send(q.kind, sel)}>Pronto</button>}
          <button className="link muted" disabled={busy} onClick={() => send("skip", [])}>Pular</button>
        </div>
        <span className="eg-why">Usamos a resposta só para arrumar o cardápio pra você.</span>
      </div>
    </>
  );
}

/* ---------------- pós-pedido ---------------- */
export function useStatusBuzz(status: string) {
  const f = useFx(); const prev = useRef(status);
  useEffect(() => { if (prev.current !== status && f.fx?.statusBuzz) f.buzz(status === "concluded" || status === "dispatched" ? [60, 40, 60] : 30); prev.current = status; }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function FeedbackCard({ menu, api, base, sessionId, order }: { menu: Menu; api: Api; base: string; sessionId: string; order: { id: string; status: string; lines?: { itemId: string }[]; feedback?: { nps: number } | null } }) {
  const eg = engageOf(menu); const f = useFx();
  const [nps, setNps] = useState<number | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [want, setWant] = useState<string | undefined>();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { kind: string; message: string; creditGiven: number; googleReviewUrl?: string }>(null);
  const [err, setErr] = useState("");
  const tryIds = useMemo(() => {
    const had = new Set((order.lines || []).map((l) => l.itemId));
    const pool = [...(menu.mostOrdered?.itemIds || []), ...menu.categories.flatMap((c) => c.itemIds)];
    return [...new Set(pool)].filter((id) => !had.has(id) && menu.items[id] && !menu.items[id].isDrink).slice(0, 6);
  }, [menu, order.lines]);
  if (!eg?.postOrder.enabled || order.feedback || !["dispatched", "concluded"].includes(order.status)) return null;
  if (done) return (
    <div className={`blk eg-fb done ${done.kind}`} role="status">
      <b>{done.kind === "detrator" ? "Obrigado por contar" : "Valeu!"}</b>
      <p>{done.message}</p>
      {done.creditGiven > 0 && <span className="eg-credit">+ {brl(done.creditGiven)} de crédito na sua conta</span>}
      {done.googleReviewUrl && <a className="btn-ghost" href={done.googleReviewUrl} target="_blank" rel="noopener" onClick={() => f.track("google_review_click")}>Avaliar no Google</a>}
    </div>
  );
  const rs = nps == null ? [] : nps >= 9 ? eg.postOrder.reasonsHigh : eg.postOrder.reasonsLow;
  return (
    <div className="blk eg-fb">
      <b>{order.status === "concluded" ? "Como foi o pedido?" : "Enquanto chega: como foi pedir aqui?"}</b>
      <fieldset className="q"><legend>De 0 a 10, quanto você indicaria a {menu.tenant.name} para um amigo?</legend>
        <div className="nps" role="radiogroup">{Array.from({ length: 11 }, (_, n) => <button key={n} role="radio" aria-checked={nps === n} className={`npsb${nps === n ? " on" : ""}`} onClick={() => { setNps(n); setReasons([]); }}>{n}</button>)}</div>
        <div className="nps-legend"><span>Nada provável</span><span>Muito provável</span></div>
      </fieldset>
      {nps != null && <>
        <fieldset className="q"><legend>{nps >= 9 ? "O que mais agradou?" : nps >= 7 ? "O que faltou para o 10?" : "O que deu errado?"}</legend>
          <div className="chips">{rs.map((r) => <button key={r} className={`nchip${reasons.includes(r) ? " on" : ""}`} aria-pressed={reasons.includes(r)} onClick={() => setReasons(reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r].slice(0, 6))}>{r}</button>)}</div>
        </fieldset>
        {tryIds.length > 0 && <fieldset className="q"><legend>E da próxima vez, quer provar qual?</legend>
          <div className="chips">{tryIds.map((id) => <button key={id} className={`nchip${want === id ? " on" : ""}`} aria-pressed={want === id} onClick={() => setWant(want === id ? undefined : id)}>{menu.items[id].name.split(" · ")[0]}</button>)}</div>
        </fieldset>}
        <div className="field"><label htmlFor="cw-fb-c">Quer contar mais? (opcional)</label><textarea id="cw-fb-c" rows={2} maxLength={600} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        {err && <span className="err" role="alert">{err}</span>}
        <button className="btn-brand" disabled={busy} onClick={async () => {
          setBusy(true); setErr("");
          try { const r = await api.post<NonNullable<typeof done>>(`${base}/orders/${order.id}/feedback`, { nps, reasons, wantToTry: want, comment: comment.trim() || undefined, sessionId }); setDone(r); f.buzz(20); }
          catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>Enviar avaliação</button>
      </>}
    </div>
  );
}
