/**
 * Primeira visita: 2–3 perguntas de 1 toque → contato (opcional no modo recompensa, exigido no modo portão)
 * → cupom de boas-vindas. Sem senha: celular e e-mail com preenchimento automático do aparelho.
 * Senha só aparece no pagamento online (OnlineAuth, mais abaixo).
 */
import { useEffect, useState } from "react";
import type { createClient } from "@cw/client";
import { brl } from "./parts";
import { fmtCpf, validCpf } from "./payments";
import type { FirstVisit } from "./types";
import "./firstvisit.css";

type Api = ReturnType<typeof createClient>;
export interface FvResult { leadId: string; skipped: boolean; couponUnlocked: boolean; coupon: { code: string; name: string; type: string; value: number } | null; message: string; needs?: string[]; hero?: { title?: string; personaName?: string } }

const benefit = (c: { type: string; value: number; maxDiscount?: number }) => (c.type === "percent" ? `${c.value}% off` : c.type === "amount" ? `${brl(c.value)} off` : "Frete grátis");
const phoneOk = (p: string) => p.replace(/\D/g, "").length >= 10;
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
const fmtPhone = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 11); if (d.length <= 2) return d; if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`; return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`; };

export function FirstVisitSheet({ fv, brand, api, base, sessionId, source, campaign, leadId, onLead, onClose, onApply, track }: {
  fv: FirstVisit; brand: string; api: Api; base: string; sessionId: string; source?: string; campaign?: string; leadId: string | null;
  onLead: (id: string) => void; onClose: (r: FvResult | null) => void; onApply: (code: string) => void; track: (n: string, p?: Record<string, unknown>) => void;
}) {
  const gate = fv.mode === "gate" && !!fv.coupon;
  const qs = fv.questions;
  // passos: [oferta (portão)] → perguntas → contato → resultado
  const [step, setStep] = useState<number>(gate ? -1 : 0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [contact, setContact] = useState({ name: "", phone: "", email: "", optinWhatsapp: true, optinEmail: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<FvResult | null>(null);
  useEffect(() => { track("fv_shown", { mode: fv.mode, source: fv.source, questions: qs.length }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setErr("");
    try {
      const r = await api.post<FvResult>(`${base}/firstvisit`, { leadId: leadId || undefined, sessionId, source, campaign, ...body });
      onLead(r.leadId); return r;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(false); }
  };
  const skip = async () => { track("fv_skip_click", { step }); await send({ skip: true, answers: {} }); onClose(null); };
  const pick = (qid: string, oid: string) => {
    const a = { ...answers, [qid]: oid }; setAnswers(a);
    track("fv_answer", { q: qid, a: oid });
    setStep((s) => s + 1);
  };
  const contactValid = gate ? phoneOk(contact.phone) && emailOk(contact.email) : (!contact.phone || phoneOk(contact.phone)) && (!contact.email || emailOk(contact.email));
  const finish = async (withContact: boolean) => {
    const c = withContact && (contact.phone || contact.email) ? { name: contact.name || undefined, phone: contact.phone || undefined, email: contact.email || undefined, optinWhatsapp: contact.optinWhatsapp, optinEmail: contact.optinEmail } : undefined;
    const r = await send({ answers, contact: c });
    if (r) { setResult(r); setStep(qs.length + 1); }
  };

  const dots = <div className="fv-dots" aria-hidden="true">{qs.map((q, i) => <i key={q.id} className={i < step ? "done" : i === step ? "on" : ""} />)}<i className={step >= qs.length ? "on" : ""} /></div>;
  const title = brand.split(" ")[0];

  return (
    <>
      <div className="overlay on" aria-hidden="true" />
      <div className="eg-sheet fv-sheet" role="dialog" aria-label="Boas-vindas">
        {step === -1 && fv.coupon && (<>
          <small className="eg-k">Primeira vez na {brand}?</small>
          <b className="eg-t">Ganhe {benefit(fv.coupon)} no primeiro pedido</b>
          <p>Responda {qs.length} perguntas rápidas e deixe seu celular e e-mail: o cupom libera na hora e o cardápio já abre do seu jeito.</p>
          <div className="fv-offer"><span className="fv-ticket">{benefit(fv.coupon)}</span><span>{fv.coupon.name}</span></div>
          <div className="eg-acts"><button className="btn-brand" onClick={() => { track("fv_gate_accept"); setStep(0); }}>Quero o cupom</button><button className="link muted" disabled={busy} onClick={skip}>Agora não</button></div>
        </>)}

        {step >= 0 && step < qs.length && (<>
          {dots}
          <small className="eg-k">{step === 0 ? `Oi! Bem-vindo à ${title}` : `Pergunta ${step + 1} de ${qs.length}`}</small>
          <b className="eg-t">{qs[step].title}</b>
          <div className={`eg-opts${qs[step].options.length > 3 ? " wrap" : ""}`}>
            {qs[step].options.map((o) => <button key={o.id} className={`eg-opt${answers[qs[step].id] === o.id ? " on" : ""}`} onClick={() => pick(qs[step].id, o.id)}>{o.label}</button>)}
          </div>
          <div className="eg-acts">
            {step > 0 && <button className="link muted" onClick={() => setStep(step - 1)}>Voltar</button>}
            <button className="link muted" disabled={busy} onClick={skip}>Pular</button>
          </div>
          <span className="eg-why">{fv.source === "personas" ? "Comparamos com quem já pede aqui para abrir o cardápio do seu jeito." : "Usamos a resposta só para abrir o cardápio do seu jeito."}</span>
        </>)}

        {step === qs.length && (<>
          {dots}
          <small className="eg-k">{gate ? "Último passo para liberar o cupom" : "Quase lá"}</small>
          <b className="eg-t">{gate ? "Para onde mandamos seu cupom?" : fv.coupon ? "Quer o cupom também no WhatsApp?" : "Quer receber novidades?"}</b>
          <form className="fv-form" autoComplete="on" onSubmit={(e) => { e.preventDefault(); if (contactValid && !busy) finish(true); }}>
            <div className="field"><label htmlFor="fv-name">Nome</label><input id="fv-name" name="name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="fv-phone">Celular com DDD{gate ? "" : " (opcional)"}</label><input id="fv-phone" name="tel" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(21) 99999-9999" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: fmtPhone(e.target.value) })} />{contact.phone && !phoneOk(contact.phone) && <span className="err">Celular incompleto</span>}</div>
            <div className="field"><label htmlFor="fv-email">E-mail{gate ? "" : " (opcional)"}</label><input id="fv-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="voce@email.com" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />{contact.email && !emailOk(contact.email) && <span className="err">E-mail incompleto</span>}</div>
            <label className="check"><input type="checkbox" checked={contact.optinWhatsapp} onChange={(e) => setContact({ ...contact, optinWhatsapp: e.target.checked })} /><span>Ofertas e avisos no WhatsApp</span></label>
            <label className="check"><input type="checkbox" checked={contact.optinEmail} onChange={(e) => setContact({ ...contact, optinEmail: e.target.checked })} /><span>Ofertas por e-mail</span></label>
            <span className="eg-why">{fv.consentText} Sem senha: o código chega no WhatsApp quando você for pedir.</span>
            {err && <span className="err" role="alert">{err}</span>}
            <div className="eg-acts">
              <button type="submit" className="btn-brand" disabled={busy || !contactValid || (gate && !(contact.phone && contact.email))}>{busy ? "Enviando…" : gate ? "Liberar meu cupom" : fv.coupon ? "Ver meu cupom" : "Pronto"}</button>
              {!gate && <button type="button" className="link muted" disabled={busy} onClick={() => finish(false)}>Pular esta parte</button>}
            </div>
          </form>
        </>)}

        {step > qs.length && result && (<>
          <small className="eg-k">{result.hero?.personaName ? "Clientes parecidos com você" : "Pronto"}</small>
          <b className="eg-t">{result.couponUnlocked ? "Seu cupom está liberado" : "Cardápio do seu jeito"}</b>
          <p>{result.message}</p>
          {result.couponUnlocked && result.coupon && <div className="fv-offer win"><code>{result.coupon.code}</code><span>{result.coupon.name}</span></div>}
          {err && <span className="err" role="alert">{err}</span>}
          <div className="eg-acts">
            {result.couponUnlocked && result.coupon
              ? <button className="btn-brand" onClick={() => { onApply(result.coupon!.code); track("fv_coupon_applied", { code: result.coupon!.code }); onClose(result); }}>Aplicar e ver o cardápio</button>
              : <button className="btn-brand" onClick={() => onClose(result)}>Ver o cardápio</button>}
          </div>
        </>)}
      </div>
    </>
  );
}

/* ---------------- senha só no pagamento online ---------------- */
export interface OnlineAuthState { status: "loading" | "new" | "existing" | "reset" | "off"; cpf: string; birthDate: string; password: string; code: string; sent: boolean; demoCode: string; err: string }
export const onlineAuthReady = (s: OnlineAuthState) =>
  s.status === "off" || (s.status === "new" ? validCpf(s.cpf) && /^\d{4}-\d{2}-\d{2}$/.test(s.birthDate) && s.password.length >= 6 : s.status === "existing" ? s.password.length >= 1 : s.status === "reset" ? s.code.length >= 4 && s.password.length >= 6 : false);

/** Gera o token curto do pagamento online (cria a senha na primeira vez). */
export async function onlineToken(api: Api, base: string, s: OnlineAuthState): Promise<string | undefined> {
  if (s.status === "off") return undefined;
  if (s.status === "new") return (await api.post<{ onlineToken: string }>(`${base}/me/online-identity`, { cpf: s.cpf, birthDate: s.birthDate, password: s.password })).onlineToken;
  if (s.status === "reset") return (await api.post<{ onlineToken: string }>(`${base}/me/online-reset`, { code: s.code, password: s.password })).onlineToken;
  return (await api.post<{ onlineToken: string }>(`${base}/me/online-auth`, { password: s.password })).onlineToken;
}

export function OnlineAuth({ api, base, phone, state, setState }: { api: Api; base: string; phone?: string; state: OnlineAuthState; setState: (s: OnlineAuthState) => void }) {
  useEffect(() => {
    let on = true;
    api.get<{ required: boolean; hasPassword: boolean }>(`${base}/me/online-auth`).then((r) => { if (on) setState({ ...state, status: !r.required ? "off" : r.hasPassword ? "existing" : "new", err: "" }); }).catch(() => { if (on) setState({ ...state, status: "off" }); });
    return () => { on = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: Partial<OnlineAuthState>) => setState({ ...state, ...x, err: "" });
  if (state.status === "off" || state.status === "loading") return null;
  return (
    <div className="blk fv-online"><h4>Segurança do pagamento online</h4>
      {state.status === "new" && (<>
        <p className="muted">Na primeira vez que você paga pelo app, confirmamos quem é o titular e você cria uma senha. Pagando na entrega, nada disso é pedido.</p>
        <div className="field"><label htmlFor="cw-oa-cpf">CPF</label><input id="cw-oa-cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={state.cpf} onChange={(e) => set({ cpf: fmtCpf(e.target.value) })} />{state.cpf.length >= 14 && !validCpf(state.cpf) && <span className="err">CPF inválido</span>}</div>
        <div className="field"><label htmlFor="cw-oa-bday">Data de nascimento</label><input id="cw-oa-bday" type="date" autoComplete="bday" value={state.birthDate} onChange={(e) => set({ birthDate: e.target.value })} /></div>
        <div className="field"><label htmlFor="cw-oa-pw">Crie uma senha</label><input id="cw-oa-pw" type="password" autoComplete="new-password" minLength={6} placeholder="Pelo menos 6 caracteres" value={state.password} onChange={(e) => set({ password: e.target.value })} /></div>
      </>)}
      {state.status === "existing" && (<>
        <div className="field"><label htmlFor="cw-oa-cur">Sua senha de pagamento</label><input id="cw-oa-cur" type="password" autoComplete="current-password" value={state.password} onChange={(e) => set({ password: e.target.value })} /></div>
        <button className="link" onClick={async () => {
          try { const r = await api.post<{ demoCode?: string }>(`${base}/auth/otp`, { phone }); setState({ ...state, status: "reset", password: "", sent: true, demoCode: r.demoCode || "", err: "" }); }
          catch (e) { setState({ ...state, err: (e as Error).message }); }
        }}>Esqueci a senha</button>
      </>)}
      {state.status === "reset" && (<>
        <div className="field"><label htmlFor="cw-oa-code">Código enviado pelo WhatsApp</label><input id="cw-oa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={state.code} onChange={(e) => set({ code: e.target.value.replace(/\D/g, "") })} />{state.demoCode && <small className="muted">Demonstração: o código é {state.demoCode}</small>}</div>
        <div className="field"><label htmlFor="cw-oa-new">Nova senha</label><input id="cw-oa-new" type="password" autoComplete="new-password" minLength={6} value={state.password} onChange={(e) => set({ password: e.target.value })} /></div>
      </>)}
      {state.err && <span className="err" role="alert">{state.err}</span>}
    </div>
  );
}
export const ONLINE_AUTH_INIT: OnlineAuthState = { status: "loading", cpf: "", birthDate: "", password: "", code: "", sent: false, demoCode: "", err: "" };
