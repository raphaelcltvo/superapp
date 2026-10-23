import { BRL, Btn, Delta, Tile, pct, useAdmin, useLoad } from "../ui";

type Ov = { current: Kpi; previous: Kpi };
type Kpi = { visits: number; orders: number; conversion: number; revenue: number; avgTicket: number; secondOrderRate60d: number; novos: { orders: number; avgTicket: number }; recorrentes: { orders: number; avgTicket: number } };

export function Home(p: { tick: number }) {
  const { go, storeId } = useAdmin();
  const audit = useLoad<{ level: string; where: string; message: string }[]>("/admin/audit", [p.tick]);
  const versions = useLoad<{ number: number; current: boolean }[]>("/admin/versions", [p.tick]);
  const ov = useLoad<Ov>("/admin/crm/overview?days=7");
  const saipos = useLoad<{ config: { enabled: boolean } | null }>(storeId ? `/admin/integrations/saipos/${storeId}` : null, [storeId]);
  const strategies = useLoad<{ active: boolean }[]>("/admin/strategies");
  const loyalty = useLoad<{ active: boolean }>("/admin/settings/loyalty");
  const banners = useLoad<{ active: boolean }[]>("/admin/banners");
  const errs = (audit.data || []).filter((x) => x.level === "erro").length;
  const steps: { label: string; ok: boolean; route: string; note?: string }[] = [
    { label: "Cardápio sem erros de preço, grupos ou links", ok: !!audit.data && errs === 0, route: "publicar", note: errs ? `${errs} pendências` : undefined },
    { label: "Loja com horário, pagamento e área de entrega", ok: !!audit.data && !(audit.data || []).some((x) => x.where.startsWith("Loja")), route: "lojas" },
    { label: "PDV SAIPOS conectado", ok: !!saipos.data?.config?.enabled, route: "integracoes" },
    { label: "Estratégias de frete e taxas ativas", ok: (strategies.data || []).some((s) => s.active), route: "estrategias" },
    { label: "Cashback ligado", ok: !!loyalty.data?.active, route: "cashback" },
    { label: "Banners com vídeo ou GIF no ar", ok: (banners.data || []).some((b) => b.active), route: "vitrine" },
    { label: "Versão publicada", ok: !!versions.data?.some((v) => v.current), route: "publicar" },
  ];
  const done = steps.filter((s) => s.ok).length;
  const c = ov.data?.current, pr = ov.data?.previous;
  return <>
    <div className="pagehead"><div><h1>Início</h1><p>O que falta para o cardápio rodar sozinho e como ele vendeu nos últimos 7 dias.</p></div></div>
    <div className="split">
      <section className="panel">
        <header><h2>Para colocar no ar</h2><span className="small muted num">{done} de {steps.length}</span></header>
        <div className="bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <div className="list">{steps.map((s) => <div key={s.label} className="li click" onClick={() => go(s.route)} role="button" tabIndex={0}>
          <span className={`pill ${s.ok ? "good" : "warn"}`}>{s.ok ? "✓ pronto" : "pendente"}</span>
          <span className="grow">{s.label}{s.note && <span className="small down"> · {s.note}</span>}</span><span className="muted">›</span></div>)}</div>
      </section>
      <section className="stack">
        <div className="grid2">
          <Tile k="Conversão visita → pedido" v={c ? pct(c.conversion) : "—"} d={c && pr && <Delta cur={c.conversion} prev={pr.conversion} />} />
          <Tile k="Pedidos" v={c?.orders ?? "—"} d={c && pr && <Delta cur={c.orders} prev={pr.orders} />} />
          <Tile k="Ticket médio · novos" v={c ? BRL(c.novos.avgTicket) : "—"} d={c && pr && <Delta cur={c.novos.avgTicket} prev={pr.novos.avgTicket} suffix="vs novos do período anterior" />} />
          <Tile k="Ticket médio · recorrentes" v={c ? BRL(c.recorrentes.avgTicket) : "—"} d={c && pr && <Delta cur={c.recorrentes.avgTicket} prev={pr.recorrentes.avgTicket} suffix="vs recorrentes do período anterior" />} />
        </div>
        <div className="panel">
          <header><h3>Atalhos</h3></header>
          <div className="row">
            <Btn onClick={() => go("estrategias")}>Criar regra de frete</Btn>
            <Btn onClick={() => go("vitrine")}>Trocar banner</Btn>
            <Btn onClick={() => go("cupons")}>Novo cupom</Btn>
            <Btn onClick={() => go("integracoes")}>Importar clientes</Btn>
            <Btn onClick={() => go("crm")}>Ver funil</Btn>
          </div>
        </div>
      </section>
    </div>
  </>;
}
