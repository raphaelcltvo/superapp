import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Field, Num, Pill, Select, Text, Toggle, dt, useAction, useAdmin, useLoad } from "../ui";

/** Configuração devolvida pelo painel (segredos mascarados como ••••1234). */
export type WaCfg = {
  enabled: boolean; provider: "meta" | "zapi" | "evolution" | "fake";
  phoneNumberId?: string; wabaId?: string; token?: string; appSecret?: string; verifyToken?: string; graphVersion?: string;
  otpTemplate?: { name: string; language: string }; costPerMessage?: number;
  zapi?: { instanceId: string; instanceToken: string; clientToken?: string; baseUrl?: string };
  evolution?: { baseUrl: string; apiKey: string; instance: string };
  dailyCap?: number; perTick?: number;
};
type Conf = { whatsapp: WaCfg | null; webhooks: { whatsapp: string; whatsappQr: string | null } };
type Status = { connected: boolean; provider: string | null; phone?: string; checkedAt: string; error?: string };
type Conn = { status: string; connected: boolean; qr?: string; pairingCode?: string };

const QR_PROVIDERS: { value: "zapi" | "evolution" | "fake"; label: string; hint: string }[] = [
  { value: "zapi", label: "Z-API", hint: "Serviço pago por número, pronto em minutos (z-api.io)." },
  { value: "evolution", label: "Evolution API", hint: "Código aberto, hospedado pela marca ou pela agência." },
  { value: "fake", label: "Teste (não envia)", hint: "Para treinar a equipe: o QR é simulado." },
];
const fmtPhone = (p?: string) => (p ? p.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "");

/**
 * Conexão do WhatsApp da marca, a prioridade do CRM. Duas formas:
 * QR code (Z-API, Evolution) para começar hoje, ou API oficial da Meta para campanhas em volume.
 * Usado no Setup e na página de mensagens.
 */
export function WhatsAppConnect(p: { onConnected?: () => void; compact?: boolean }) {
  const { api, toast } = useAdmin(); const { run, busy } = useAction();
  const conf = useLoad<Conf>("/admin/messaging/config");
  const [cfg, setCfg] = useState<WaCfg | null>(null);
  const [mode, setMode] = useState<"qr" | "meta">("qr");
  const [st, setSt] = useState<Status | null>(null);
  const [conn, setConn] = useState<Conn | null>(null);
  const [testTo, setTestTo] = useState("");
  const told = useRef(false);

  useEffect(() => {
    if (!conf.data) return;
    const w = conf.data.whatsapp;
    setCfg(w || { enabled: true, provider: "zapi", zapi: { instanceId: "", instanceToken: "", clientToken: "" } });
    setMode(w?.provider === "meta" ? "meta" : "qr");
  }, [conf.data]);

  const loadStatus = useCallback(async () => {
    try { const s = await api.get<Status>("/admin/messaging/whatsapp/status"); setSt(s); return s; } catch { return null; }
  }, [api]);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { if (st?.connected && !told.current) { told.current = true; setConn(null); p.onConnected?.(); } }, [st?.connected]); // eslint-disable-line

  // aguardando leitura: confere o status a cada 3 s e renova o QR a cada 20 s (o QR do WhatsApp expira)
  useEffect(() => {
    if (!conn || conn.connected) return;
    const poll = setInterval(loadStatus, 3000);
    const refresh = setInterval(async () => { try { setConn(await api.post<Conn>("/admin/messaging/whatsapp/connect")); } catch { /* mantém o QR atual */ } }, 20000);
    return () => { clearInterval(poll); clearInterval(refresh); };
  }, [conn, api, loadStatus]);

  if (!cfg || !conf.data) return <section className="panel"><p className="muted">Carregando WhatsApp…</p></section>;
  const set = (x: Partial<WaCfg>) => setCfg({ ...cfg, ...x });
  const qrProvider = cfg.provider === "meta" ? "zapi" : cfg.provider;
  const connected = !!st?.connected && st.provider === cfg.provider && (conf.data.whatsapp?.provider === cfg.provider);

  const save = async (c: WaCfg) => { await api.put("/admin/messaging/config/whatsapp", c); await conf.reload(); };
  const startQr = async () => {
    const c: WaCfg = { ...cfg, enabled: true, provider: qrProvider };
    if (c.provider === "zapi" && !c.zapi?.instanceId) return toast("Informe o ID e o token da instância Z-API", true);
    if (c.provider === "evolution" && !c.evolution?.baseUrl) return toast("Informe a URL da Evolution API", true);
    const r = await run(async () => { await save(c); return api.post<Conn>("/admin/messaging/whatsapp/connect"); });
    if (!r) return;
    told.current = false;
    if (r.connected) { toast("WhatsApp já está conectado"); await loadStatus(); } else setConn(r);
  };
  const simulateScan = async () => { if (await run(() => api.post("/admin/messaging/whatsapp/simulate-scan"), "Celular conectado")) await loadStatus(); };
  const disconnect = async () => { if (await run(() => api.post("/admin/messaging/whatsapp/disconnect"), "WhatsApp desconectado")) { told.current = false; await loadStatus(); } };
  const test = async () => {
    const r = await run(() => api.post<{ ok: boolean; error?: string }>("/admin/messaging/test", { channel: "whatsapp", to: testTo }));
    if (r) toast(r.ok ? "Mensagem de teste enviada" : r.error || "Falhou", !r.ok);
  };
  const saveMeta = async () => {
    const c: WaCfg = { ...cfg, provider: "meta", verifyToken: cfg.verifyToken || crypto.randomUUID().slice(0, 12) };
    setCfg(c);
    if (await run(() => save(c), "API oficial salva")) await loadStatus();
  };

  return <section className="panel wa-connect">
    <header><h2>WhatsApp da marca</h2>{connected ? <Pill tone="good">conectado{st?.phone ? ` · ${fmtPhone(st.phone)}` : ""}</Pill> : <Pill tone="warn">não conectado</Pill>}</header>
    {!p.compact && <p className="small muted">É por aqui que saem os avisos de pedido, as campanhas e as respostas da caixa de entrada. Escolha como conectar o número da loja.</p>}
    <div className="grid2" role="radiogroup" aria-label="Forma de conexão">
      <button type="button" role="radio" aria-checked={mode === "qr"} className="tile" style={{ cursor: "pointer", textAlign: "left", outline: mode === "qr" ? "2px solid var(--accent)" : undefined }} onClick={() => { setMode("qr"); if (cfg.provider === "meta") set({ provider: "zapi" }); }}>
        <b>Conectar com QR code <span className="muted">· rápido</span></b>
        <span className="small">Pronto em minutos, com o número que a loja já usa. Mensagens em texto livre, sem aprovação de modelos.</span>
        {!p.compact && <span className="small muted">Atenção: disparos em massa podem bloquear o número. Enviamos em ritmo humano e com teto diário.</span>}
      </button>
      <button type="button" role="radio" aria-checked={mode === "meta"} className="tile" style={{ cursor: "pointer", textAlign: "left", outline: mode === "meta" ? "2px solid var(--accent)" : undefined }} onClick={() => { setMode("meta"); set({ provider: "meta" }); }}>
        <b>API oficial da Meta <span className="muted">· recomendado para campanhas</span></b>
        <span className="small">Sem risco de bloqueio e com volume alto. Exige conta verificada e modelos aprovados.</span>
        {!p.compact && <span className="small muted">Custo por conversa iniciada pela marca (marketing, utilidade). A aprovação leva de horas a alguns dias.</span>}
      </button>
    </div>

    {mode === "qr" && <div className="stack">
      {connected ? <div className="stack">
        <p className="sentence">Número <b>{fmtPhone(st?.phone) || "conectado"}</b> pronto para enviar avisos e campanhas{st?.checkedAt ? <span className="small muted"> · conferido {dt(st.checkedAt)}</span> : null}.</p>
        <div className="row"><Text placeholder="5521999990000" value={testTo} onChange={setTestTo} /><Btn disabled={busy || !testTo} onClick={test}>Enviar teste</Btn><Btn kind="ghost" disabled={busy} onClick={disconnect}>Desconectar</Btn></div>
      </div> : conn?.qr || conn?.pairingCode ? <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        {conn.qr && <img src={conn.qr} alt="QR code para conectar o WhatsApp" width={220} height={220} style={{ background: "#fff", borderRadius: 12, padding: 8, border: "1px solid var(--line)" }} />}
        <div className="stack small" style={{ maxWidth: 360 }}>
          <b>Escaneie com o celular da loja</b>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Abra o WhatsApp no celular do número da loja.</li>
            <li>Toque em <b>Mais opções</b> (⋮) ou <b>Configurações</b> › <b>Aparelhos conectados</b>.</li>
            <li>Toque em <b>Conectar um aparelho</b> e aponte para o QR.</li>
          </ol>
          {conn.pairingCode && <span>Sem câmera? Use <b>Conectar com número de telefone</b> e digite o código <span className="mono">{conn.pairingCode}</span>.</span>}
          <span className="muted">O QR se renova sozinho a cada 20 segundos. Esta tela avisa assim que conectar.</span>
          <div className="row">{cfg.provider === "fake" && <Btn kind="primary" disabled={busy} onClick={simulateScan}>Simular leitura do QR</Btn>}<Btn kind="ghost" onClick={() => setConn(null)}>Cancelar</Btn></div>
        </div>
      </div> : <div className="stack">
        <Field label="Provedor"><Select value={qrProvider} onChange={(v) => set({ provider: v })} options={QR_PROVIDERS.map(({ value, label }) => ({ value, label }))} /></Field>
        <p className="small muted">{QR_PROVIDERS.find((x) => x.value === qrProvider)?.hint}</p>
        {qrProvider === "zapi" && <div className="grid3">
          <Field label="ID da instância"><Text mono value={cfg.zapi?.instanceId} onChange={(v) => set({ zapi: { ...(cfg.zapi || { instanceToken: "" }), instanceId: v.trim() } })} /></Field>
          <Field label="Token da instância"><Text mono type="password" value={cfg.zapi?.instanceToken} onChange={(v) => set({ zapi: { ...(cfg.zapi || { instanceId: "" }), instanceToken: v.trim() } })} /></Field>
          <Field label="Client-Token" hint="Segurança › Token de segurança da conta"><Text mono type="password" value={cfg.zapi?.clientToken} onChange={(v) => set({ zapi: { ...(cfg.zapi || { instanceId: "", instanceToken: "" }), clientToken: v.trim() } })} /></Field>
        </div>}
        {qrProvider === "evolution" && <div className="grid3">
          <Field label="URL da Evolution API"><Text mono placeholder="https://evo.suaagencia.com.br" value={cfg.evolution?.baseUrl} onChange={(v) => set({ evolution: { ...(cfg.evolution || { apiKey: "", instance: "" }), baseUrl: v.trim() } })} /></Field>
          <Field label="Chave (apikey)"><Text mono type="password" value={cfg.evolution?.apiKey} onChange={(v) => set({ evolution: { ...(cfg.evolution || { baseUrl: "", instance: "" }), apiKey: v.trim() } })} /></Field>
          <Field label="Nome da instância" hint="Criamos se ainda não existir"><Text mono value={cfg.evolution?.instance} onChange={(v) => set({ evolution: { ...(cfg.evolution || { baseUrl: "", apiKey: "" }), instance: v.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") } })} /></Field>
        </div>}
        {!p.compact && qrProvider !== "fake" && <details><summary className="small">Ritmo das campanhas</summary><div className="grid2">
          <Field label="Mensagens por dia" hint="Padrão 300. Números novos: comece com 100"><Num value={cfg.dailyCap} placeholder="300" onChange={(v) => set({ dailyCap: v })} /></Field>
          <Field label="Mensagens por rodada (5 min)" hint="Com intervalo aleatório de 4 a 8 s"><Num value={cfg.perTick} placeholder="8" onChange={(v) => set({ perTick: v })} /></Field>
        </div></details>}
        <div className="row"><Btn kind="primary" id="wa-qr" disabled={busy} onClick={startQr}>Gerar QR code</Btn></div>
        {st?.error && <p className="small down">Último status: {st.error}</p>}
      </div>}
    </div>}

    {mode === "meta" && <div className="stack">
      <p className="small muted">No Meta Business: crie o app, adicione o produto WhatsApp, gere um token permanente de usuário do sistema e aprove os modelos. Mensagens que a marca inicia só saem por modelo aprovado.</p>
      <div className="grid2">
        <Field label="ID do número (Phone number ID)"><Text mono value={cfg.phoneNumberId} onChange={(v) => set({ phoneNumberId: v })} /></Field>
        <Field label="ID da conta (WABA)"><Text mono value={cfg.wabaId} onChange={(v) => set({ wabaId: v })} /></Field>
        <Field label="Token de acesso"><Text mono type="password" value={cfg.token} onChange={(v) => set({ token: v })} /></Field>
        <Field label="App Secret" hint="Valida a assinatura dos avisos da Meta"><Text mono type="password" value={cfg.appSecret} onChange={(v) => set({ appSecret: v })} /></Field>
        <Field label="Token de verificação" hint="Cole o mesmo valor na Meta"><Text mono value={cfg.verifyToken || ""} onChange={(v) => set({ verifyToken: v })} /></Field>
        <Field label="Modelo do código de acesso"><Text mono value={cfg.otpTemplate?.name} onChange={(v) => set({ otpTemplate: { name: v, language: cfg.otpTemplate?.language || "pt_BR" } })} /></Field>
        {!p.compact && <Field label="Custo por mensagem (R$)" hint="Só para os relatórios"><Num value={cfg.costPerMessage} onChange={(v) => set({ costPerMessage: v })} /></Field>}
      </div>
      <Field label="URL do webhook (Meta › WhatsApp › Configuração)"><div className="codebox" style={{ overflowWrap: "anywhere" }}>{conf.data.webhooks.whatsapp}</div></Field>
      <div className="row">
        <Toggle checked={cfg.enabled} onChange={(v) => set({ enabled: v })} label="Ligar WhatsApp" />
        <Btn kind="primary" disabled={busy} onClick={saveMeta}>Salvar</Btn>
      </div>
      {connected && <div className="row"><Text placeholder="5521999990000" value={testTo} onChange={setTestTo} /><Btn disabled={busy || !testTo} onClick={test}>Enviar teste</Btn></div>}
    </div>}
    {conf.error && <p className="small down">{conf.error}</p>}
  </section>;
}

/* ---------------- avisos de pedido ---------------- */
type Ev = "confirmed" | "ready" | "dispatched" | "concluded" | "cancelled";
type Rule = { enabled: boolean; text: string; waName?: string; waLanguage?: string };
type Notif = { enabled: boolean; events: Record<Ev, Rule> };
const EVENTS: { id: Ev; label: string; hint: string }[] = [
  { id: "confirmed", label: "Pedido aceito", hint: "Quando a loja aceita (ou o PDV confirma)" },
  { id: "ready", label: "Pronto para retirada", hint: "Só em pedidos de retirada" },
  { id: "dispatched", label: "Saiu para entrega", hint: "Quando o motoboy sai" },
  { id: "concluded", label: "Entregue", hint: "Bom momento para pedir avaliação" },
  { id: "cancelled", label: "Cancelado", hint: "Explica o estorno quando foi pago online" },
];
const SAMPLE: Record<string, string> = { nome: "Ana", pedido: "1042", marca: "sua marca", tempo: "40–50 min", link: "https://…/sua-marca?pedido=1042" };
const fill = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`);

/** Avisos automáticos do pedido pelo WhatsApp: liga/desliga por etapa, texto editável e prévia. */
export function OrderNotifications(p: { provider?: string }) {
  const { api } = useAdmin(); const { run, busy } = useAction();
  const cur = useLoad<Notif>("/admin/messaging/notifications");
  const [n, setN] = useState<Notif | null>(null);
  const [open, setOpen] = useState<Ev | null>(null);
  useEffect(() => { if (cur.data) setN(cur.data); }, [cur.data]);
  if (!n) return null;
  const upd = (e: Ev, x: Partial<Rule>) => setN({ ...n, events: { ...n.events, [e]: { ...n.events[e], ...x } } });
  const meta = p.provider === "meta";
  return <section className="panel">
    <header><h2>Avisos do pedido</h2><Toggle checked={n.enabled} onChange={(v) => setN({ ...n, enabled: v })} label="Ligados" /></header>
    <p className="small muted">Saem para o telefone do pedido em cada etapa, mesmo para quem não aceitou receber ofertas. Variáveis: {"{{nome}} {{pedido}} {{marca}} {{tempo}} {{link}}"}.{meta ? " Na API oficial cada aviso precisa de um modelo de utilidade aprovado, com as variáveis na mesma ordem do texto." : ""}</p>
    <div className="list">{EVENTS.map((e) => { const r = n.events[e.id]; return <div key={e.id} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div className="row between">
        <Toggle checked={r.enabled} onChange={(v) => upd(e.id, { enabled: v })} label={<><b>{e.label}</b> <span className="small muted">· {e.hint}</span></>} />
        <Btn sm kind="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "Fechar" : "Editar texto"}</Btn>
      </div>
      {meta && r.enabled && !r.waName && <span className="small down">Sem modelo aprovado: este aviso não sai pela API oficial.</span>}
      {open === e.id && <div className="grid2">
        <div className="stack">
          <Field label="Texto"><textarea value={r.text} onChange={(x) => upd(e.id, { text: x.target.value })} /></Field>
          {meta && <Field label="Nome do modelo aprovado na Meta"><Text mono value={r.waName} onChange={(v) => upd(e.id, { waName: v.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></Field>}
        </div>
        <Field label="Prévia"><div style={{ background: "#e7ddd3", borderRadius: 12, padding: 14 }}><div style={{ background: "#fff", color: "#111", borderRadius: "10px 10px 10px 2px", padding: "8px 11px", maxWidth: 320, whiteSpace: "pre-wrap", fontSize: 14, boxShadow: "0 1px 1px rgba(0,0,0,.15)" }}>{fill(r.text)}</div></div></Field>
      </div>}
    </div>; })}</div>
    <div className="row"><Btn kind="primary" disabled={busy} onClick={async () => { if (await run(() => api.put("/admin/messaging/notifications", n), "Avisos salvos")) cur.reload(); }}>Salvar avisos</Btn></div>
  </section>;
}
