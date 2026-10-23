import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient, type Transport } from "@cw/client";
import "./admin.css";
import { Btn, Ctx, Field, Text, errMsg, useAdmin, type AdminCtx } from "./ui";
import { Home } from "./pages/Home";
import { MenuPage } from "./pages/Menu";
import { GroupsPage } from "./pages/Groups";
import { ShowcasePage } from "./pages/Showcase";
import { PagesPage } from "./pages/Pages";
import { StrategiesPage } from "./pages/Strategies";
import { CouponsPage } from "./pages/Coupons";
import { LoyaltyPage } from "./pages/Loyalty";
import { PaymentsPage } from "./pages/Payments";
import { OrdersPage } from "./pages/Orders";
import { CrmPage, CustomersPage, SegmentsPage, AutomationsPage } from "./pages/Crm";
import { StoresPage } from "./pages/Stores";
import { MessagingPage } from "./pages/Messaging";
import { IntegrationsPage } from "./pages/Integrations";
import { PublishPage } from "./pages/Publish";

export type Route = "inicio" | "cardapio" | "complementos" | "vitrine" | "paginas" | "estrategias" | "cupons" | "pagamentos" | "cashback" | "pedidos" | "crm" | "clientes" | "segmentos" | "automacoes" | "mensagens" | "lojas" | "integracoes" | "publicar";
const NAV: { group: string; items: { id: Route; label: string }[] }[] = [
  { group: "Visão", items: [{ id: "inicio", label: "Início" }] },
  { group: "Cardápio", items: [{ id: "cardapio", label: "Itens e categorias" }, { id: "complementos", label: "Complementos" }, { id: "vitrine", label: "Vitrine e sugestões" }, { id: "paginas", label: "Páginas e pesquisas" }] },
  { group: "Vendas", items: [{ id: "estrategias", label: "Estratégias" }, { id: "cupons", label: "Cupons" }, { id: "pagamentos", label: "Pagamentos" }, { id: "cashback", label: "Cashback" }, { id: "pedidos", label: "Pedidos" }] },
  { group: "CRM", items: [{ id: "crm", label: "Painel e funil" }, { id: "clientes", label: "Clientes" }, { id: "segmentos", label: "Segmentos" }, { id: "automacoes", label: "Automações" }, { id: "mensagens", label: "WhatsApp e e-mail" }] },
  { group: "Operação", items: [{ id: "lojas", label: "Lojas e entrega" }, { id: "integracoes", label: "Integrações e bases" }, { id: "publicar", label: "Publicar" }] },
];
const ROUTES = NAV.flatMap((g) => g.items.map((i) => i.id));

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

export interface AdminProps {
  transport: Transport;
  /** login automático (demonstração) */
  autoLogin?: { email: string; password: string };
  /** chamado depois de publicar ou salvar (a demonstração recarrega o cardápio ao lado) */
  onChange?: (kind: "published" | "draft") => void;
  initialRoute?: Route;
}

export function Admin(p: AdminProps) {
  const [token, setToken] = useState<string | null>(() => store.get("cw:admin"));
  const api = useMemo(() => createClient(p.transport, { admin: () => token }), [p.transport, token]);
  useEffect(() => {
    if (token || !p.autoLogin) return;
    api.post<{ token: string }>("/auth/login", p.autoLogin).then((r) => { store.set("cw:admin", r.token); setToken(r.token); }).catch(() => {});
  }, [token, p.autoLogin, api]);
  if (!token) return <Login api={api} onToken={(t) => { store.set("cw:admin", t); setToken(t); }} />;
  return <Shell {...p} api={api} onLogout={() => { store.set("cw:admin", null); setToken(null); }} />;
}

function Login(p: { api: ReturnType<typeof createClient>; onToken: (t: string) => void }) {
  const [email, setEmail] = useState("demo@forneria.com.br");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  return <div className="cw-ad login">
    <form onSubmit={async (e) => { e.preventDefault(); try { p.onToken((await p.api.post<{ token: string }>("/auth/login", { email, password: pw })).token); } catch (er) { setErr(errMsg(er)); } }}>
      <h1>Entrar no painel</h1>
      <p className="muted">Configure cardápio, regras, CRM e integrações da sua marca.</p>
      <Field label="E-mail"><Text id="login-email" type="email" value={email} onChange={setEmail} /></Field>
      <Field label="Senha"><Text id="login-pw" type="password" value={pw} onChange={setPw} /></Field>
      {err && <p className="down small">{err}</p>}
      <Btn kind="primary" type="submit">Entrar</Btn>
    </form>
  </div>;
}

function Shell(p: AdminProps & { api: ReturnType<typeof createClient>; onLogout: () => void }) {
  const [route, setRoute] = useState<Route>(() => { const h = (typeof location !== "undefined" ? location.hash.slice(1) : "") as Route; return ROUTES.includes(h) ? h : p.initialRoute || "inicio"; });
  const [toastMsg, setToast] = useState<{ m: string; bad?: boolean } | null>(null);
  const [storeId, setStoreId] = useState("");
  const [me, setMe] = useState<{ tenant: { name: string; branding: { logoUrl?: string }; publishedAt?: string } } | null>(null);
  const [draftTick, setDraftTick] = useState(0);
  useEffect(() => { p.api.get<typeof me>("/admin/me").then(setMe).catch(() => p.onLogout()); }, [p.api]); // eslint-disable-line
  useEffect(() => { p.api.get<{ id: string }[]>("/admin/stores").then((s) => s[0] && setStoreId((x) => x || s[0].id)).catch(() => {}); }, [p.api]);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toastMsg]);
  const go = useCallback((r: string) => { setRoute(r as Route); try { history.replaceState(null, "", "#" + r); } catch { /* moldura sem histórico */ } window.scrollTo?.(0, 0); }, []);
  const ctx: AdminCtx = useMemo(() => ({ api: p.api, toast: (m, bad) => setToast({ m, bad }), go, dirty: () => { setDraftTick((x) => x + 1); p.onChange?.("draft"); }, storeId, setStoreId, onPublished: () => p.onChange?.("published") }), [p.api, go, storeId, p.onChange]); // eslint-disable-line
  const pages: Record<Route, ReactNode> = {
    inicio: <Home tick={draftTick} />, cardapio: <MenuPage />, complementos: <GroupsPage />, vitrine: <ShowcasePage />, paginas: <PagesPage />,
    estrategias: <StrategiesPage />, cupons: <CouponsPage />, pagamentos: <PaymentsPage />, cashback: <LoyaltyPage />, pedidos: <OrdersPage />,
    crm: <CrmPage />, clientes: <CustomersPage />, segmentos: <SegmentsPage />, automacoes: <AutomationsPage />, mensagens: <MessagingPage />,
    lojas: <StoresPage />, integracoes: <IntegrationsPage />, publicar: <PublishPage />,
  };
  return <Ctx.Provider value={ctx}>
    <div className="cw-ad shell">
      <nav className="rail" aria-label="Seções do painel">
        <div className="brandmark"><div className="logo" style={me?.tenant.branding.logoUrl ? { backgroundImage: `url(${me.tenant.branding.logoUrl})` } : undefined} /><div><b>{me?.tenant.name || "Sua marca"}</b><span>Superapp · painel</span></div></div>
        {NAV.map((g) => <div className="navgroup" key={g.group}><small>{g.group}</small>{g.items.map((i) => <button key={i.id} className="navbtn" aria-current={route === i.id ? "page" : undefined} onClick={() => go(i.id)}>{i.label}</button>)}</div>)}
        <div style={{ marginTop: "auto" }}><button className="navbtn" onClick={p.onLogout}>Sair</button></div>
      </nav>
      <div className="main">
        <TopBar route={route} />
        <div className="content" key={route}>{pages[route]}</div>
      </div>
      {toastMsg && <div className={`toast ${toastMsg.bad ? "bad" : ""}`} role="status">{toastMsg.m}</div>}
    </div>
  </Ctx.Provider>;
}

function TopBar(p: { route: Route }) {
  const { api, go, toast, onPublished } = useAdmin();
  const [v, setV] = useState<{ number: number; createdAt: string; current: boolean }[]>([]);
  const [errors, setErrors] = useState(0);
  const load = useCallback(() => { api.get<typeof v>("/admin/versions").then(setV).catch(() => {}); api.get<{ level: string }[]>("/admin/audit").then((a) => setErrors(a.filter((x) => x.level === "erro").length)).catch(() => {}); }, [api]);
  useEffect(load, [load, p.route]);
  const cur = v.find((x) => x.current);
  return <div className="topbar">
    <div className="row small">
      {cur ? <span className="pill good">No ar · versão {cur.number}</span> : <span className="pill warn">Ainda não publicado</span>}
      {errors > 0 && <button className="pill bad" style={{ border: 0, cursor: "pointer" }} onClick={() => go("publicar")}>{errors} {errors === 1 ? "pendência" : "pendências"} para publicar</button>}
    </div>
    <div className="row">
      <Btn sm onClick={() => go("publicar")}>Revisar</Btn>
      <Btn sm kind="primary" id="btn-publish" onClick={async () => {
        try { const r = await api.post<{ number: number }>("/admin/publish", { notes: "Publicado pelo painel" }); toast(`Versão ${r.number} publicada`); onPublished?.(); load(); }
        catch (e) { toast(errMsg(e), true); go("publicar"); }
      }}>Publicar alterações</Btn>
    </div>
  </div>;
}
