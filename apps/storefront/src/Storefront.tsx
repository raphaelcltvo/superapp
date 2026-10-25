import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ApiError, createClient, type Transport } from "@cw/client";
import { CardError, detectBrand, fmtCardNumber, fmtCpf, fmtExpiry, tokenizeCard, validateCard, validCpf, type CardFields } from "./payments";
import { effectiveRule, fractionLabel, groupCount, pickPopup, priceLine, validateSelection, type Banner, type CartLineInput, type OptionGroup, type Page, type PageBlock, type PaymentCode, type PricedLine, type StrategyContext } from "@cw/core";
import { Bottle, BannerView, ItemArt, PageView, PizzaPhoto, brl, nextOpening, optionPhotos } from "./parts";
import type { CartLine, Menu, MenuItem, MenuStrategy, QuoteResp } from "./types";
import { shownPrice } from "./types";
import "./storefront.css";
import { FirstVisitSheet, OnlineAuth, ONLINE_AUTH_INIT, onlineAuthReady, onlineToken, type FvResult, type OnlineAuthState } from "./firstvisit";
import { EngageCtx, ExitSheet, FeedbackCard, TriageSheet, engageOf, useExitAndReturn, useFxValue, useIdleGlow, useNudge, useReadyGlow, useStatusBuzz, type EngageMenu } from "./engage";

export interface StorefrontProps {
  transport: Transport;
  slug: string;
  storeId?: string;
  source?: string;
  /** mostra o rascunho do painel (precisa do token do gestor) e ignora loja fechada */
  preview?: boolean;
  adminToken?: () => string | null;
  /** onde guardar o token do cliente; padrão: localStorage */
  customer?: { get(): string | null; set(t: string | null): void };
  /** campanha do link (utm_campaign / utm_content): o anúncio decide o topo */
  campaign?: string;
  content?: string;
  /** só para teste: troca o tempo de "parado sem adicionar" dos pop-ups (segundos) */
  idleOverrideSeconds?: number;
}

/* ---------------- armazenamento seguro ---------------- */
const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};
const ss = {
  get(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type Screen = "menu" | "bag" | "checkout" | "pix" | "track";
interface Draft { itemId: string; sel: Record<string, Record<string, number>>; qty: number; notes: string[]; preset?: number; editKey?: string; tried: boolean }
interface Addr { postalCode: string; street: string; number: string; complement: string; district: string; city: string; state: string; reference: string }
interface Geo { ok: boolean; lat?: number; lng?: number; zone?: { name: string; fee: number; etaMin: number; etaMax: number }; reason?: string }
interface OnlineInfo { gateway: string; method: "pix" | "card"; status: "pending" | "paid" | "failed" | "expired" | "refunded"; pix?: { qrText: string; qrImage?: string; expiresAt: string }; card?: { brand?: string; last4?: string; installments?: number }; failureReason?: string; paidAt?: string }
interface TrackOrder { id: string; displayId: string; status: string; feedback?: { nps: number } | null; statusHistory: { status: string; at: string; note?: string }[]; total: number; cashbackEarned: number; mode: string; lines: PricedLine[]; payment?: { code: string; online?: OnlineInfo } }

const NOTE_CHIPS = ["Bem assada", "Cortar em 12", "Sem orégano", "Pouca cebola"];
const STATUS: Record<string, string> = { awaiting_payment: "Aguardando pagamento", payment_failed: "Pagamento não concluído", created: "Pedido recebido", sent_to_pos: "Enviado para a cozinha", pos_error: "Estamos confirmando com a loja", confirmed: "Confirmado pela loja", ready: "Pronto", dispatched: "Saiu para entrega", concluded: "Entregue", cancelled: "Cancelado" };
const FLOW = ["created", "sent_to_pos", "confirmed", "ready", "dispatched", "concluded"];

export function Storefront(props: StorefrontProps) {
  const { transport, slug, preview } = props;
  const custStore = useMemo(() => props.customer || { get: () => ls.get(`cw:cust:${slug}`), set: (t: string | null) => ls.set(`cw:cust:${slug}`, t) }, [props.customer, slug]);
  const [token, setTokenState] = useState<string | null>(() => custStore.get());
  const tokenRef = useRef(token); tokenRef.current = token;
  const setToken = (t: string | null) => { custStore.set(t); setTokenState(t); };
  // lead da primeira visita: só personaliza (nunca identifica); vira cliente ao confirmar o telefone
  const [leadId, setLeadIdState] = useState<string | null>(() => ls.get(`cw:lead:${slug}`));
  const leadRef = useRef(leadId); leadRef.current = leadId;
  const setLeadId = (id: string | null) => { ls.set(`cw:lead:${slug}`, id); leadRef.current = id; setLeadIdState(id); };
  const api = useMemo(() => createClient(transport, { customer: () => tokenRef.current, admin: preview ? props.adminToken : undefined, headers: (): Record<string, string> => (!tokenRef.current && leadRef.current ? { "x-lead-id": leadRef.current } : {}) }), [transport, preview, props.adminToken]);
  const q = preview ? "?preview=1" : "";
  const base = `/public/${slug}`;

  const [menu, setMenu] = useState<Menu | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [cart, setCart] = useState<CartLine[]>(() => { try { return JSON.parse(ls.get(`cw:cart:${slug}`) || "[]"); } catch { return []; } });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const [search, setSearch] = useState<{ open: boolean; q: string }>({ open: false, q: "" });
  const [page, setPage] = useState<Page | null>(null);
  const [popup, setPopup] = useState<MenuStrategy | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [couponCode, setCouponCode] = useState<string>(() => ss.get(`cw:coupon:${slug}`) || "");
  const [couponInput, setCouponInput] = useState("");
  const [mode, setMode] = useState<"DELIVERY" | "TAKEOUT">("DELIVERY");
  const [addr, setAddr] = useState<Addr>({ postalCode: "", street: "", number: "", complement: "", district: "", city: "Rio de Janeiro", state: "RJ", reference: "" });
  const [geo, setGeo] = useState<Geo | null>(null);
  const [pay, setPay] = useState<PaymentCode | null>(null);
  const [changeFor, setChangeFor] = useState("");
  const [cc, setCc] = useState<CardFields & { installments: number }>({ number: "", name: "", expiry: "", cvv: "", installments: 1 });
  const [cpf, setCpf] = useState("");
  const [useCashback, setUseCashback] = useState(false);
  const [ident, setIdent] = useState({ name: "", phone: "", code: "", sent: false, demoCode: "", optin: false, busy: false, err: "" });
  const [me, setMe] = useState<{ name?: string; phone?: string } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [helpShown, setHelpShown] = useState(false);
  const [activeCat, setActiveCat] = useState<string>("");
  const [exitVia, setExitVia] = useState<string | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [fvOpen, setFvOpen] = useState(false);
  const [oa, setOa] = useState<OnlineAuthState>(ONLINE_AUTH_INIT);
  const [bagGlow, setBagGlow] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [bump, setBump] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const bagbarRef = useRef<HTMLButtonElement>(null);
  const lastAddAt = useRef(Date.now());
  const lastAction = useRef(Date.now());
  const evq = useRef<{ name: string; ts: string; props?: Record<string, unknown> }[]>([]);
  const sessionId = useMemo(() => { const k = `cw:sid:${slug}`; let s = ss.get(k); if (!s) { s = "ses_" + rid(); ss.set(k, s); } return s; }, [slug]);
  const device = useMemo(() => (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop"), []);

  /* ---------------- eventos (lote a cada 2 s) ---------------- */
  const track = useCallback((name: string, p?: Record<string, unknown>) => { evq.current.push({ name, ts: new Date().toISOString(), props: p }); }, []);
  const fxv = useFxValue(slug, engageOf(menu)?.effects, track);
  useEffect(() => {
    const flush = () => {
      if (!evq.current.length) return;
      const events = evq.current.splice(0, 100);
      api.post(`${base}/events`, { sessionId, source: props.source, device, events }).catch(() => { /* telemetria não bloqueia a compra */ });
    };
    const t = setInterval(flush, 2000);
    const vis = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); flush(); };
  }, [api, base, sessionId, props.source, device]);

  /* ---------------- cardápio ---------------- */
  const loadMenu = useCallback(async () => {
    const qs = new URLSearchParams();
    if (props.storeId) qs.set("store", props.storeId);
    if (props.source) qs.set("source", props.source);
    if (props.campaign) qs.set("campaign", props.campaign);
    if (props.content) qs.set("content", props.content);
    if (preview) qs.set("preview", "1");
    try { const m = await api.get<Menu>(`${base}/menu?${qs}`); setMenu(m); setLoadErr(null); return m; }
    catch (e) { setLoadErr(e instanceof ApiError ? e.message : "Não foi possível abrir o cardápio"); return null; }
  }, [api, base, props.storeId, props.source, props.campaign, props.content, preview]);
  useEffect(() => { loadMenu().then((m) => { if (m) track("visit", { profile: m.profile, source: props.source }); }); }, [loadMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ls.set(`cw:cart:${slug}`, JSON.stringify(cart)); }, [cart, slug]);
  useEffect(() => { if (couponCode) ss.set(`cw:coupon:${slug}`, couponCode); }, [couponCode, slug]);
  useEffect(() => { if (menu?.store && !pay) setPay(menu.store.payments[0]?.code || null); if (menu?.store && !menu.store.modes.delivery) setMode("TAKEOUT"); }, [menu, pay]);
  useEffect(() => { if (!token) { setMe(null); return; } api.get<{ customer: { name?: string; phone?: string } }>(`${base}/me`).then((r) => setMe(r.customer)).catch(() => { setToken(null); }); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // marca: cores e fontes vêm do cadastro
  const brandStyle = useMemo(() => {
    const c = menu?.tenant.branding.colors;
    const s: Record<string, string> = {};
    if (c) { s["--b"] = c.brand; s["--b-deep"] = c.brandDeep; s["--b-soft"] = c.brandSoft; s["--a-ink"] = c.ink; }
    if (menu?.tenant.branding.fontDisplay) s["--brand-display"] = `"${menu.tenant.branding.fontDisplay}", "Arial Narrow", sans-serif`;
    if (menu?.tenant.branding.fontText) s["--brand-body"] = `"${menu.tenant.branding.fontText}", ui-sans-serif, system-ui, sans-serif`;
    return s as CSSProperties;
  }, [menu]);
  useEffect(() => {
    const b = menu?.tenant.branding; if (!b) return;
    const fams = [b.fontDisplay, b.fontText].filter(Boolean) as string[];
    if (!fams.length) return;
    const href = "https://fonts.googleapis.com/css2?" + fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`).join("&") + "&display=swap";
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
  }, [menu]);

  const photos = useMemo(() => (menu ? optionPhotos(menu) : {}), [menu]);
  const groupsOf = useCallback((itemId: string): OptionGroup[] => (menu ? (menu.items[itemId]?.groupIds || []).map((g) => menu.groups[g]).filter(Boolean) : []), [menu]);
  const priced = useMemo(() => (menu ? cart.filter((l) => menu.items[l.itemId]).map((l) => ({ line: l, p: priceLine(menu.items[l.itemId], groupsOf(l.itemId), { itemId: l.itemId, qty: l.qty, selection: l.selection, notes: l.notes }) })) : []), [cart, menu, groupsOf]);
  const subtotal = priced.reduce((a, x) => a + x.p.total, 0);
  const count = cart.reduce((a, l) => a + l.qty, 0);

  const showToast = (t: string) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), 2600); };

  /* ---------------- cotação autoritativa ---------------- */
  const addressForQuote = geo?.ok && geo.lat != null ? { ...addr, lat: geo.lat, lng: geo.lng } : undefined;
  useEffect(() => {
    if (!menu?.store || !cart.length) { setQuote(null); return; }
    const t = setTimeout(() => {
      const body = { storeId: menu.store!.id, mode, source: props.source, lines: cart.map(({ itemId, qty, selection, notes }) => ({ itemId, qty, selection, notes })), couponCode: couponCode || undefined, useCashback, address: mode === "DELIVERY" ? addressForQuote : undefined };
      api.post<QuoteResp>(`${base}/quote${q}`, body).then((r) => setQuote(r)).catch((e) => {
        if (e instanceof ApiError && couponCode && /cupom/i.test(e.message)) { track("coupon_error", { code: couponCode, reason: e.message }); showToast(e.message); setCouponCode(""); ss.set(`cw:coupon:${slug}`, ""); }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [cart, mode, couponCode, useCashback, geo, menu, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (quote?.coupon && !quote.coupon.ok && couponCode) track("coupon_error", { code: couponCode, reason: quote.coupon.reason }); }, [quote?.coupon?.ok, couponCode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- pop-up de cupom por comportamento ---------------- */
  useEffect(() => {
    if (!menu) return;
    const tick = setInterval(() => {
      if (screen !== "menu" || draft || search.open || page || popup || exitVia || triageOpen || fvOpen || (menu.firstVisit && !token) || fxv.couponOffered()) return;
      const shown = (s: MenuStrategy) => {
        const a = s.action as { frequency?: string };
        if (a.frequency === "day") return ls.get(`cw:pop:${s.id}`) === new Date().toISOString().slice(0, 10);
        if (a.frequency === "once") return !!ls.get(`cw:pop:${s.id}`);
        return !!ss.get(`cw:pop:${s.id}`);
      };
      const strategies = props.idleOverrideSeconds
        ? menu.strategies.map((s) => ({ ...s, conditions: s.conditions.map((c) => (c.field === "idle_seconds_without_add" ? { ...c, value: props.idleOverrideSeconds! } : c)) }))
        : menu.strategies;
      const ctx: StrategyContext = {
        now: new Date(), subtotal, lines: priced.map((x) => x.p), items: menu.items, customerOrders: menu.customer?.orders ?? 0,
        daysSinceLastOrder: menu.customer?.daysSinceLastOrder, segmentIds: [], source: props.source, mode, idleSecondsWithoutAdd: (Date.now() - lastAddAt.current) / 1000,
      };
      const pick = pickPopup(strategies, ctx, (s) => shown(s as MenuStrategy)) as MenuStrategy | undefined;
      const original = pick && menu.strategies.find((s) => s.id === pick.id);
      if (original && original.coupon?.code) {
        const a = original.action as { frequency?: string };
        if (a.frequency === "day") ls.set(`cw:pop:${original.id}`, new Date().toISOString().slice(0, 10));
        else if (a.frequency === "once") ls.set(`cw:pop:${original.id}`, "1");
        else ss.set(`cw:pop:${original.id}`, "1");
        setPopup(original); fxv.markCoupon(); track("popup_shown", { strategyId: original.id, code: original.coupon.code });
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [menu, screen, draft, search.open, page, popup, subtotal, priced, mode, props.source, props.idleOverrideSeconds, track, exitVia, triageOpen, fvOpen, token]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- hesitação na sacola e na revisão (uma ajuda, sem pop-up) ---------------- */
  useEffect(() => {
    if (!menu || helpShown || (screen !== "bag" && screen !== "checkout")) return;
    const t = setInterval(() => {
      if ((Date.now() - lastAction.current) / 1000 >= (menu.hesitationHelpSeconds || 12)) { setHelpShown(true); track("hesitation", { screen }); }
    }, 1000);
    return () => clearInterval(t);
  }, [menu, screen, helpShown, track]);
  const touch = () => { lastAction.current = Date.now(); };

  /* ---------------- navegação ---------------- */
  const go = (s: Screen) => {
    setScreen(s); touch();
    if (s === "bag") track("cart_view", { items: count });
    if (s === "checkout") track("checkout_start", { subtotal });
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-screen="${s}"]`)?.scrollTo({ top: 0 }));
  };

  const openItem = (itemId: string, editKey?: string, preset?: Record<string, Record<string, number>>) => {
    if (!menu?.items[itemId]) return;
    const line = editKey ? cart.find((l) => l.key === editKey) : undefined;
    const item = menu.items[itemId];
    const sel: Draft["sel"] = line ? JSON.parse(JSON.stringify(line.selection)) : preset ? JSON.parse(JSON.stringify(preset)) : {};
    if (!line) for (const g of groupsOf(itemId)) if (g.max === 1 && g.min === 1 && !sel[g.id]) { const d = g.options.find((o) => o.popular) || g.options[0]; if (d) sel[g.id] = { [d.id]: 1 }; }
    setDraft({ itemId, sel, qty: line?.qty || 1, notes: line?.notes ? line.notes.split(", ").filter((n) => NOTE_CHIPS.includes(n)) : [], editKey, tried: false });
    setSearch({ open: false, q: "" });
    track("item_view", { itemId, name: item.name });
  };

  const fly = (from: HTMLElement | null) => {
    setBump((b) => b + 1);
    if (!from || !rootRef.current || reduceMotion()) return;
    const r0 = rootRef.current.getBoundingClientRect(), a = from.getBoundingClientRect();
    const dot = document.createElement("span"); dot.className = "fly";
    dot.style.left = `${a.left - r0.left + a.width / 2 - 9}px`; dot.style.top = `${a.top - r0.top + a.height / 2 - 9}px`;
    rootRef.current.appendChild(dot);
    requestAnimationFrame(() => {
      const bb = bagbarRef.current?.getBoundingClientRect();
      const tx = bb ? bb.left - r0.left + 40 : r0.width / 2, ty = bb ? bb.top - r0.top + 18 : r0.height - 40;
      dot.style.transform = `translate(${tx - (a.left - r0.left + a.width / 2 - 9)}px, ${ty - (a.top - r0.top + a.height / 2 - 9)}px) scale(.5)`;
      dot.style.opacity = "0.2";
    });
    setTimeout(() => dot.remove(), 650);
  };

  const addLine = (l: Omit<CartLine, "key">, editKey?: string, from?: HTMLElement | null) => {
    setCart((c) => {
      if (editKey) return c.map((x) => (x.key === editKey ? { ...l, key: editKey } : x));
      const same = c.find((x) => x.itemId === l.itemId && JSON.stringify(x.selection) === JSON.stringify(l.selection) && (x.notes || "") === (l.notes || ""));
      if (same) return c.map((x) => (x === same ? { ...x, qty: x.qty + l.qty } : x));
      return [...c, { ...l, key: rid() }];
    });
    lastAddAt.current = Date.now(); touch();
    track("add_to_cart", { itemId: l.itemId, qty: l.qty });
    fly(from || null);
  };
  const quickAdd = (itemId: string, el: HTMLElement | null) => addLine({ itemId, qty: 1, selection: {} }, undefined, el);
  const setQty = (key: string, qty: number) => { touch(); setCart((c) => (qty <= 0 ? c.filter((x) => x.key !== key) : c.map((x) => (x.key === key ? { ...x, qty } : x)))); };

  const scrollToCat = (id: string) => {
    if (screen !== "menu") setScreen("menu");
    setPage(null);
    requestAnimationFrame(() => {
      const sc = menuRef.current, sec = sc?.querySelector<HTMLElement>(`#cat-${CSS.escape(id)}`);
      if (sc && sec) sc.scrollTo({ top: sec.offsetTop - 104, behavior: reduceMotion() ? "auto" : "smooth" });
    });
  };

  const openPage = async (pageId: string) => {
    const meta = menu?.pages.find((p) => p.id === pageId);
    if (!meta) { showToast("Página indisponível"); return; }
    try { setPage(await api.get<Page>(`${base}/pages/${meta.slug}`)); } catch (e) { showToast((e as Error).message); }
  };
  const followLink = (link: Banner["link"] | Extract<PageBlock, { kind: "cta" }>["link"]) => {
    switch (link.kind) {
      case "item": setPage(null); openItem(link.itemId); break;
      case "category": scrollToCat(link.categoryId); break;
      case "page": openPage(link.pageId); break;
      case "url": { const a = document.createElement("a"); a.href = link.url; a.target = "_blank"; a.rel = "noopener"; a.click(); break; }
    }
  };
  const openBanner = (b: Banner) => { track("banner_click", { bannerId: b.id, slot: b.slot }); followLink(b.link); };

  const applyCoupon = (code: string, via: string) => {
    setCouponCode(code.toUpperCase()); setCouponInput(code.toUpperCase());
    if (via === "popup") track("popup_coupon_applied", { code });
    showToast(`Cupom ${code.toUpperCase()} aplicado. Ele entra na revisão do pedido.`);
  };

  /* ---------------- rolagem do cardápio: pílula ativa e barra grudada ---------------- */
  const onMenuScroll = () => {
    const sc = menuRef.current; if (!sc || !menu) return;
    setStuck(sc.scrollTop > 330);
    let cur = menu.categories[0]?.id || "";
    for (const c of menu.categories) { const el = sc.querySelector<HTMLElement>(`#cat-${CSS.escape(c.id)}`); if (el && el.offsetTop - 130 <= sc.scrollTop) cur = c.id; }
    if (cur !== activeCat) setActiveCat(cur);
  };
  useEffect(() => { if (!activeCat || !rootRef.current) return; rootRef.current.querySelector(`[data-pill="${CSS.escape(activeCat)}"]`)?.scrollIntoView({ inline: "center", block: "nearest" }); }, [activeCat]);

  /* ---------------- engajamento: triagem, "antes de ir", volta ao app, frete quase grátis ---------------- */
  const triageQ = (menu as (Menu & EngageMenu) | null)?.triage;
  useEffect(() => {
    if (!triageQ || !token || screen !== "menu" || preview || ss.get(`cw:triage:${slug}:${(token || "").slice(-10)}`)) return;
    const t = setTimeout(() => setTriageOpen(true), 700); return () => clearTimeout(t);
  }, [triageQ, token, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  // primeira visita: abre logo ao entrar; quem veio de campanha só depois de N s sem adicionar (se a marca quiser)
  const fv = menu?.firstVisit;
  useEffect(() => {
    if (!fv || token || screen !== "menu" || preview || fvOpen) return;
    if (!fv.afterSeconds) { const t = setTimeout(() => setFvOpen(true), 900); return () => clearTimeout(t); }
    const t = setInterval(() => { if ((Date.now() - lastAddAt.current) / 1000 >= fv.afterSeconds && !draft) setFvOpen(true); }, 1000);
    return () => clearInterval(t);
  }, [fv, token, screen, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useExitAndReturn({
    slug, enabled: !!engageOf(menu)?.effects.exitIntent.enabled && !preview, menuReady: !!menu, cartCount: count,
    busy: !!draft || placing || screen === "pix" || screen === "track" || !!page || triageOpen || fvOpen || search.open,
    onExit: (via) => setExitVia(via),
    onReturn: () => { showToast("Sua sacola continua aqui"); setBagGlow(true); setTimeout(() => setBagGlow(false), 2800); },
  });
  const nudge = useNudge(quote?.progress, slug);

  /* ---------------- render ---------------- */
  if (loadErr && !menu) return (
    <div className="cw-sf" ref={rootRef} style={brandStyle}>
      <div className="screen"><div className="blk err-page"><h2>Cardápio indisponível</h2><p>{loadErr}</p><button className="btn-brand" onClick={() => loadMenu()}>Tentar de novo</button></div></div>
    </div>
  );
  if (!menu) return (
    <div className="cw-sf" ref={rootRef}>
      <div className="screen" aria-busy="true" aria-label="Carregando cardápio">
        <div className="sk" style={{ height: 178, borderRadius: 0 }} />
        <div className="blk"><div className="sk" style={{ height: 26, width: "55%" }} /><div className="sk" style={{ height: 14, width: "70%" }} />
          <div className="sk" style={{ height: 70 }} />{[0, 1, 2].map((i) => <div key={i} className="sk-row"><div className="sk" style={{ flex: 1, height: 72 }} /><div className="sk" style={{ width: 96, height: 96 }} /></div>)}</div>
      </div>
    </div>
  );

  const store = menu.store;
  const closed = !!store && !store.open && !preview;
  const nameOf = (id: string) => menu.items[id]?.name.split(" · ")[0] || "";
  const cardsInCart = (id: string) => cart.filter((l) => l.itemId === id).reduce((a, l) => a + l.qty, 0);

  const card = (id: string) => {
    const it = menu.items[id]; if (!it) return null;
    const simple = !it.groupIds.length; const n = cardsInCart(id);
    const line = simple ? cart.find((l) => l.itemId === id && !Object.keys(l.selection).length) : undefined;
    return (
      <div className="card" key={id} data-id={id}>
        <button className="tap info" onClick={() => openItem(id)} aria-label={`Abrir ${it.name}`}>
          <span className="nm">{it.name}{(it as { avoidHit?: string }).avoidHit && <span className="chip-avoid">tem {(it as { avoidHit?: string }).avoidHit!.toLowerCase()}</span>}</span>
          {it.description && <span className="ds">{it.description}</span>}
          <span className="pr">{it.fromPrice ? "a partir de " : ""}{brl(shownPrice(it))}{it.compareAt ? <s>{brl(it.compareAt)}</s> : null}</span>
          {(it.likes || it.serves || it.tags?.length) && <span className="proof">{it.likes && <>👍 {it.likes.pct}% ({it.likes.n})</>}{it.tags?.slice(0, 1).map((t) => <span key={t} className="badge1">{t}</span>)}{it.serves && <span>· {it.serves}</span>}</span>}
        </button>
        <div className="thumb">
          <ItemArt item={it} photos={photos} />
          <span className={`qtyb${n ? " show" : ""}`} aria-hidden="true">{n}</span>
          {simple && (line ? (
            <span className="qadd exp" role="group" aria-label={`Quantidade de ${it.name}`}>
              <button onClick={() => setQty(line.key, line.qty - 1)} aria-label="Diminuir">−</button><b>{line.qty}</b><button onClick={(e) => { setQty(line.key, line.qty + 1); fly(e.currentTarget); lastAddAt.current = Date.now(); track("add_to_cart", { itemId: id, qty: 1 }); }} aria-label="Aumentar">+</button>
            </span>
          ) : <button className="qadd" onClick={(e) => quickAdd(id, e.currentTarget)} aria-label={`Adicionar ${it.name}`}>+</button>)}
        </div>
      </div>
    );
  };

  /* ----- busca ----- */
  const results = (() => {
    const t = search.q.trim().toLowerCase(); if (t.length < 2) return [];
    const nn = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const T = nn(t);
    return Object.values(menu.items).map((it) => {
      if (nn(it.name).includes(T) || nn(it.description || "").includes(T)) return { it, via: "" };
      const opt = groupsOf(it.id).flatMap((g) => g.options).find((o) => nn(o.name).includes(T));
      return opt ? { it, via: opt.name } : null;
    }).filter(Boolean) as { it: MenuItem; via: string }[];
  })();

  return (
    <EngageCtx.Provider value={fxv}>
    <div className={`cw-sf${stuck ? " is-stuck" : ""}`} ref={rootRef} style={brandStyle} onPointerDown={touch}>
      {/* ================= cardápio ================= */}
      <div className={`screen${screen === "menu" ? "" : " off-left"}`} data-screen="menu" ref={menuRef} onScroll={onMenuScroll} aria-hidden={screen !== "menu"}>
        <div className="cover">
          {menu.tenant.branding.coverUrl ? <img className="cover-img" src={menu.tenant.branding.coverUrl} alt={`Pizzas da ${menu.tenant.name}`} /> : <span className="cover-fill" />}
          <button className="lupa lupa-cover" onClick={() => setSearch({ open: true, q: "" })} aria-label="Buscar no cardápio"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
        </div>
        <div className="store-head">
          <div className="row">
            <div className="logo" role="img" aria-label={menu.tenant.name} style={menu.tenant.branding.logoUrl ? { backgroundImage: `url(${menu.tenant.branding.logoUrl})` } : undefined}>{menu.tenant.branding.logoUrl ? null : menu.tenant.name.slice(0, 2).toUpperCase()}</div>
            <div className="nmwrap">
              <span className="store-name">{menu.tenant.name}</span>
              <span className="store-sub">Pizza · {store?.name || ""} · {store?.open || preview ? <span className="open-pill">Aberto</span> : <span className="closed-pill">Fechado</span>}</span>
            </div>
          </div>
          {closed && store && <div className="closed-bar" role="status">Fechado agora · {nextOpening(store.hours)}. Você pode montar a sacola e pedir quando abrir.</div>}
          {store && (
            <div className="facts">
              <div className="fact"><span>Chega em</span><b>{store.eta ? `${store.eta[0]}–${store.eta[1]} min` : "—"}</b></div>
              <div className="fact"><span>Modos</span><b>{store.modes.delivery && store.modes.takeout ? "Entrega e retirada" : store.modes.delivery ? "Entrega" : "Retirada"}</b></div>
              {menu.loyalty && <div className="fact"><span>Cashback</span><b>{menu.loyalty.earnPercent}% de volta</b></div>}
            </div>
          )}
          {store && <div className="pay"><span className="muted">Aceita</span>{store.payments.map((p) => <i key={p.code}>{p.label}</i>)}{menu.tenant.settings.priceParity && <span className="parity">· mesmo preço do balcão</span>}</div>}
          {menu.customer?.wallet && menu.customer.wallet.balance > 0 && <div className="benefit">Você tem {brl(menu.customer.wallet.balance)} de cashback para usar.</div>}
        </div>

        {menu.banners.menu_top && <div className="slot slot-top"><BannerView banner={menu.banners.menu_top} onOpen={openBanner} /></div>}

        {menu.hero && (menu.hero.action.kind === "reorder" ? (
          <div className="reorder" id="t-hero"><small>{menu.hero.kicker}</small><b>{menu.hero.title}</b>{menu.hero.sub && <span>{menu.hero.sub}</span>}
            <button onClick={(e) => { const ls0 = (menu.hero!.action as { lines: CartLineInput[] }).lines.filter((l) => menu.items[l.itemId]); ls0.forEach((l) => addLine({ itemId: l.itemId, qty: l.qty, selection: (l.selection || {}) as CartLine["selection"], notes: l.notes }, undefined, e.currentTarget)); showToast("Pedido de sempre na sacola"); }}>Pedir de novo</button>
          </div>
        ) : (
          <div className={`hero-card${(menu.hero as { personal?: boolean }).personal ? " personal" : ""}`} id="t-hero">
            <div className="t"><small>{menu.hero.kicker}</small><b>{menu.hero.title}</b>{menu.hero.sub && <span className="p">{menu.hero.sub}</span>}</div>
            {menu.hero.action.kind === "category"
              ? <button className="btn-brand" onClick={() => { track("hero_click", { kind: "category" }); scrollToCat((menu.hero!.action as { categoryId: string }).categoryId); }}>Ver</button>
              : <button className="btn-brand" onClick={() => { const a = menu.hero!.action as { itemId: string; selection?: Record<string, Record<string, number>> }; track("hero_click", { kind: "item", itemId: a.itemId, campaign: menu.hero!.campaign }); openItem(a.itemId, undefined, a.selection); }}>{(menu.hero.action as { selection?: unknown }).selection ? "Pedir este" : "Montar"}</button>}
          </div>
        ))}

        {menu.banners.below_suggested && <div className="slot"><BannerView banner={menu.banners.below_suggested} onOpen={openBanner} /></div>}

        <div className={`sticky-nav${stuck ? " stuck" : ""}`}>
          <div className="pills" role="tablist" aria-label="Categorias">
            {menu.categories.map((c, i) => <button key={c.id} role="tab" data-pill={c.id} aria-selected={(activeCat || menu.categories[0].id) === c.id} className={`pill${(activeCat || (i === 0 ? c.id : "")) === c.id ? " on" : ""}`} onClick={() => scrollToCat(c.id)}>{c.name.split(" ·")[0]}</button>)}
          </div>
          <button className="lupa lupa-nav" onClick={() => setSearch({ open: true, q: "" })} aria-label="Buscar no cardápio"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
        </div>

        {menu.mostOrdered && menu.mostOrdered.itemIds.length > 0 && (
          <div className="sec"><h2>{menu.mostOrdered.title}</h2>
            <div className="carousel">{menu.mostOrdered.itemIds.map((id, i) => menu.items[id] && (
              <button key={id} className="mini tap" onClick={() => openItem(id)}>
                <div className="ph"><span className="tag-pos">#{i + 1}</span><ItemArt item={menu.items[id]} photos={photos} /></div>
                <span className="nm">{nameOf(id)}</span><span className="pr">{menu.items[id].fromPrice ? "a partir de " : ""}{brl(shownPrice(menu.items[id]))}</span>
              </button>))}
            </div>
          </div>
        )}
        {menu.categories.map((c) => (
          <section key={c.id} className="sec" id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`}>
            <h2 id={`h-${c.id}`}>{c.name}</h2>{c.description && <div className="sec-sub">{c.description}</div>}
            {c.itemIds.map(card)}
          </section>
        ))}
        <div className="footer-note"><span>{menu.tenant.settings.legalName || menu.tenant.name}{menu.tenant.settings.cnpj ? ` · CNPJ ${menu.tenant.settings.cnpj}` : ""}</span>{store?.phone && <span>Atendimento: +{store.phone}</span>}</div>
        {count > 0 && (
          <button ref={bagbarRef} key={bump} className={`bagbar show${bump ? " bump" : ""}${bagGlow || nudge.on ? " fx-glow" : ""}`} onClick={() => go("bag")}>
            <span className="bb-l"><span className="cnt">{count}</span><span>Ver sacola{quote?.progress && <small className="bb-prog">Faltam {brl(quote.progress.missing)} {quote.progress.label}</small>}</span></span>
            <span>{brl(subtotal)}</span>
          </button>
        )}
      </div>

      {/* ================= sacola ================= */}
      <div className={`screen${screen === "bag" ? "" : screen === "menu" ? " off-right" : " off-left"}`} data-screen="bag" aria-hidden={screen !== "bag"} onScroll={touch}>
        <div className="app-hd"><button className="back" onClick={() => go("menu")} aria-label="Voltar ao cardápio">←</button><div><h2>Sua sacola</h2><span>{menu.tenant.name} · {store?.name}</span></div></div>
        {!cart.length ? (
          <div className="blk empty"><b>Sua sacola está vazia</b><button className="btn-brand" onClick={() => go("menu")}>Ver o cardápio</button></div>
        ) : (<>
          {quote?.progress && <div className="blk"><Progress p={quote.progress} cls={`${nudge.near ? " near" : ""}${nudge.on ? " fx-nudge" : ""}`} /></div>}
          {quote && quote.deliveryFee === 0 && quote.baseDeliveryFee > 0 && quote.deliveryLabel && <div className="blk"><div className="benefit">{quote.deliveryLabel} <s>{brl(quote.baseDeliveryFee)}</s></div></div>}
          {helpShown && <div className="blk"><div className="inline-help">Ficou com dúvida? O total aparece na revisão, sem surpresa, e o Pix é aprovado na hora. Pode editar qualquer item tocando em Editar.</div></div>}
          <div className="blk lines">
            {priced.map(({ line, p }) => {
              const it = menu.items[line.itemId];
              return (
                <div className="line" key={line.key}>
                  <div className="thumb"><LineArt item={it} line={p} photos={photos} groups={groupsOf(it.id)} /></div>
                  <div className="c">
                    <b>{line.qty > 1 ? `${line.qty}× ` : ""}{it.name}</b>
                    {p.choices.length > 0 && <span>{p.choices.map((c) => (c.fraction && c.fraction !== "inteira" ? `${c.fraction} ${c.name}` : c.qty > 1 ? `${c.qty}× ${c.name}` : c.name)).join(" · ")}</span>}
                    {line.notes && <span className="note">“{line.notes}”</span>}
                    <span className="acts">
                      {it.groupIds.length > 0 ? <button className="link" onClick={() => openItem(it.id, line.key)}>Editar</button> : (
                        <span className="step"><button onClick={() => setQty(line.key, line.qty - 1)} aria-label="Diminuir">−</button><b>{line.qty}</b><button onClick={() => setQty(line.key, line.qty + 1)} aria-label="Aumentar">+</button></span>
                      )}
                      <button className="link muted" onClick={() => setQty(line.key, 0)}>Remover</button>
                    </span>
                  </div>
                  <span className="lp-price">{brl(p.total)}</span>
                </div>
              );
            })}
          </div>
          <CrossSell menu={menu} cart={cart} photos={photos} onAdd={(id, el) => (menu.items[id].groupIds.length ? openItem(id) : quickAdd(id, el))} />
          {menu.banners.bag && <div className="slot"><BannerView banner={menu.banners.bag} onOpen={openBanner} /></div>}
          {menu.loyalty && quote && quote.cashbackEarned > 0 && <div className="blk"><div className="benefit">Neste pedido você ganha {brl(quote.cashbackEarned)} de cashback.</div></div>}
          <div className="blk">
            <dl className="totals">
              <dt>Subtotal</dt><dd>{brl(subtotal)}</dd>
              {mode === "DELIVERY" && quote && <><dt>Entrega</dt><dd>{quote.deliveryFee === 0 && quote.baseDeliveryFee > 0 ? <><s className="muted">{brl(quote.baseDeliveryFee)}</s> Grátis</> : brl(quote.deliveryFee)}</dd></>}
              {quote && quote.discount > 0 && <><dt>Cupom</dt><dd className="okv">− {brl(quote.discount)}</dd></>}
            </dl>
          </div>
          <div className="foot-cta"><button className="cta" onClick={() => go("checkout")}><span>Revisar pedido</span><span>{brl(subtotal)}</span></button></div>
        </>)}
      </div>

      {/* ================= revisão e pagamento ================= */}
      <div className={`screen${screen === "checkout" ? "" : screen === "menu" || screen === "bag" ? " off-right" : " off-left"}`} data-screen="checkout" aria-hidden={screen !== "checkout"} onScroll={touch}>
        <div className="app-hd"><button className="back" onClick={() => go("bag")} aria-label="Voltar à sacola">←</button><div><h2>Revisão</h2><span>{count} {count === 1 ? "item" : "itens"} · {brl(subtotal)}</span></div></div>
        {store && cart.length > 0 && (<>
          {(store.modes.delivery && store.modes.takeout) && (
            <div className="blk"><div className="seg2" role="radiogroup" aria-label="Como receber">
              <button role="radio" aria-checked={mode === "DELIVERY"} className={mode === "DELIVERY" ? "on" : ""} onClick={() => setMode("DELIVERY")}>Entrega</button>
              <button role="radio" aria-checked={mode === "TAKEOUT"} className={mode === "TAKEOUT" ? "on" : ""} onClick={() => setMode("TAKEOUT")}>Retirar na loja</button>
            </div></div>
          )}
          {mode === "DELIVERY" ? (
            <AddressForm addr={addr} setAddr={(a) => { setAddr(a); touch(); }} geo={geo} onLocate={async (a) => {
              if (a.district.trim().length < 3) return;
              try {
                const r = await api.post<Geo>(`${base}/geocode${q}`, { storeId: store.id, ...a });
                setGeo(r); if (!r.ok) track("out_of_area", { district: a.district });
              } catch (e) { setGeo({ ok: false, reason: (e as Error).message }); }
            }} />
          ) : (
            <div className="blk"><h4>Retirada</h4><p className="muted">{store.address.street}, {store.address.number} · {store.address.district}</p></div>
          )}

          <div className="blk"><h4>Pagamento</h4>
            {store.payments.map((p) => (
              <button key={p.code} className={`payopt${pay === p.code ? " on" : ""}`} role="radio" aria-checked={pay === p.code} onClick={() => { setPay(p.code); touch(); }}>
                <span className={`radio${pay === p.code ? " on" : ""}`} aria-hidden="true" /><div><b>{p.label}</b><small>{p.code === "CARD_ONLINE" ? "Pague agora, com aprovação na hora" : p.online ? "Aprovado na hora, pelo app do banco" : "Pague na entrega ou na retirada"}</small></div>
              </button>
            ))}
            {pay === "CARD_ONLINE" && menu.onlinePayments && <CardForm card={cc} setCard={setCc} max={menu.onlinePayments.maxInstallments} total={quote?.total || 0} />}
            {(pay === "CARD_ONLINE" || pay === "PIX_ONLINE") && menu.onlinePayments?.requiresDocument && oa.status !== "new" && (pay === "PIX_ONLINE" ? menu.onlinePayments.gateway !== "mercadopago" : true) && <div className="field"><label htmlFor="cw-cpf">CPF do pagador</label><input id="cw-cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(fmtCpf(e.target.value))} />{cpf.length >= 14 && !validCpf(cpf) && <span className="err">CPF inválido</span>}</div>}
            {pay === "CASH" && <div className="field"><label htmlFor="cw-change">Troco para quanto?</label><input id="cw-change" inputMode="decimal" placeholder="Ex.: 200" value={changeFor} onChange={(e) => setChangeFor(e.target.value.replace(/[^\d,.]/g, ""))} /></div>}
          </div>

          {(pay === "CARD_ONLINE" || pay === "PIX_ONLINE") && menu.onlinePayments?.requirePassword && me && token && (
            <OnlineAuth key={token} api={api} base={base} phone={me.phone} state={oa} setState={(x) => { setOa(x); if (x.status === "new" && x.cpf !== cpf) setCpf(x.cpf); }} />
          )}

          <div className="blk"><h4>Cupom</h4>
            <div className="coupon-row">
              <input id="cw-coupon" aria-label="Código do cupom" placeholder="Código do cupom" value={couponInput || couponCode} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} />
              {couponCode ? <button className="link" onClick={() => { setCouponCode(""); setCouponInput(""); ss.set(`cw:coupon:${slug}`, ""); }}>Remover</button> : <button className="btn-ghost" onClick={() => couponInput.trim() && applyCoupon(couponInput.trim(), "checkout")}>Aplicar</button>}
            </div>
            {quote?.coupon && couponCode && (quote.coupon.ok ? <span className="okline">✓ {quote.coupon.name}{quote.coupon.discount ? ` · − ${brl(quote.coupon.discount)}` : ""}</span> : <span className="err">{quote.coupon.reason}</span>)}
          </div>

          {quote && quote.cashbackAvailable > 0 && (
            <div className="blk"><label className="check"><input type="checkbox" id="cw-cb" checked={useCashback} onChange={(e) => setUseCashback(e.target.checked)} /><span>Usar {brl(quote.cashbackAvailable)} do meu cashback</span></label></div>
          )}

          <div className="blk"><h4>Seus dados</h4>
            {me && token ? (
              <div className="ident-ok"><span>Pedindo como <b>{me.name || "você"}</b> · +{me.phone}</span><button className="link" onClick={() => { setToken(null); setIdent((s) => ({ ...s, sent: false, code: "" })); }}>Trocar</button></div>
            ) : (<>
              <div className="field"><label htmlFor="cw-name">Nome</label><input id="cw-name" autoComplete="name" value={ident.name} onChange={(e) => setIdent({ ...ident, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="cw-phone">Celular com DDD</label><input id="cw-phone" inputMode="tel" autoComplete="tel" placeholder="(21) 99999-9999" value={ident.phone} onChange={(e) => setIdent({ ...ident, phone: e.target.value })} /></div>
              {!ident.sent ? (
                <button className="btn-ghost" disabled={ident.busy || ident.phone.replace(/\D/g, "").length < 10 || ident.name.trim().length < 2} onClick={async () => {
                  setIdent((s) => ({ ...s, busy: true, err: "" }));
                  try { const r = await api.post<{ demoCode?: string }>(`${base}/auth/otp`, { phone: ident.phone }); setIdent((s) => ({ ...s, sent: true, demoCode: r.demoCode || "", busy: false })); }
                  catch (e) { setIdent((s) => ({ ...s, busy: false, err: (e as Error).message })); }
                }}>Receber código no WhatsApp</button>
              ) : (<>
                <div className="field"><label htmlFor="cw-code">Código enviado pelo WhatsApp</label><input id="cw-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={ident.code} onChange={(e) => setIdent({ ...ident, code: e.target.value.replace(/\D/g, "") })} />{ident.demoCode && <small className="muted">Demonstração: o código é {ident.demoCode}</small>}</div>
                <label className="check"><input type="checkbox" id="cw-optin" checked={ident.optin} onChange={(e) => setIdent({ ...ident, optin: e.target.checked })} /><span>Quero receber avisos do pedido e ofertas da {menu.tenant.name} no WhatsApp</span></label>
                <button className="btn-ghost" disabled={ident.busy || ident.code.length < 4} onClick={async () => {
                  setIdent((s) => ({ ...s, busy: true, err: "" }));
                  try { const r = await api.post<{ token: string }>(`${base}/auth/verify`, { phone: ident.phone, code: ident.code, name: ident.name, optinWhatsapp: ident.optin, leadId: leadId || undefined }); setToken(r.token); setLeadId(null); setIdent((s) => ({ ...s, busy: false })); }
                  catch (e) { setIdent((s) => ({ ...s, busy: false, err: (e as Error).message })); }
                }}>Confirmar código</button>
              </>)}
              {ident.err && <span className="err" role="alert">{ident.err}</span>}
            </>)}
          </div>

          {helpShown && <div className="blk"><div className="inline-help">O total abaixo é o que você paga. Nada muda depois.</div></div>}

          {quote && (
            <div className="blk"><h4>Resumo</h4>
              <dl className="totals">
                <dt>Subtotal</dt><dd>{brl(quote.subtotal)}</dd>
                {quote.discount > 0 && <><dt>Cupom</dt><dd className="okv">− {brl(quote.discount)}</dd></>}
                {quote.cashbackUsed > 0 && <><dt>Cashback</dt><dd className="okv">− {brl(quote.cashbackUsed)}</dd></>}
                {mode === "DELIVERY" && <><dt>Entrega{quote.deliveryLabel ? ` · ${quote.deliveryLabel}` : ""}</dt><dd>{quote.deliveryFee === 0 && quote.baseDeliveryFee > 0 ? <><s className="muted">{brl(quote.baseDeliveryFee)}</s> Grátis</> : brl(quote.deliveryFee)}</dd></>}
                {quote.fees.map((f) => <FeeRow key={f.label} label={f.label} amount={f.amount} />)}
                <dt className="t">Total</dt><dd className="t">{brl(quote.total)}</dd>
              </dl>
              {quote.cashbackEarned > 0 && <span className="okline">Você ganha {brl(quote.cashbackEarned)} de cashback quando o pedido for entregue.</span>}
            </div>
          )}
          {orderErr && <div className="blk"><p className="err" role="alert">{orderErr}</p></div>}
          <div className="foot-cta">
            {(() => {
              const needAddr = mode === "DELIVERY" && !(geo?.ok && addr.street && addr.number);
              const needId = !(me && token);
              const op = menu.onlinePayments;
              const needDoc = !!op?.requiresDocument && (pay === "CARD_ONLINE" || (pay === "PIX_ONLINE" && op.gateway !== "mercadopago")) && !validCpf(cpf);
              const cardErr = pay === "CARD_ONLINE" ? validateCard(cc) : null;
              const needAuth = (pay === "CARD_ONLINE" || pay === "PIX_ONLINE") && !!op?.requirePassword && !needId && !onlineAuthReady(oa);
              const label = closed ? "Loja fechada agora" : needAddr ? "Informe o endereço" : needId ? "Confirme seu telefone" : !pay ? "Escolha o pagamento" : cardErr ? "Preencha o cartão" : needDoc ? "Informe o CPF" : needAuth ? (oa.status === "new" ? "Confirme CPF, nascimento e senha" : "Digite sua senha") : placing ? (pay === "CARD_ONLINE" ? "Processando pagamento…" : "Enviando…") : pay === "CARD_ONLINE" ? "Pagar e fazer pedido" : "Fazer pedido";
              const blocked = closed || needAddr || needId || !pay || !!cardErr || needDoc || needAuth || placing || !quote;
              return (
                <button className={`cta${blocked ? " blocked" : ""}`} disabled={blocked} onClick={async () => {
                  setPlacing(true); setOrderErr(null);
                  try {
                    // senha só no pagamento online: token curto antes de cobrar
                    let ot: string | undefined;
                    if ((pay === "CARD_ONLINE" || pay === "PIX_ONLINE") && op?.requirePassword) {
                      try { ot = await onlineToken(api, base, oa); }
                      catch (e) { setOa({ ...oa, err: (e as Error).message }); setOrderErr((e as Error).message); return; }
                      if (oa.status === "new" || oa.status === "reset") setOa({ ...oa, status: "existing", password: "", code: "" });
                    }
                    let cardPay: { cardToken: string; installments: number; cardBrand: string; cardLast4: string; issuerId?: string } | undefined;
                    if (pay === "CARD_ONLINE" && op) {
                      const t = await tokenizeCard(op, { ...cc, document: cpf || undefined });
                      cardPay = { cardToken: t.token, installments: cc.installments, cardBrand: t.brand, cardLast4: t.last4, issuerId: t.issuerId };
                    }
                    const body = {
                      storeId: store.id, sessionId, source: props.source, mode,
                      lines: cart.map(({ itemId, qty, selection, notes }) => ({ itemId, qty, selection, notes })),
                      address: mode === "DELIVERY" ? { ...addr, complement: addr.complement || undefined, reference: addr.reference || undefined, lat: geo?.lat, lng: geo?.lng } : undefined,
                      payment: { code: pay!, changeFor: pay === "CASH" && changeFor ? Number(changeFor.replace(",", ".")) : undefined, ...cardPay },
                      customerDocument: (pay === "CARD_ONLINE" || pay === "PIX_ONLINE") && cpf ? cpf.replace(/\D/g, "") : undefined,
                      couponCode: couponCode || undefined, useCashback,
                      customer: { name: me?.name || ident.name, phone: me?.phone || ident.phone, optinWhatsapp: ident.optin || undefined },
                    };
                    const r = await api.post<{ order: TrackOrder; customerToken: string }>(`${base}/orders${q}`, body, ot ? { "x-online-token": ot } : undefined);
                    if (cardPay) setCc({ number: "", name: "", expiry: "", cvv: "", installments: 1 });
                    setToken(r.customerToken); setOrder(r.order); setCart([]); setCouponCode(""); ss.set(`cw:coupon:${slug}`, ""); setUseCashback(false);
                    go(r.order.payment?.online ? (r.order.payment.online.method === "pix" ? "pix" : "track") : pay === "PIX_ONLINE" ? "pix" : "track");
                  } catch (e) {
                    if (e instanceof CardError) { setOrderErr(e.message); return; }
                    if (e instanceof ApiError && e.status === 402) { setOrderErr(`Pagamento recusado: ${e.message}`); track("payment_declined", { reason: e.message }); return; }
                    const msg = e instanceof ApiError ? (Array.isArray(e.details) && (e.details as { issues?: { message: string }[] }[])[0]?.issues?.[0]?.message) || e.message : "Não conseguimos enviar o pedido. Tente de novo.";
                    setOrderErr(String(msg));
                  } finally { setPlacing(false); }
                }}><span>{label}</span><span>{quote ? brl(quote.total) : ""}</span></button>
              );
            })()}
          </div>
        </>)}
      </div>

      {/* ================= Pix ================= */}
      <div className={`screen${screen === "pix" ? "" : screen === "track" ? " off-left" : " off-right"}`} data-screen="pix" aria-hidden={screen !== "pix"}>
        <div className="app-hd"><div><h2>Pague com Pix</h2><span>Pedido #{order?.displayId}</span></div></div>
        {order && screen === "pix" && <PixPay api={api} base={base} order={order} setOrder={setOrder} onPaid={() => go("track")} onCopy={() => showToast("Código Pix copiado")} />}
      </div>

      {/* ================= acompanhamento ================= */}
      <div className={`screen${screen === "track" ? "" : " off-right"}`} data-screen="track" aria-hidden={screen !== "track"}>
        <div className="app-hd"><div><h2>Pedido #{order?.displayId}</h2><span>{menu.tenant.name}</span></div></div>
        {order && screen === "track" && <Tracking api={api} base={base} order={order} setOrder={setOrder} />}
        {order && screen === "track" && <FeedbackCard menu={menu} api={api} base={base} sessionId={sessionId} order={order} />}
        {menu.banners.after_order && <div className="slot"><BannerView banner={menu.banners.after_order} onOpen={openBanner} /></div>}
        <div className="blk"><button className="btn-ghost" onClick={() => { setOrder(null); setHelpShown(false); loadMenu(); go("menu"); }}>Voltar ao cardápio</button></div>
      </div>

      {/* ================= folha do item ================= */}
      <div className={`overlay${draft ? " on" : ""}`} onClick={() => setDraft(null)} aria-hidden="true" />
      {draft && menu.items[draft.itemId] && (
        <ItemSheet key={draft.itemId + (draft.editKey || "")} menu={menu} draft={draft} setDraft={setDraft} groups={groupsOf(draft.itemId)} photos={photos} shake={shake}
          onShake={(gid) => { setShake(gid); setTimeout(() => setShake(null), 500); }}
          onClose={() => setDraft(null)}
          onAdd={(el) => { addLine({ itemId: draft.itemId, qty: draft.qty, selection: draft.sel, notes: draft.notes.join(", ") || undefined }, draft.editKey, el); setDraft(null); if (draft.editKey) showToast("Item atualizado"); }} />
      )}

      {/* ================= busca (lupa) ================= */}
      {search.open && (
        <div className="screen search-ov" role="dialog" aria-label="Buscar no cardápio">
          <div className="search-hd">
            <button className="back" onClick={() => setSearch({ open: false, q: "" })} aria-label="Fechar busca">←</button>
            <input autoFocus id="cw-search" aria-label="Buscar no cardápio" placeholder="Sabor, pizza, bebida…" value={search.q} onChange={(e) => setSearch({ open: true, q: e.target.value })}
              onBlur={() => { if (search.q.trim().length >= 2) track(results.length ? "search" : "search_no_result", { q: search.q.trim(), n: results.length }); }} />
          </div>
          <div className="search-res">
            {search.q.trim().length < 2 ? <p className="muted">Digite pelo menos duas letras. Dá para buscar pelo sabor: “calabresa”, “catupiry”, “banana”.</p>
              : results.length ? results.map(({ it, via }) => (
                <button key={it.id} className="sres tap" onClick={() => { track("search", { q: search.q.trim(), n: results.length, picked: it.id }); openItem(it.id); }}>
                  <span className="thumb sm"><ItemArt item={it} photos={photos} /></span>
                  <span className="c"><b>{it.name}</b><span>{via ? `tem a opção ${via}` : it.description}</span></span>
                  <span className="pr">{it.fromPrice ? "a partir de " : ""}{brl(shownPrice(it))}</span>
                </button>
              )) : <p className="muted">Nada com “{search.q.trim()}”. Tente outro sabor.</p>}
          </div>
        </div>
      )}

      {/* ================= página dedicada ================= */}
      {page && (
        <PageView page={page} menu={menu} photos={photos}
          couponCodeFor={(cid) => menu.strategies.find((s) => s.coupon?.id === cid)?.coupon?.code}
          onClose={() => setPage(null)} onOpenItem={(id) => { setPage(null); openItem(id); }} onLink={followLink}
          onApplyCoupon={(code) => applyCoupon(code, "page")}
          onSubmit={async (answers) => { const r = await api.post<{ thankYou: string }>(`${base}/pages/${page.slug}/responses`, { sessionId, answers }); return r.thankYou; }} />
      )}

      {/* ================= pop-up de cupom ================= */}
      {popup && popup.action.kind === "popup_coupon" && (
        <div className={`popup pos-${popup.action.position}`} role="dialog" aria-label={popup.action.title}>
          <button className="pop-x" onClick={() => setPopup(null)} aria-label="Fechar">×</button>
          <b>{popup.action.title}</b>
          <span>{popup.action.text}</span>
          {popup.coupon?.code && <code>{popup.coupon.code}</code>}
          <div className="pop-acts"><button className="btn-brand" onClick={() => { applyCoupon(popup.coupon!.code!, "popup"); setPopup(null); }}>Aplicar</button><button className="link muted" onClick={() => setPopup(null)}>Agora não</button></div>
        </div>
      )}

      {/* ================= primeira visita ================= */}
      {fvOpen && fv && !token && (
        <FirstVisitSheet fv={fv} brand={menu.tenant.name} api={api} base={base} sessionId={sessionId} source={props.source} campaign={props.campaign} leadId={leadId}
          onLead={(id) => setLeadId(id)} track={track}
          onApply={(code) => { fxv.markCoupon(); applyCoupon(code, "firstvisit"); }}
          onClose={(r: FvResult | null) => { setFvOpen(false); if (r && !r.skipped) loadMenu().then(() => menuRef.current?.scrollTo({ top: 0 })); else loadMenu(); }} />
      )}

      {/* ================= triagem de 1 toque ================= */}
      {triageOpen && triageQ && screen === "menu" && (
        <TriageSheet q={triageQ} name={menu.customer?.name || me?.name} api={api} base={base} sessionId={sessionId}
          onDone={(msg, answered) => { ss.set(`cw:triage:${slug}:${(token || "").slice(-10)}`, "1"); setTriageOpen(false); if (answered) { loadMenu().then(() => menuRef.current?.scrollTo({ top: 0 })); if (msg) showToast(msg); } }} />
      )}

      {/* ================= antes de ir ================= */}
      {exitVia && engageOf(menu) && (
        <ExitSheet fx={engageOf(menu)!.effects} cartCount={count} subtotal={subtotal} name={menu.tenant.name}
          onApply={(code) => { applyCoupon(code, "exit"); setExitVia(null); if (count) go("bag"); }}
          onStay={() => { setExitVia(null); if (count && screen === "menu") { setBagGlow(true); setTimeout(() => setBagGlow(false), 2800); } }}
          onLeave={() => { const v = exitVia; setExitVia(null); if (v === "back") { try { history.back(); } catch { /* sem history */ } } }} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
    </EngageCtx.Provider>
  );
}

/* ================= pedaços ================= */

function Progress({ p, cls = "" }: { p: NonNullable<QuoteResp["progress"]>; cls?: string }) {
  return (
    <div className={`prog${cls}`}><span>Faltam {brl(p.missing)} {p.label}</span><span className="tr" aria-hidden="true"><i style={{ width: `${p.pct}%` }} /></span></div>
  );
}

function FeeRow({ label, amount }: { label: string; amount: number }) {
  return <><dt>{label}</dt><dd>{brl(amount)}</dd></>;
}

function LineArt({ item, line, photos, groups }: { item: MenuItem; line: PricedLine; photos: Record<string, string>; groups: OptionGroup[] }) {
  const half = groups.find((g) => g.min === 2 && g.max === 2) || groups.find((g) => g.rule === "fraction");
  if (half) {
    const names = line.choices.filter((c) => c.groupId === half.id).flatMap((c) => Array(c.qty).fill(c.name) as string[]);
    const urls = names.map((n) => photos[n]);
    if (urls.length && urls.every(Boolean)) return <PizzaPhoto urls={urls.length === 1 ? [urls[0], urls[0]] : urls} alt={item.name} />;
  }
  return <ItemArt item={item} photos={photos} />;
}

function CrossSell({ menu, cart, photos, onAdd }: { menu: Menu; cart: CartLine[]; photos: Record<string, string>; onAdd: (id: string, el: HTMLElement) => void }) {
  const inBag = new Set(cart.map((l) => l.itemId));
  const cats = new Set(cart.map((l) => menu.items[l.itemId]?.categoryId));
  const rules = menu.crossSell.filter((r) => (r.whenCategoryIds?.some((c) => cats.has(c)) || r.whenItemIds?.some((i) => inBag.has(i))));
  const sug: { id: string; reason: string }[] = [];
  for (const r of rules) for (const id of r.suggestItemIds) if (!inBag.has(id) && menu.items[id] && !sug.some((s) => s.id === id)) sug.push({ id, reason: r.reason });
  if (!sug.length) return null;
  return (
    <div className="blk"><h4>Complete seu pedido</h4>
      <div className="xs">{sug.slice(0, 6).map(({ id, reason }) => (
        <button key={id} className="xcard tap" onClick={(e) => onAdd(id, e.currentTarget)}>
          <span className="ph"><ItemArt item={menu.items[id]} photos={photos} /></span>
          <b>{menu.items[id].name.split(" · ")[0]}</b><span>{reason}</span><em>+ {brl(shownPrice(menu.items[id]))}</em>
        </button>))}
      </div>
    </div>
  );
}

function AddressForm({ addr, setAddr, geo, onLocate }: { addr: Addr; setAddr: (a: Addr) => void; geo: Geo | null; onLocate: (a: Addr) => void }) {
  const f = (k: keyof Addr, label: string, extra: { inputMode?: "numeric" | "text"; autoComplete?: string; half?: boolean; locate?: boolean } = {}) => (
    <div className={`field${extra.half ? " half" : ""}`}>
      <label htmlFor={`cw-a-${k}`}>{label}</label>
      <input id={`cw-a-${k}`} inputMode={extra.inputMode} autoComplete={extra.autoComplete} value={addr[k]} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} onBlur={() => extra.locate && onLocate(addr)} />
    </div>
  );
  return (
    <div className="blk addr"><h4>Endereço de entrega</h4>
      <div className="grid2">
        {f("postalCode", "CEP", { inputMode: "numeric", autoComplete: "postal-code", half: true })}
        {f("number", "Número", { half: true, locate: true })}
      </div>
      {f("street", "Rua", { autoComplete: "address-line1", locate: true })}
      {f("complement", "Complemento", { autoComplete: "address-line2" })}
      {f("district", "Bairro", { locate: true })}
      <div className="grid2">{f("city", "Cidade", { autoComplete: "address-level2", half: true })}{f("state", "UF", { autoComplete: "address-level1", half: true })}</div>
      {geo && (geo.ok && geo.zone
        ? <span className="okline">✓ Entregamos em {geo.zone.name} · {geo.zone.etaMin}–{geo.zone.etaMax} min</span>
        : <span className="err">{geo.reason || "Endereço fora da área de entrega"}</span>)}
    </div>
  );
}

function ItemSheet({ menu, draft, setDraft, groups, photos, onAdd, onClose, shake, onShake }: {
  menu: Menu; draft: Draft; setDraft: (d: Draft) => void; groups: OptionGroup[]; photos: Record<string, string>;
  onAdd: (el: HTMLElement | null) => void; onClose: () => void; shake: string | null; onShake: (gid: string) => void;
}) {
  const item = menu.items[draft.itemId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const priced = priceLine(item, groups, { itemId: item.id, qty: draft.qty, selection: draft.sel });
  const issues = validateSelection(item, groups, draft.sel).filter((i) => i.need > 0);
  const miss = issues[0];
  const halfGroup = groups.find((g) => effectiveRule(item, g) === "fraction") || groups.find((g) => g.min === 2 && g.max === 2);
  const halves = halfGroup ? Object.entries(draft.sel[halfGroup.id] || {}).flatMap(([oid, n]) => Array(n).fill(halfGroup.options.find((o) => o.id === oid)?.name || "") as string[]).filter(Boolean) : [];
  const halfUrls = halves.map((n) => photos[n]);
  const set = (sel: Draft["sel"]) => setDraft({ ...draft, sel, preset: undefined });
  const missGroup = miss ? groups.find((g) => g.id === miss.groupId) : undefined;
  const readyGlow = useReadyGlow(!miss);
  const presetGlow = useIdleGlow(!!item.presets?.length && draft.preset === undefined && !!miss, JSON.stringify(draft.sel));
  const missLabel = miss && missGroup ? `Falta${miss.need > 1 ? "m" : ""} ${miss.need} ${missGroup.max === 2 && missGroup.min === 2 ? (miss.need > 1 ? "sabores" : "sabor") : /doce/i.test(missGroup.name) ? "sabor doce" : miss.need > 1 ? "escolhas" : "escolha"}` : "";

  const toggle = (g: OptionGroup, oid: string, d: number) => {
    const cur = { ...(draft.sel[g.id] || {}) };
    if (g.max === 1) { set({ ...draft.sel, [g.id]: { [oid]: 1 } }); return; }
    const c = groupCount(draft.sel, g.id); const v = cur[oid] || 0;
    if (d > 0 && (c >= g.max || (!g.allowRepeat && v >= 1))) return;
    const nv = Math.max(0, v + d); if (nv) cur[oid] = nv; else delete cur[oid];
    set({ ...draft.sel, [g.id]: cur });
  };

  return (
    <div className="sheet on" role="dialog" aria-label={item.name}>
      <div className="sheet-top"><span>{draft.editKey ? "Editando item" : "Monte do seu jeito"}</span><button className="x" onClick={onClose} aria-label="Fechar">×</button></div>
      <div className="sheet-scroll" ref={scrollRef}>
        <div className="item-ph">
          {halves.length && halfUrls.every(Boolean)
            ? <><PizzaPhoto key={halves.join("+")} urls={halves.length === 1 ? [halfUrls[0], halfUrls[0]] : halfUrls} alt={item.name} fade /><span className="ph-tag">Sua pizza: {halves.length === 1 ? `½ ${halves[0]} · falta a outra metade` : halves[0] === halves[1] ? `Inteira ${halves[0]}` : `½ ${halves[0]} + ½ ${halves[1]}`}</span></>
            : <ItemArt item={item} photos={photos} />}
        </div>
        <div className="item-hd">
          <h3>{item.name}</h3>
          {item.description && <p>{item.description}</p>}
          <div className="proof"><b className="pbig">{item.fromPrice ? "a partir de " : ""}{brl(shownPrice(item))}</b>{item.compareAt ? <s>{brl(item.compareAt)}</s> : null}{item.likes && <span>· 👍 {item.likes.pct}% ({item.likes.n})</span>}{item.liters && <span>· {brl(item.price / item.liters)}/L</span>}</div>
        </div>
        {item.presets?.length ? (
          <div className="presets"><div className="pre-h"><b>Mais pedidos aqui</b><span className="muted">1 toque e pronto</span></div>
            {item.presets.map((p, i) => (
              <button key={p.id} className={`preset${draft.preset === i ? " on" : ""}${presetGlow && i === 0 ? " fx-glow" : ""}`} onClick={() => setDraft({ ...draft, sel: JSON.parse(JSON.stringify(p.selection)), preset: i })}>
                <span><small>{p.label}</small><span className="pt">{p.title}</span></span>
                <span className="pp">{brl(priceLine(item, groups, { itemId: item.id, qty: 1, selection: p.selection }).unit)}</span>
              </button>))}
            <span className="muted sm">ou monte do seu jeito</span>
          </div>
        ) : null}
        {groups.map((g) => {
          const c = groupCount(draft.sel, g.id); const done = c >= g.min; const req = g.min > 0;
          const rule = effectiveRule(item, g);
          const ruleTxt = g.min === 2 && g.max === 2 ? "Escolha 2 metades (pode repetir para inteira)" : g.max === 1 ? "Escolha 1" : `${req ? `Escolha ${g.min === g.max ? g.min : `de ${g.min} a ${g.max}`}` : `Opcional · até ${g.max}`}`;
          return (
            <div className={`grp${shake === g.id ? " shake" : ""}`} key={g.id} id={`g-${g.id}`}>
              <div className={`grp-h${req && !done && draft.tried && miss?.groupId === g.id ? " need" : ""}`}>
                <div><b>{g.name}</b>{req && !done ? <span className="r need-t">falta{g.min - c > 1 ? "m" : ""} {g.min - c}</span> : <span className="r">{ruleTxt}</span>}</div>
                <div className="gst">{g.max > 1 && <span className="st opt">{c}/{g.max}</span>}{req ? (done ? <span className="st ok">✓ PRONTO</span> : <span className="st req">OBRIGATÓRIO</span>) : <span className="st opt">OPCIONAL</span>}</div>
              </div>
              {g.options.map((o) => {
                const v = draft.sel[g.id]?.[o.id] || 0;
                const fl = rule === "fraction" ? fractionLabel(g, o) : null;
                const priceTxt = fl ? (fl.half ? `+ ${brl(fl.half)} a metade · inteira ${brl(fl.full)}` : `sem acréscimo · inteira ${brl(fl.full)}`) : o.price ? `+ ${brl(o.price)}${g.liters ? ` · ${brl(o.price / g.liters)}/L` : ""}` : "";
                const head = (
                  <div className="o-l">
                    {o.imageUrl ? <img className="o-th" src={o.imageUrl} alt="" loading="lazy" /> : null}
                    <div className="o-tx"><span className="o-n">{o.name}{o.popular && <span className="chip-pop">mais pedida</span>}{(o as { avoidHit?: string }).avoidHit && <span className="chip-avoid">tem {(o as { avoidHit?: string }).avoidHit!.toLowerCase()}</span>}{fl?.isBase && <span className="chip-base">preço base</span>}</span>
                      {(o.description || (g.max > 1 && priceTxt)) && <span className="o-d">{g.max > 1 ? priceTxt : o.description}</span>}</div>
                  </div>
                );
                return g.max === 1 ? (
                  <button key={o.id} className="opt-row" role="radio" aria-checked={!!v} onClick={() => toggle(g, o.id, 1)}>
                    {head}<span className="o-r"><span className="o-p">{priceTxt}</span><span className={`radio${v ? " on" : ""}`} aria-hidden="true" /></span>
                  </button>
                ) : (
                  <div key={o.id} className="opt-row">
                    {head}
                    <span className="step">
                      <button onClick={() => toggle(g, o.id, -1)} disabled={!v} aria-label={`Remover ${o.name}`}>−</button><b>{v}</b>
                      <button onClick={() => toggle(g, o.id, 1)} disabled={c >= g.max || (!g.allowRepeat && v >= 1)} aria-label={`Adicionar ${o.name}`}>+</button>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {groups.length > 0 && (
          <div className="notes"><b>Algum recado para a cozinha?</b>
            <div className="chips">{NOTE_CHIPS.map((n) => <button key={n} className={`nchip${draft.notes.includes(n) ? " on" : ""}`} aria-pressed={draft.notes.includes(n)} onClick={() => setDraft({ ...draft, notes: draft.notes.includes(n) ? draft.notes.filter((x) => x !== n) : [...draft.notes, n] })}>{n}</button>)}</div>
          </div>
        )}
      </div>
      <div className="sheet-foot">
        <div className="qty"><button onClick={() => setDraft({ ...draft, qty: Math.max(1, draft.qty - 1) })} aria-label="Menos">−</button><b>{draft.qty}</b><button onClick={() => setDraft({ ...draft, qty: Math.min(50, draft.qty + 1) })} aria-label="Mais">+</button></div>
        <button className={`cta${miss ? " blocked" : ""}${readyGlow ? " fx-glow" : ""}`} id="cta-add" onClick={(e) => {
          if (miss) {
            setDraft({ ...draft, tried: true });
            const el = scrollRef.current?.querySelector<HTMLElement>(`#g-${CSS.escape(miss.groupId)}`);
            if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 8, behavior: reduceMotion() ? "auto" : "smooth" });
            onShake(miss.groupId); return;
          }
          onAdd(e.currentTarget);
        }}>
          <span>{miss ? <><small>Para adicionar</small>{missLabel}</> : draft.editKey ? "Atualizar" : "Adicionar"}</span>
          <span className="cta-price">{brl(priced.total)}</span>
        </button>
      </div>
    </div>
  );
}

function CardForm({ card, setCard, max, total }: { card: CardFields & { installments: number }; setCard: (c: CardFields & { installments: number }) => void; max: number; total: number }) {
  const brand = detectBrand(card.number);
  const n = Math.max(1, Math.min(12, max || 1));
  return (
    <div className="cardform" data-private="true">
      <div className="field"><label htmlFor="cw-cc-number">Número do cartão{brand && <small className="muted"> · {brand}</small>}</label><input id="cw-cc-number" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" value={card.number} onChange={(e) => setCard({ ...card, number: fmtCardNumber(e.target.value) })} /></div>
      <div className="field"><label htmlFor="cw-cc-name">Nome impresso no cartão</label><input id="cw-cc-name" autoComplete="cc-name" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value.toUpperCase() })} /></div>
      <div className="cc-row">
        <div className="field"><label htmlFor="cw-cc-exp">Validade</label><input id="cw-cc-exp" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: fmtExpiry(e.target.value) })} /></div>
        <div className="field"><label htmlFor="cw-cc-cvv">CVV</label><input id="cw-cc-cvv" inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="123" value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></div>
      </div>
      {n > 1 && <div className="field"><label htmlFor="cw-cc-inst">Parcelas</label><select id="cw-cc-inst" value={card.installments} onChange={(e) => setCard({ ...card, installments: +e.target.value })}>{Array.from({ length: n }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k === 1 ? `À vista · ${brl(total)}` : `${k}x de ${brl(total / k)}`}</option>)}</select></div>}
      <small className="muted">Os dados do cartão vão direto para o processador de pagamento, protegidos. A loja não vê nem guarda o número.</small>
    </div>
  );
}

function PixPay(p: { api: ReturnType<typeof createClient>; base: string; order: TrackOrder; setOrder: (o: TrackOrder) => void; onPaid: () => void; onCopy: () => void }) {
  return p.order.payment?.online ? <PixOnline {...p} /> : <PixDemo order={p.order} onPaid={p.onPaid} onCopy={p.onCopy} />;
}

function PixOnline({ api, base, order, setOrder, onPaid, onCopy }: { api: ReturnType<typeof createClient>; base: string; order: TrackOrder; setOrder: (o: TrackOrder) => void; onPaid: () => void; onCopy: () => void }) {
  const on = order.payment!.online!;
  const [nowMs, setNowMs] = useState(Date.now());
  const [renewing, setRenewing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef(order); ref.current = order;
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let alive = true;
    const poll = () => api.get<TrackOrder>(`${base}/orders/${order.id}`).then((o) => {
      if (!alive) return;
      setOrder({ ...ref.current, ...o });
      if (o.payment?.online?.status === "paid" || !["awaiting_payment", "payment_failed"].includes(o.status)) onPaid();
    }).catch(() => { /* tenta de novo */ });
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = on.pix ? Math.max(0, Math.round((+new Date(on.pix.expiresAt) - nowMs) / 1000)) : 0;
  const expired = on.status === "expired" || on.status === "failed" || order.status === "payment_failed" || (on.status === "pending" && left === 0);
  const renew = async () => {
    setRenewing(true); setErr(null);
    try { const r = await api.post<{ status: string; payment: { code: string; online: OnlineInfo } }>(`${base}/orders/${order.id}/pix`, {}); setOrder({ ...ref.current, status: r.status, payment: r.payment }); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Não conseguimos gerar outro Pix. Tente de novo."); }
    finally { setRenewing(false); }
  };
  return (
    <div className="blk pix" data-pix-status={expired ? "expired" : on.status}>
      {expired ? <>
        <p><b>O Pix expirou.</b> Seu pedido continua guardado: gere um código novo para pagar.</p>
        <b className="pix-total">{brl(order.total)}</b>
        <button className="cta" disabled={renewing} onClick={renew}><span>{renewing ? "Gerando…" : "Gerar novo Pix"}</span><span>→</span></button>
      </> : <>
        <p>Abra o app do seu banco, escolha Pix e leia o QR code ou use o copia e cola.</p>
        {on.pix?.qrImage ? <img className="pix-qr" src={on.pix.qrImage} width={200} height={200} alt="QR code Pix para pagamento" /> : null}
        <b className="pix-total">{brl(order.total)}</b>
        <span className="muted" aria-live="polite">Expira em {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</span>
        {on.pix?.qrText && <>
          <textarea className="pix-code" readOnly rows={3} value={on.pix.qrText} aria-label="Código Pix copia e cola" onFocus={(e) => e.currentTarget.select()} />
          <button className="cta" onClick={() => { navigator.clipboard?.writeText(on.pix!.qrText).then(onCopy).catch(onCopy); }}><span>Copiar código Pix</span><span>⧉</span></button>
        </>}
        <span className="pix-wait"><span className="spin" aria-hidden="true" /> Aguardando a confirmação do banco…</span>
      </>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

function PixDemo({ order, onPaid, onCopy }: { order: TrackOrder; onPaid: () => void; onCopy: () => void }) {
  const [left, setLeft] = useState(15 * 60);
  useEffect(() => { const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000); return () => clearInterval(t); }, []);
  const cells = useMemo(() => {
    let h = 2166136261; for (const ch of order.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
    const out: [number, number][] = [];
    for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) {
      const finder = (x < 7 && y < 7) || (x > 21 && y < 7) || (x < 7 && y > 21);
      const on = finder ? ((x % 22 === 0 || x % 22 === 6 || y % 22 === 0 || y % 22 === 6) || ((x % 22) >= 2 && (x % 22) <= 4 && (y % 22) >= 2 && (y % 22) <= 4)) : rnd() > 0.52;
      if (on) out.push([x, y]);
    }
    return out;
  }, [order.id]);
  const code = `00020126BR.GOV.BCB.PIX${order.id.slice(-12).toUpperCase()}5204000053039865406${order.total.toFixed(2)}`;
  return (
    <div className="blk pix">
      <p>Abra o app do seu banco, escolha Pix e leia o código. A aprovação é na hora.</p>
      <svg viewBox="0 0 29 29" width="180" height="180" shapeRendering="crispEdges" role="img" aria-label="QR code Pix de demonstração"><rect width="29" height="29" fill="#fff" />{cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#111" />)}</svg>
      <b className="pix-total">{brl(order.total)}</b>
      <span className="muted">Expira em {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</span>
      <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(code).then(onCopy).catch(onCopy); }}>Copiar código Pix</button>
      <button className="cta" onClick={onPaid}><span>Já paguei</span><span>→</span></button>
      <small className="muted">Demonstração: nenhum pagamento real é feito.</small>
    </div>
  );
}

function Tracking({ api, base, order, setOrder }: { api: ReturnType<typeof createClient>; base: string; order: TrackOrder; setOrder: (o: TrackOrder) => void }) {
  useEffect(() => {
    let on = true;
    const poll = () => api.get<TrackOrder>(`${base}/orders/${order.id}`).then((o) => { if (on) setOrder({ ...order, ...o }); }).catch(() => { /* tenta de novo */ });
    poll();
    const t = setInterval(poll, 4000);
    return () => { on = false; clearInterval(t); };
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useStatusBuzz(order.status);
  const cancelled = order.status === "cancelled";
  const steps = order.status === "pos_error" ? ["created", "pos_error"] : cancelled ? [...new Set([...order.statusHistory.map((h) => h.status), "cancelled"])] : FLOW.filter((s) => s !== "sent_to_pos" || order.statusHistory.some((h) => h.status === "sent_to_pos"));
  const reached = new Set(order.statusHistory.map((h) => h.status));
  const at = (s: string) => order.statusHistory.find((h) => h.status === s)?.at;
  return (
    <div className="blk track">
      <ol className="timeline">
        {steps.map((s) => {
          const ok = reached.has(s) || s === order.status;
          const cur = s === order.status;
          const t = at(s);
          return (
            <li key={s} className={`${ok ? "ok" : ""}${cur ? " cur" : ""}${s === "pos_error" ? " warn" : ""}${s === "cancelled" ? " bad" : ""}`}>
              <span className="dot" aria-hidden="true" />
              <span className="tl-t"><b>{STATUS[s] || s}</b>{t && <small>{new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>}</span>
            </li>
          );
        })}
      </ol>
      <dl className="totals"><dt>Total</dt><dd>{brl(order.total)}</dd>{order.cashbackEarned > 0 && <><dt>Cashback</dt><dd className="okv">{order.status === "concluded" ? "creditado" : "na entrega"} · {brl(order.cashbackEarned)}</dd></>}</dl>
      {order.lines?.length > 0 && <ul className="tr-lines">{order.lines.map((l, i) => <li key={i}>{l.qty}× {l.name}</li>)}</ul>}
    </div>
  );
}
