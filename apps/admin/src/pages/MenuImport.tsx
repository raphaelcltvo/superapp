import { useEffect, useRef, useState } from "react";
import { ApiError } from "@cw/client";
import { CUISINES, measureLabel, tagLabel, type CuisineId, type ImportPlan } from "@cw/core";
import { BRL, Btn, Empty, Field, Pill, Select, Text, Tile, errMsg, useAction, useAdmin } from "../ui";

type Job = { id: string; status: "aguardando" | "baixando" | "pronto" | "concluida" | "erro" | "bloqueado"; source: string; progress?: { done: number; total: number; message?: string }; plan?: ImportPlan; error?: string; result?: Result; expiresAt?: string };
type Result = { mode: "replace" | "merge"; categories: number; items: number; groups: number; created: number; updated: number; removed: number; cuisine: CuisineId };
type Session = { id: string; token: string; bookmarklet: string; expiresAt: string };

const KIND: Record<string, string> = { simple: "simples", buildable: "montável", combo: "combo", offer: "oferta" };

export function MenuImportPage() {
  const { go } = useAdmin();
  return <>
    <div className="pagehead"><div><h1>Importar do iFood</h1><p>Copie categorias, itens, fotos e complementos da sua loja no iFood. Tudo entra como rascunho: você revisa, ajusta e só então publica.</p></div></div>
    <IfoodImport onDone={() => go("cardapio")} />
  </>;
}

/** Fluxo completo do "Copiar do iFood": link → (bookmarklet se o iFood bloquear) → prévia → gravar no rascunho. */
export function IfoodImport(p: { onDone?: (r: { categories: number; items: number; groups: number }) => void; compact?: boolean }) {
  const { api, dirty } = useAdmin(); const { run, busy } = useAction();
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  // acompanha o trabalho enquanto o cardápio não chega (bookmarklet ou busca pelo servidor)
  const watching = job && (job.status === "aguardando" || job.status === "baixando") ? job.id : null;
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    const tick = async () => {
      try { const j = await api.get<Job>(`/admin/menu-import/${watching}`); if (alive) { setJob(j); if (j.status === "bloqueado") openBookmarklet(); } } catch { /* tenta de novo */ }
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [watching]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openBookmarklet() {
    if (session) return;
    try { const s = await api.post<Session>("/admin/menu-import/ifood/session"); setSession(s); setJob({ id: s.id, status: "aguardando", source: "bookmarklet" }); } catch (e) { setErr(errMsg(e)); }
  }
  async function start() {
    setErr(""); setResult(null);
    try {
      const j = await api.post<Job>("/admin/menu-import/ifood/url", { url: url.trim() });
      setJob(j);
      if (j.status === "bloqueado" || j.status === "erro") { setErr(j.error || "O iFood não respondeu"); await openBookmarklet(); }
    } catch (e) {
      if (e instanceof ApiError && (e.details as { useBookmarklet?: boolean })?.useBookmarklet) { await openBookmarklet(); return; }
      setErr(errMsg(e));
    }
  }
  async function sendPaste() {
    setErr("");
    const r = await run(() => api.post<Job>("/admin/menu-import/ifood/raw", { raw: paste }));
    if (r) { setJob(r); setSession(null); setPaste(""); }
  }
  async function commit(mode: "replace" | "merge", cuisine: CuisineId) {
    const r = await run(() => api.post<Result>(`/admin/menu-import/${job!.id}/commit`, { mode, cuisine }), "Cardápio importado para o rascunho");
    if (r) { setResult(r); dirty(); }
  }
  const reset = () => { setJob(null); setSession(null); setResult(null); setErr(""); };

  if (result) return <section className="panel" id="import-result">
    <header><h2>Cardápio copiado</h2><Pill tone="good">rascunho</Pill></header>
    <p className="sentence">{result.categories} categorias, {result.items} itens e {result.groups} grupos de complementos. {result.mode === "merge" ? `${result.created} itens novos e ${result.updated} atualizados.` : `O cardápio anterior (${result.removed} itens) foi substituído.`}</p>
    <p className="small muted">Nada foi publicado. Revise preços, fotos e a ordem das categorias e publique quando estiver pronto.</p>
    <div className="row"><Btn kind="primary" onClick={() => p.onDone?.(result)}>Revisar itens</Btn><Btn onClick={reset}>Importar outra loja</Btn></div>
  </section>;

  if (job?.status === "pronto" && job.plan) return <Preview job={job} busy={busy} onCommit={commit} onBack={reset} compact={p.compact} />;

  return <div className="stack">
    <section className="panel">
      <header><h2>Link da loja no iFood</h2></header>
      <p className="small muted">Abra a sua loja no iFood e copie o endereço da página (termina com o código da loja).</p>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="grow"><Text id="ifood-url" value={url} onChange={setUrl} placeholder="https://www.ifood.com.br/delivery/cidade/sua-loja/3f2a…" /></div>
        <Btn kind="primary" id="ifood-go" disabled={busy || url.trim().length < 20 || job?.status === "baixando"} onClick={start}>Copiar cardápio</Btn>
      </div>
      {err && <p className="small down">{err}</p>}
      {job?.status === "baixando" && <div className="stack"><div className="bar"><i style={{ width: `${job.progress?.total ? Math.round((job.progress.done / job.progress.total) * 100) : 5}%` }} /></div><p className="small muted">{job.progress?.message || "Lendo o cardápio…"} · o iFood limita a velocidade, leva alguns minutos em cardápios grandes.</p></div>}
    </section>
    {session && <Bookmarklet session={session} url={url} waiting={job?.status === "aguardando"} />}
    <details className="panel">
      <summary className="small">Tenho o JSON do cardápio (avançado)</summary>
      <Field label="Cole aqui o JSON copiado pelo botão ou exportado do iFood"><textarea id="ifood-json" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"catalog": …}' /></Field>
      <div><Btn disabled={busy || paste.trim().length < 10} onClick={sendPaste}>Ler JSON</Btn></div>
    </details>
  </div>;
}

function Bookmarklet(p: { session: Session; url: string; waiting: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  // href definido fora do React para não acionar o aviso de links javascript:
  useEffect(() => { ref.current?.setAttribute("href", p.session.bookmarklet); }, [p.session.bookmarklet]);
  return <section className="panel" id="ifood-bookmarklet">
    <header><h2>Copiar pelo seu navegador</h2>{p.waiting && <Pill tone="warn">aguardando o iFood</Pill>}</header>
    <p className="small muted">O iFood não deixa servidores lerem o cardápio. O botão abaixo lê pela sua própria sessão, devagar, como se você estivesse navegando.</p>
    <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
      <li>Arraste este botão para a barra de favoritos: <a ref={ref} className="btn primary sm" draggable onClick={(e) => e.preventDefault()} title="Arraste para a barra de favoritos">Copiar do iFood</a> <span className="small muted">(a barra aparece com Ctrl+Shift+B, ou ⌘+Shift+B no Mac)</span></li>
      <li>Abra a página da sua loja no iFood{p.url ? <> (<a href={p.url} target="_blank" rel="noreferrer">abrir agora</a>)</> : null} e role até o fim do cardápio.</li>
      <li>Clique no favorito <b>Copiar do iFood</b>. Uma janelinha do SuperApp abre e o cardápio aparece aqui sozinho. Cardápios grandes levam alguns minutos.</li>
    </ol>
    <p className="small muted">O link vale até {new Date(p.session.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} e só funciona para esta marca. Se o iFood pedir verificação, resolva na página e clique de novo.</p>
  </section>;
}

function Preview(p: { job: Job; busy: boolean; onCommit: (mode: "replace" | "merge", cuisine: CuisineId) => void; onBack: () => void; compact?: boolean }) {
  const plan = p.job.plan!;
  const { api } = useAdmin();
  const [cuisine, setCuisine] = useState<CuisineId>(plan.cuisine);
  const [mode, setMode] = useState<"replace" | "merge">("merge");
  const [hasItems, setHasItems] = useState(false);
  useEffect(() => { api.get<unknown[]>("/admin/items").then((x) => { setHasItems(x.length > 0); setMode(x.length ? "merge" : "replace"); }).catch(() => {}); }, [api]);
  const G = Object.fromEntries(plan.groups.map((g) => [g.id, g]));
  const c = plan.report.counts;
  const ranking = plan.cuisineRanking.slice(0, 3);
  return <div className="stack" id="import-preview">
    <section className="panel">
      <header><h2>{plan.merchant.name || "Cardápio do iFood"}</h2><Pill tone="accent">prévia</Pill></header>
      <div className="grid4">
        <Tile k="Categorias" v={c.categories} />
        <Tile k="Itens" v={c.items} d={<span className="muted">{c.buildable} montáveis · {c.combos} combos e ofertas</span>} />
        <Tile k="Grupos de complementos" v={c.groups} d={<span className="muted">{c.options} opções · {plan.report.mergedGroups} repetidos unificados</span>} />
        <Tile k="Com foto" v={`${c.photos} de ${c.items}`} />
      </div>
      <div className="grid2">
        <Field label="Culinária" hint={ranking.length ? `Detectado: ${ranking.map((r) => `${r.label} ${Math.round(r.score * 100)}%`).join(" · ")}` : "Não deu para detectar: escolha"}>
          <Select id="import-cuisine" value={cuisine} onChange={setCuisine} options={CUISINES.map((x) => ({ value: x.id, label: x.label }))} />
        </Field>
        <Field label="Como gravar">
          <Select id="import-mode" value={mode} onChange={setMode} options={[{ value: "merge", label: "Mesclar com o cardápio atual" }, { value: "replace", label: "Substituir o cardápio inteiro" }]} />
        </Field>
      </div>
      <p className="small muted">{mode === "merge" ? "Itens com o mesmo nome na mesma categoria são atualizados (preço, descrição, complementos); fotos que você já tinha, códigos de PDV, posição e combinações prontas são mantidos. Os novos entram no fim." : hasItems ? "Apaga categorias, itens e complementos atuais do rascunho. Banners, sugestões e cupons que apontavam para itens antigos aparecem como pendência em Publicar." : "O cardápio entra completo no rascunho."}</p>
      {plan.report.skippedDuplicates > 0 && <p className="small muted">{plan.report.skippedDuplicates} itens repetidos na mesma categoria entram uma vez só.</p>}
      <div className="row"><Btn kind="primary" id="import-commit" disabled={p.busy} onClick={() => p.onCommit(mode, cuisine)}>{mode === "merge" ? "Mesclar no rascunho" : "Substituir no rascunho"}</Btn><Btn onClick={p.onBack}>Cancelar</Btn></div>
    </section>
    {plan.report.warnings.length > 0 && <section className="panel"><header><h3>Para conferir</h3><span className="small muted">{plan.report.warnings.length}</span></header>
      <div className="list">{plan.report.warnings.slice(0, 30).map((w, i) => <div key={i} className="li small"><span className="pill warn">aviso</span><span className="grow"><b>{w.where}</b> · {w.message}</span></div>)}</div>
    </section>}
    {plan.categories.map((cat) => {
      const its = plan.items.filter((i) => i.categoryId === cat.id);
      return <details key={cat.id} className="panel" open={!p.compact && cat.position < 2}>
        <summary><b>{cat.name}</b> <span className="small muted">· {its.length} {its.length === 1 ? "item" : "itens"}</span>{cat.pricingLocked && <> <Pill tone="accent">preço fechado</Pill></>}</summary>
        <div className="list">{its.map((it) => <div key={it.id} className="li">
          {it.imageUrl ? <img className="thumb" src={it.imageUrl} alt="" loading="lazy" /> : <span className="thumb" />}
          <div className="grow"><b>{it.name}</b><span className="small muted">{KIND[it.kind]}{it.groupIds.length ? ` · ${it.groupIds.map((g) => G[g]?.name).filter(Boolean).join(", ")}` : ""}{it.measure ? ` · ${measureLabel(it.measure)}` : ""}{it.serves ? ` · ${it.serves}` : ""}</span></div>
          {(it.tags || []).map((t) => <Pill key={t}>{tagLabel(t)}</Pill>)}
          {!it.available && <Pill tone="warn">esgotado no iFood</Pill>}
          <span className="num" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{it.kind === "buildable" ? "a partir de " : ""}{BRL(it.price)}{it.compareAt ? <s className="small muted"> {BRL(it.compareAt)}</s> : null}</span>
        </div>)}</div>
      </details>;
    })}
    {!plan.categories.length && <Empty title="Nenhum item encontrado" />}
  </div>;
}
