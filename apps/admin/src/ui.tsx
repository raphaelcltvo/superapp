import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Api } from "@cw/client";
import { ApiError } from "@cw/client";

export const BRL = (v: number | undefined | null) => "R$ " + (v ?? 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
export const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
export const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—");

/* ---------- contexto do painel ---------- */
export interface AdminCtx { api: Api; toast: (msg: string, bad?: boolean) => void; go: (route: string) => void; dirty: () => void; storeId: string; setStoreId: (s: string) => void; onPublished?: () => void }
export const Ctx = createContext<AdminCtx>(null as never);
export const useAdmin = () => useContext(Ctx);

export function errMsg(e: unknown) {
  if (e instanceof ApiError) {
    const d = e.details as { path?: string; message?: string }[] | undefined;
    return Array.isArray(d) && d[0]?.message ? `${e.message}: ${d.slice(0, 3).map((x) => (x.path ? x.path + " " : "") + x.message).join("; ")}` : e.message;
  }
  return String((e as Error)?.message || e);
}

/** Carrega dados da API e expõe recarregar. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const { api } = useAdmin();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api.get<T>(path)); setError(null); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [api, path]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, setData, error, loading, reload };
}

/** Executa uma ação com toast de sucesso/erro. */
export function useAction() {
  const { toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(errMsg(e), true); return undefined; } finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

/* ---------- componentes ---------- */
export function Btn(p: { children: ReactNode; onClick?: () => void; kind?: "primary" | "danger" | "ghost"; sm?: boolean; disabled?: boolean; type?: "button" | "submit"; title?: string; id?: string }) {
  return <button id={p.id} type={p.type || "button"} title={p.title} className={`btn ${p.kind || ""} ${p.sm ? "sm" : ""}`} onClick={p.onClick} disabled={p.disabled}>{p.children}</button>;
}

export function Field(p: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className="field" style={p.wide ? { gridColumn: "1 / -1" } : undefined}><span>{p.label}</span>{p.children}{p.hint && <em>{p.hint}</em>}</label>;
}

export function Text(p: { value?: string; onChange: (v: string) => void; placeholder?: string; type?: string; id?: string; mono?: boolean }) {
  return <input id={p.id} type={p.type || "text"} className={p.mono ? "mono" : ""} value={p.value ?? ""} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />;
}

export function Num(p: { value?: number; onChange: (v: number | undefined) => void; step?: number; min?: number; id?: string; placeholder?: string }) {
  const [s, setS] = useState(p.value == null ? "" : String(p.value).replace(".", ","));
  useEffect(() => { const cur = s.trim() === "" ? undefined : Number(s.replace(",", ".")); if (cur !== p.value) setS(p.value == null ? "" : String(p.value).replace(".", ",")); }, [p.value]); // eslint-disable-line
  return <input id={p.id} type="text" inputMode="decimal" className="num" placeholder={p.placeholder} value={s} onChange={(e) => { setS(e.target.value); const v = e.target.value.trim() === "" ? undefined : Number(e.target.value.replace(/\./g, "").replace(",", ".")); if (v === undefined || !Number.isNaN(v)) p.onChange(v); }} />;
}

export function Select<T extends string>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; id?: string }) {
  return <select id={p.id} value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>{p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}

export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return <button type="button" role="switch" aria-checked={p.checked} className="toggle" onClick={() => p.onChange(!p.checked)}><i />{p.label}</button>;
}

export function Chips<T extends string | number>(p: { value: T[]; onChange: (v: T[]) => void; options: { value: T; label: string }[] }) {
  return <div className="chips">{p.options.map((o) => { const on = p.value.includes(o.value); return <button key={String(o.value)} type="button" className="chip" aria-pressed={on} onClick={() => p.onChange(on ? p.value.filter((x) => x !== o.value) : [...p.value, o.value])}>{o.label}</button>; })}</div>;
}

export function Pill(p: { children: ReactNode; tone?: "good" | "warn" | "bad" | "accent" }) { return <span className={`pill ${p.tone || ""}`}>{p.children}</span>; }

export function Drawer(p: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && p.onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [p]);
  return <>
    <div className="scrim" onClick={p.onClose} />
    <aside className="drawer" role="dialog" aria-modal="true">
      <header><h2>{p.title}</h2><Btn kind="ghost" onClick={p.onClose}>Fechar</Btn></header>
      <div className="body">{p.children}</div>
      {p.footer && <footer>{p.footer}</footer>}
    </aside>
  </>;
}

/** Confirmação dentro da página (o visualizador não exibe confirm()). */
export function ConfirmBtn(p: { label: string; confirm: string; onConfirm: () => void; sm?: boolean }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <Btn kind="danger" sm={p.sm} onClick={() => setAsk(true)}>{p.label}</Btn>;
  return <span className="row"><span className="small">{p.confirm}</span><Btn sm kind="danger" onClick={() => { setAsk(false); p.onConfirm(); }}>Sim</Btn><Btn sm onClick={() => setAsk(false)}>Não</Btn></span>;
}

export function Empty(p: { title: string; children?: ReactNode }) { return <div className="empty"><b>{p.title}</b>{p.children}</div>; }

export function Tabs<T extends string>(p: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return <div className="tabs" role="tablist">{p.tabs.map((t) => <button key={t.value} role="tab" className="tab" aria-selected={p.value === t.value} onClick={() => p.onChange(t.value)}>{t.label}</button>)}</div>;
}

export function Tile(p: { k: string; v: ReactNode; d?: ReactNode }) { return <div className="tile"><span className="k">{p.k}</span><span className="v num">{p.v}</span>{p.d && <span className="d">{p.d}</span>}</div>; }

/** Variação percentual com seta e cor (subir é bom por padrão). */
export function Delta(p: { cur: number; prev: number; invert?: boolean; suffix?: string }) {
  if (!p.prev) return <span className="muted">sem base anterior</span>;
  const d = ((p.cur - p.prev) / Math.abs(p.prev)) * 100;
  const good = p.invert ? d < 0 : d > 0;
  return <span className={Math.abs(d) < 0.05 ? "muted" : good ? "up" : "down"}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d).toFixed(1).replace(".", ",")}% {p.suffix || "vs período anterior"}</span>;
}

/** Upload de mídia (imagem, GIF, vídeo) para a API. */
export function MediaInput(p: { value?: string; onChange: (url: string, type: string) => void; accept?: string; id?: string }) {
  const { api, toast } = useAdmin();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isVideo = /\.(mp4|webm)(\?|$)/i.test(p.value || "") || (p.value || "").startsWith("data:video");
  return <div className="stack" style={{ gap: 6 }}>
    {p.value ? <div className="media-prev">{isVideo ? <video src={p.value} muted autoPlay loop playsInline /> : <img src={p.value} alt="" />}</div> : null}
    <div className="row">
      <input ref={ref} id={p.id} type="file" hidden accept={p.accept || "image/*,video/mp4,video/webm"} onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return; setBusy(true);
        try { const fd = new FormData(); fd.append("file", f); const m = await api.upload<{ url: string; type: string }>("/admin/media", fd); p.onChange(m.url, m.type); toast("Arquivo enviado"); }
        catch (er) { toast(errMsg(er), true); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
      }} />
      <Btn sm onClick={() => ref.current?.click()} disabled={busy}>{busy ? "Enviando…" : p.value ? "Trocar arquivo" : "Enviar arquivo"}</Btn>
      <span className="small muted">JPG, PNG, WebP, GIF até 3 MB · MP4/WebM até 15 MB</span>
    </div>
  </div>;
}
