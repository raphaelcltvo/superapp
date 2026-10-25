import { useState } from "react";
import type { GatewayId } from "@cw/core";
import { BRL, Btn, Empty, Field, Num, Pill, Select, Text, Tile, Toggle, dt, pct, useAction, useAdmin, useLoad } from "../ui";

type Cfg = { enabled: boolean; gateway: GatewayId; env: "sandbox" | "production"; accessToken?: string; publicKey?: string; secretKey?: string; apiKey?: string; webhookSecret?: string; methods: { pix: boolean; card: boolean }; pixExpiresMinutes: number; maxInstallments: number; softDescriptor?: string; captureOnlyIfStoreOpen?: boolean; fakeAutoPaySeconds?: number; requirePassword?: boolean };
type Row = { orderId: string; displayId: string; createdAt: string; total: number; orderStatus: string; gateway: string; method: "pix" | "card"; status: string; card?: { brand?: string; last4?: string; installments?: number }; failureReason?: string; chargeId: string; refundedAt?: string };
type Rep = { totals: { paid: { count: number; amount: number }; refunded: { count: number; amount: number }; failed: { count: number; amount: number }; pending: { count: number; amount: number }; approvalRate: number; pix: { count: number; amount: number }; card: { count: number; amount: number } }; rows: Row[] };

const GW: Record<GatewayId, { name: string; pros: string; fields: { key: keyof Cfg; label: string; hint?: string; secret?: boolean }[] }> = {
  mercadopago: { name: "Mercado Pago", pros: "Pix e cartão. Cadastro rápido, aprovação de cartão reconhecida pelo público.", fields: [
    { key: "accessToken", label: "Access Token", hint: "Suas integrações › Credenciais (TEST-… em teste, APP_USR-… em produção)", secret: true },
    { key: "publicKey", label: "Public Key", hint: "Usada no navegador para gerar o token do cartão" },
    { key: "webhookSecret", label: "Assinatura secreta do webhook", hint: "Suas integrações › Webhooks › chave secreta (valida o x-signature)", secret: true }] },
  pagarme: { name: "Pagar.me", pros: "Pix e cartão com parcelamento e antifraude. Bom para quem já usa Stone.", fields: [
    { key: "secretKey", label: "Chave secreta (sk_…)", secret: true },
    { key: "publicKey", label: "Chave pública (pk_…)", hint: "Usada no navegador para gerar o token do cartão" },
    { key: "webhookSecret", label: "Autenticação básica do webhook (usuário:senha)", hint: "Opcional. A Pagar.me não assina webhooks: protegemos pelo token na URL e reconsultamos a cobrança", secret: true }] },
  asaas: { name: "Asaas", pros: "Pix com conta digital e saque rápido. Cartão fica de fora nesta versão.", fields: [
    { key: "apiKey", label: "Chave de API ($aact_…)", secret: true },
    { key: "webhookSecret", label: "Token de autenticação do webhook", hint: "Opcional e recomendado: o mesmo authToken informado ao criar o webhook no Asaas (header asaas-access-token)", secret: true }] },
  fake: { name: "Gateway de teste", pros: "Para treinar a equipe e homologar a SAIPOS sem dinheiro real.", fields: [] },
};
const ST: Record<string, { label: string; tone?: "good" | "warn" | "bad" | "accent" }> = { pending: { label: "Aguardando", tone: "warn" }, paid: { label: "Pago", tone: "good" }, failed: { label: "Recusado", tone: "bad" }, expired: { label: "Expirado", tone: "bad" }, refunded: { label: "Estornado", tone: "accent" } };

export function PaymentsPage() {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const cur = useLoad<{ config: Cfg | null; webhookUrl: string | null }>("/admin/integrations/payments");
  const [days, setDays] = useState("30");
  const rep = useLoad<Rep>(`/admin/payments?days=${days}`, [days]);
  const [edit, setEdit] = useState<Cfg | null>(null);
  const c: Cfg = edit || cur.data?.config || { enabled: false, gateway: "mercadopago", env: "sandbox", methods: { pix: true, card: true }, pixExpiresMinutes: 15, maxInstallments: 3 };
  const set = (x: Partial<Cfg>) => setEdit({ ...c, ...x });
  const g = GW[c.gateway];
  const t = rep.data?.totals;
  return <>
    <div className="pagehead"><div><h1>Pagamentos</h1><p>Pix e cartão pagos dentro do cardápio. O pedido só vai para a cozinha (e para a SAIPOS) depois de aprovado. Cancelou um pedido pago? O estorno sai sozinho.</p></div>
      <Select value={days} onChange={setDays} options={[{ value: "7", label: "Últimos 7 dias" }, { value: "30", label: "Últimos 30 dias" }, { value: "90", label: "Últimos 90 dias" }]} /></div>
    {t && <div className="grid4">
      <Tile k="Aprovados" v={BRL(t.paid.amount)} d={<span className="muted">{t.paid.count} pagamentos · Pix {t.pix.count} · cartão {t.card.count}</span>} />
      <Tile k="Taxa de aprovação" v={pct(t.approvalRate)} d={<span className="muted">{t.failed.count} recusados ou expirados</span>} />
      <Tile k="Aguardando" v={BRL(t.pending.amount)} d={<span className="muted">{t.pending.count} Pix em aberto</span>} />
      <Tile k="Estornados" v={BRL(t.refunded.amount)} d={<span className="muted">{t.refunded.count} estornos</span>} />
    </div>}
    <div className="split">
      <section className="panel">
        <header><h2>Gateway</h2>{c.enabled ? <Pill tone="good">ligado</Pill> : <Pill>desligado</Pill>}</header>
        <div className="grid2">{(Object.keys(GW) as GatewayId[]).map((id) => <button key={id} type="button" className="tile" style={{ cursor: "pointer", textAlign: "left", outline: c.gateway === id ? "2px solid var(--accent)" : undefined }} onClick={() => set({ gateway: id, methods: id === "asaas" ? { pix: true, card: false } : c.methods })} aria-pressed={c.gateway === id}>
          <b>{GW[id].name}</b><span className="small muted">{GW[id].pros}</span></button>)}</div>
        <p className="small muted">As taxas variam por contrato: compare o MDR do cartão, a tarifa do Pix e o prazo de recebimento antes de escolher.</p>
        <div className="grid2">
          {c.gateway !== "fake" && <Field label="Ambiente"><Select value={c.env} onChange={(v) => set({ env: v })} options={[{ value: "sandbox", label: "Teste (sandbox)" }, { value: "production", label: "Produção" }]} /></Field>}
          {g.fields.map((f) => <Field key={f.key} label={f.label} hint={f.hint}><Text mono type={f.secret ? "password" : "text"} value={String(c[f.key] ?? "")} onChange={(v) => set({ [f.key]: v } as Partial<Cfg>)} /></Field>)}
        </div>
        <div className="row"><Toggle checked={c.methods.pix} onChange={(v) => set({ methods: { ...c.methods, pix: v } })} label="Pix (pague agora)" />{c.gateway !== "asaas" && <Toggle checked={c.methods.card} onChange={(v) => set({ methods: { ...c.methods, card: v } })} label="Cartão de crédito online" />}</div>
        <div className="grid3">
          <Field label="Pix expira em (min)"><Num value={c.pixExpiresMinutes} onChange={(v) => set({ pixExpiresMinutes: v ?? 15 })} /></Field>
          <Field label="Parcelas no cartão (máx.)"><Num value={c.maxInstallments} onChange={(v) => set({ maxInstallments: v ?? 1 })} /></Field>
          <Field label="Nome na fatura" hint="Até 13 letras"><Text value={c.softDescriptor} onChange={(v) => set({ softDescriptor: v.slice(0, 13) })} /></Field>
          {c.gateway === "fake" && <Field label="Pix se paga sozinho em (s)" hint="Só no gateway de teste"><Num value={c.fakeAutoPaySeconds} onChange={(v) => set({ fakeAutoPaySeconds: v })} /></Field>}
        </div>
        <div className="row"><Toggle checked={c.enabled} onChange={(v) => set({ enabled: v })} label="Ligar pagamento online" /><Toggle checked={!!c.captureOnlyIfStoreOpen} onChange={(v) => set({ captureOnlyIfStoreOpen: v })} label="Só cobrar com a loja recebendo pedidos" /></div>
        <Toggle checked={c.requirePassword !== false} onChange={(v) => set({ requirePassword: v })} label="Pedir senha, CPF e data de nascimento para pagar online" />
        <p className="small muted">Na primeira compra online o cliente informa CPF e data de nascimento e cria uma senha; nas próximas, só a senha (esqueceu: código no WhatsApp). Pagamento na entrega continua sem senha. Conferir se o CPF é daquela data de nascimento exige um serviço pago (Serpro ou bureau de crédito) plugado em <code>verifyIdentity</code>; sem ele, só o formato do CPF é validado.</p>
        <div className="row">
          <Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/integrations/payments", c), "Pagamentos salvos")) { setEdit(null); cur.reload(); } }}>Salvar</Btn>
          <Btn disabled={busy} onClick={async () => { const r = await run(() => api.post<{ ok: boolean; message: string }>("/admin/integrations/payments/test")); if (r) toast(r.message, !r.ok); }}>Testar conexão</Btn>
        </div>
        {cur.data?.webhookUrl && <Field label={`URL de notificação (cole no painel ${g.name})`}><div className="codebox" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{cur.data.webhookUrl}</div></Field>}
      </section>
      <section className="panel">
        <header><h2>Como fica a segurança</h2></header>
        <div className="stack small">
          <p>O número do cartão é digitado na tela do cliente e vira um token no próprio gateway. Nosso servidor só recebe o token, nunca o cartão.</p>
          <p>Cada confirmação que chega do gateway é conferida: token na URL e, quando o gateway oferece, assinatura ou autenticação do webhook. Depois consultamos o status direto na API antes de liberar o pedido.</p>
          <p>Pix vencido deixa o pedido parado por 60 minutos com a opção “Gerar novo Pix”; depois disso ele é cancelado, o cashback volta e o cupom é liberado.</p>
          <p>Na SAIPOS o pedido entra como pagamento do parceiro, online, com “pix” ou a bandeira do cartão no complemento.</p>
        </div>
      </section>
    </div>
    <section className="panel"><header><h2>Transações</h2></header>
      {(rep.data?.rows || []).length ? <div className="tablewrap"><table>
        <thead><tr><th>Pedido</th><th>Quando</th><th>Meio</th><th>Gateway</th><th>Cobrança</th><th className="r">Valor</th><th>Status</th><th /></tr></thead>
        <tbody>{rep.data!.rows.map((r) => <tr key={r.chargeId}>
          <td className="mono">#{r.displayId}</td><td className="num">{dt(r.createdAt)}</td>
          <td>{r.method === "pix" ? "Pix" : `Cartão ${r.card?.brand || ""} ${r.card?.last4 ? "•••• " + r.card.last4 : ""}${r.card?.installments && r.card.installments > 1 ? ` · ${r.card.installments}x` : ""}`}</td>
          <td>{GW[r.gateway as GatewayId]?.name || r.gateway}</td><td className="mono small">{r.chargeId}</td><td className="r">{BRL(r.total)}</td>
          <td><Pill tone={ST[r.status]?.tone}>{ST[r.status]?.label || r.status}</Pill>{r.failureReason && <div className="small muted">{r.failureReason}</div>}</td>
          <td>{r.status === "paid" && <Btn sm onClick={async () => { if (await run(() => api.post(`/admin/orders/${r.orderId}/refund`, {}), "Estorno solicitado")) rep.reload(); }}>Estornar</Btn>}</td>
        </tr>)}</tbody></table></div> : <Empty title="Nenhuma transação online no período" />}
    </section>
  </>;
}
