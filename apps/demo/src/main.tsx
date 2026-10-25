import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Admin } from "../../admin/src/Admin";
import { Storefront } from "../../storefront/src/Storefront";
import { startDemo, resetDemo, type Demo } from "./backend";
import "./demo.css";

type Visitor = "direto" | "novo" | "recorrente" | "familia" | "em_risco";
const VISITORS: { id: Visitor; label: string; source?: string; campaign?: string }[] = [
  { id: "direto", label: "Novo · entrou direto", source: undefined },
  { id: "novo", label: "Novo · anúncio no Instagram", source: "instagram", campaign: "pizza99" },
  { id: "recorrente", label: "Recorrente · link no WhatsApp", source: "whatsapp" },
  { id: "familia", label: "Família · Google no domingo", source: "google" },
  { id: "em_risco", label: "Sumido há 45+ dias", source: "whatsapp" },
];
const nextSunday19 = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(19, 0, 0, 0); return d; };

function Shell({ demo }: { demo: Demo }) {
  const [view, setView] = useState<"ambos" | "painel" | "cardapio">(() => (window.innerWidth < 1100 ? "cardapio" : "ambos"));
  const [visitor, setVisitor] = useState<Visitor>("direto");
  const [token, setToken] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [resetAsk, setResetAsk] = useState(false);
  const [slug, setSlug] = useState(demo.slug);
  useEffect(() => {
    (async () => {
      demo.clock.offsetTo(visitor === "familia" ? nextSunday19() : null);
      // cada troca de visitante começa uma visita nova (sem lead, sem cupom já oferecido)
      try { localStorage.removeItem(`cw:lead:${demo.slug}`); for (const k of Object.keys(sessionStorage)) if (k.startsWith("cw:")) sessionStorage.removeItem(k); } catch { /* sem armazenamento */ }
      setToken(visitor === "recorrente" || visitor === "em_risco" ? await demo.customerToken(visitor) : null);
      setKey((k) => k + 1);
    })();
  }, [visitor, demo]);
  const v = VISITORS.find((x) => x.id === visitor)!;
  const customer = { get: () => token, set: (t: string | null) => setToken(t) };
  return <div className="demo">
    <header className="demo-bar">
      <div className="demo-id"><b>Superapp</b><span>cardápio próprio · {slug === demo.slug ? "Forneria Original" : slug}</span></div>
      <div className="demo-seg" role="tablist" aria-label="O que mostrar">
        {(["ambos", "painel", "cardapio"] as const).map((x) => <button key={x} role="tab" aria-selected={view === x} onClick={() => setView(x)}>{x === "ambos" ? "Painel + cardápio" : x === "painel" ? "Painel" : "Cardápio"}</button>)}
      </div>
      <label className="demo-visitor"><span>Quem entra no cardápio</span>
        <select id="demo-visitor" value={visitor} onChange={(e) => setVisitor(e.target.value as Visitor)}>{VISITORS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      <button className="demo-new" id="demo-new-brand" onClick={() => { try { localStorage.removeItem("cw:admin"); localStorage.setItem("cw:admin:manual", "1"); } catch { /* sem armazenamento */ } location.hash = "#criar"; location.reload(); }}>Criar marca nova</button>
      <div className="demo-reset">{resetAsk ? <><span>Apagar tudo o que foi editado?</span><button onClick={async () => { await resetDemo(); try { localStorage.removeItem("cw:admin:manual"); localStorage.removeItem("cw:admin"); } catch { /* sem armazenamento */ } location.hash = ""; location.reload(); }}>Apagar</button><button onClick={() => setResetAsk(false)}>Não</button></> : <button onClick={() => setResetAsk(true)}>Recomeçar demonstração</button>}</div>
    </header>
    <main className={`demo-main v-${view}`}>
      {view !== "cardapio" && <section className="demo-admin"><Admin transport={demo.transport} autoLogin={{ email: "demo@forneria.com.br", password: "forneria2026" }} onTenant={(s) => { if (s !== slug) { setSlug(s); setKey((x) => x + 1); } }} onChange={(k) => { if (k === "published") setKey((x) => x + 1); }} /></section>}
      {view !== "painel" && <aside className="demo-phone-wrap">
        <div className="demo-phone"><div className="demo-screen"><Storefront key={key + ":" + visitor + ":" + slug} transport={demo.transport} slug={slug} source={v.source} campaign={v.campaign} customer={customer} /></div></div>
        <p className="demo-cap">O cardápio lê a última versão publicada. Edite no painel, clique em <b>Publicar alterações</b> e ele recarrega aqui. Os pedidos vão para uma SAIPOS de teste que confirma, despacha e entrega sozinha. Código do WhatsApp: <b>1234</b>.</p>
      </aside>}
    </main>
  </div>;
}

function Boot() {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [msg, setMsg] = useState("Ligando o servidor dentro do navegador…");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { startDemo(setMsg).then(setDemo).catch((e) => setErr(String(e?.message || e))); }, []);
  if (err) return <div className="demo-boot"><b>Não foi possível iniciar.</b><span>{err}</span><button onClick={async () => { await resetDemo(); try { localStorage.removeItem("cw:admin:manual"); localStorage.removeItem("cw:admin"); } catch { /* sem armazenamento */ } location.hash = ""; location.reload(); }}>Recomeçar do zero</button></div>;
  if (!demo) return <div className="demo-boot"><div className="spin" aria-hidden="true" /><span>{msg}</span></div>;
  return <Shell demo={demo} />;
}
createRoot(document.getElementById("root")!).render(<Boot />);
