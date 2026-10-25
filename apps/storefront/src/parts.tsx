import { useEffect, useState } from "react";
import { BRL, type Banner, type Page, type PageBlock } from "@cw/core";
import type { Menu, MenuItem } from "./types";

export const brl = BRL;

/** Foto da pizza: inteira ou metade de cada sabor lado a lado, com divisória branca. */
export function PizzaPhoto({ urls, alt, fade }: { urls: (string | undefined)[]; alt: string; fade?: boolean }) {
  const [a, b] = urls;
  if (!a) return <span className="ph-empty" aria-hidden="true" />;
  const half = !!b && b !== a;
  return (
    <span className={`ph-box${half ? " half" : ""}${fade ? " fade" : ""}`} role="img" aria-label={alt}>
      <img src={a} alt="" loading="lazy" />
      {half && <img className="r" src={b} alt="" loading="lazy" />}
    </span>
  );
}

export function Bottle({ name }: { name: string }) {
  const col = /Coca/.test(name) ? "#C8102E" : /Guaran/.test(name) ? "#1D7A3A" : /Matte|Chá/.test(name) ? "#E08A2C" : "#5AA9D6";
  const can = /lata/i.test(name);
  return (
    <svg width="58" height="58" viewBox="0 0 60 60" aria-hidden="true">
      {can ? (<><rect x="20" y="10" width="20" height="40" rx="4" fill={col} /><rect x="22" y="8" width="16" height="4" rx="2" fill="#BFBFBF" /><rect x="20" y="24" width="20" height="8" fill="#fff" opacity=".85" /></>)
        : (<><path d="M26 4h8v8c6 3 8 7 8 12v30a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3V24c0-5 2-9 8-12z" fill={col} opacity=".92" /><rect x="18" y="28" width="24" height="10" fill="#fff" opacity=".85" /><rect x="25" y="1" width="10" height="5" rx="1.5" fill="#333" /></>)}
    </svg>
  );
}

/** Mapa nome da opção -> foto, varrendo todos os grupos do cardápio. */
export function optionPhotos(menu: Menu) {
  const m: Record<string, string> = {};
  for (const g of Object.values(menu.groups)) for (const o of g.options) if (o.imageUrl && !m[o.name]) m[o.name] = o.imageUrl;
  return m;
}

export function ItemArt({ item, photos }: { item: MenuItem; photos: Record<string, string> }) {
  if (item.heroOptionNames?.length) {
    const urls = item.heroOptionNames.map((n) => photos[n]);
    if (urls.every(Boolean)) return <PizzaPhoto urls={urls} alt={item.name} />;
  }
  if (item.imageUrl) return <PizzaPhoto urls={[item.imageUrl]} alt={item.name} />;
  if (item.isDrink) return <Bottle name={item.name} />;
  const first = item.heroOptionNames?.map((n) => photos[n]).find(Boolean);
  if (first) return <PizzaPhoto urls={[first]} alt={item.name} />;
  const ini = item.name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return <span className="ph-empty" aria-hidden="true">{ini && <b>{ini}</b>}</span>;
}

export function Media({ media, className }: { media: Banner["media"]; className?: string }) {
  if (!media?.url) return <span className={`ph-empty ${className || ""}`} aria-hidden="true" />;
  if (media.kind === "video") return <video className={className} src={media.url} poster={media.posterUrl} autoPlay muted loop playsInline aria-label={media.alt} />;
  return <img className={className} src={media.url} alt={media.alt} loading="lazy" />;
}

export function BannerView({ banner, onOpen }: { banner: Banner; onOpen: (b: Banner) => void }) {
  const clickable = banner.link.kind !== "none";
  const inner = (
    <>
      <Media media={banner.media} className="bn-media" />
      {(banner.headline || banner.sub || banner.cta) && (
        <span className="bn-txt">
          {banner.headline && <b>{banner.headline}</b>}
          {banner.sub && <span>{banner.sub}</span>}
          {banner.cta && <em>{banner.cta} →</em>}
        </span>
      )}
    </>
  );
  return clickable
    ? <button className="banner tap" onClick={() => onOpen(banner)} aria-label={banner.headline || banner.media.alt}>{inner}</button>
    : <div className="banner">{inner}</div>;
}

/* ---------------- página dedicada (LP de campanha e pesquisa) ---------------- */
type Answers = Record<string, string | number | string[]>;

export function PageView({ page, menu, photos, couponCodeFor, onClose, onOpenItem, onLink, onApplyCoupon, onSubmit }: {
  page: Page; menu: Menu; photos: Record<string, string>;
  couponCodeFor: (couponId: string) => string | undefined;
  onClose: () => void; onOpenItem: (id: string) => void; onLink: (l: Extract<PageBlock, { kind: "cta" }>["link"]) => void;
  onApplyCoupon: (code: string) => void; onSubmit: (answers: Answers) => Promise<string>;
}) {
  const [ans, setAns] = useState<Answers>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasQuestions = page.blocks.some((b) => ["nps", "rating", "choice", "open"].includes(b.kind));
  const set = (id: string, v: Answers[string]) => setAns((a) => ({ ...a, [id]: v }));
  useEffect(() => { setAns({}); setDone(null); }, [page.id]);

  const submit = async () => {
    if (!Object.keys(ans).length) { setErr("Responda ao menos uma pergunta."); return; }
    setBusy(true); setErr(null);
    try { setDone(await onSubmit(ans)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="screen lp" role="dialog" aria-label={page.title}>
      <div className="app-hd">
        <button className="back" onClick={onClose} aria-label="Voltar ao cardápio">←</button>
        <div><h2>{page.title}</h2><span>{menu.tenant.name}</span></div>
      </div>
      {done ? (
        <div className="blk lp-done"><b>{done}</b><button className="btn-brand" onClick={onClose}>Voltar ao cardápio</button></div>
      ) : (
        <div className="lp-body">
          {page.blocks.map((b, i) => {
            switch (b.kind) {
              case "hero": return <div key={i} className="lp-hero"><Media media={b.media} className="lp-hero-media" /><div className="lp-hero-txt"><h3>{b.title}</h3>{b.text && <p>{b.text}</p>}</div></div>;
              case "text": return <div key={i} className="blk">{b.title && <h4>{b.title}</h4>}<p className="lp-p">{b.text}</p></div>;
              case "items": return (
                <div key={i} className="blk"><h4>{b.title}</h4>
                  <div className="carousel">{b.itemIds.filter((id) => menu.items[id]).map((id) => (
                    <button key={id} className="mini tap" onClick={() => onOpenItem(id)}>
                      <div className="ph"><ItemArt item={menu.items[id]} photos={photos} /></div>
                      <span className="nm">{menu.items[id].name.split(" · ")[0]}</span><span className="pr">{brl(menu.items[id].minPrice ?? menu.items[id].price)}</span>
                    </button>))}
                  </div>
                </div>);
              case "coupon": {
                const code = (b as { coupon?: { code?: string } }).coupon?.code || couponCodeFor(b.couponId);
                return <div key={i} className="blk"><div className="lp-coupon">{b.text && <p>{b.text}</p>}{code ? (<><code>{code}</code><button className="btn-brand" onClick={() => onApplyCoupon(code)}>Usar no pedido</button></>) : <p className="lp-muted">O benefício aparece na revisão do pedido.</p>}</div></div>;
              }
              case "nps": return (
                <fieldset key={i} className="blk q"><legend>{b.question}</legend>
                  <div className="nps">{Array.from({ length: 11 }, (_, n) => <button key={n} type="button" className={`npsb${ans[b.id] === n ? " on" : ""}`} aria-pressed={ans[b.id] === n} onClick={() => set(b.id, n)}>{n}</button>)}</div>
                  <div className="nps-legend"><span>Nada provável</span><span>Muito provável</span></div>
                </fieldset>);
              case "rating": return (
                <fieldset key={i} className="blk q"><legend>{b.question}</legend>
                  <div className="stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`star-b${Number(ans[b.id] || 0) >= n ? " on" : ""}`} aria-label={`${n} de 5`} aria-pressed={ans[b.id] === n} onClick={() => set(b.id, n)}>★</button>)}</div>
                </fieldset>);
              case "choice": {
                const cur = ans[b.id];
                const list = Array.isArray(cur) ? cur : cur ? [String(cur)] : [];
                return (
                  <fieldset key={i} className="blk q"><legend>{b.question}</legend>
                    <div className="chips">{b.options.map((o) => {
                      const on = list.includes(o);
                      return <button key={o} type="button" className={`nchip${on ? " on" : ""}`} aria-pressed={on} onClick={() => set(b.id, b.multiple ? (on ? list.filter((x) => x !== o) : [...list, o]) : o)}>{o}</button>;
                    })}</div>
                  </fieldset>);
              }
              case "open": return (
                <div key={i} className="blk field"><label htmlFor={`lp-${b.id}`}>{b.question}</label>
                  <textarea id={`lp-${b.id}`} rows={3} maxLength={1000} value={String(ans[b.id] || "")} onChange={(e) => set(b.id, e.target.value)} />
                </div>);
              case "cta": return <div key={i} className="blk"><button className="cta" onClick={() => onLink(b.link)}><span>{b.label}</span><span>→</span></button></div>;
              default: return null;
            }
          })}
          {hasQuestions && (
            <div className="blk">
              {err && <p className="err" role="alert">{err}</p>}
              <button className="cta" disabled={busy} onClick={submit}><span>{busy ? "Enviando…" : "Enviar resposta"}</span><span /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Próxima abertura da loja no dia de hoje ou amanhã (texto curto). */
export function nextOpening(hours: { weekday: number; open: string; close: string }[], now = new Date()) {
  const wd = now.getDay(), min = now.getHours() * 60 + now.getMinutes();
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const today = hours.filter((h) => h.weekday === wd && toMin(h.open) > min).sort((a, b) => toMin(a.open) - toMin(b.open))[0];
  if (today) return `abre hoje às ${today.open}`;
  for (let d = 1; d <= 7; d++) {
    const w = (wd + d) % 7; const h = hours.filter((x) => x.weekday === w).sort((a, b) => toMin(a.open) - toMin(b.open))[0];
    if (h) return d === 1 ? `abre amanhã às ${h.open}` : `abre ${["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][w]} às ${h.open}`;
  }
  return "sem horário cadastrado";
}
