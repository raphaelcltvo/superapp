import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DeliveryZone, LatLng, PaymentCode, Store } from "@cw/core";
import { BRL, Btn, Field, Num, Pill, Select, Text, Toggle, useAction, useAdmin, useLoad } from "../ui";

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const COLORS = ["#2F6B3F", "#1F5F8B", "#B26B00", "#7A3E9D", "#A3191F", "#0F766E"];
const PAYS: { code: PaymentCode; label: string; saiposCode: string; online: boolean; saiposComplement?: string }[] = [
  { code: "PIX_ONLINE", label: "Pix", saiposCode: "PARTNER_PAYMENT", saiposComplement: "pix", online: true },
  { code: "CARD_ON_DELIVERY", label: "Cartão na entrega", saiposCode: "CARD", online: false },
  { code: "CREDIT_ON_DELIVERY", label: "Crédito na entrega", saiposCode: "CRE", online: false },
  { code: "DEBIT_ON_DELIVERY", label: "Débito na entrega", saiposCode: "DEB", online: false },
  { code: "VR_VA", label: "VR / VA", saiposCode: "VALE", online: false },
  { code: "CASH", label: "Dinheiro", saiposCode: "DIN", online: false },
];

export function StoresPage() {
  const { api, dirty, storeId, setStoreId } = useAdmin(); const { run, busy } = useAction();
  const stores = useLoad<Store[]>("/admin/stores");
  const [s, setS] = useState<Store | null>(null);
  useEffect(() => { const x = (stores.data || []).find((y) => y.id === storeId) || stores.data?.[0]; if (x) setS(structuredClone(x)); }, [stores.data, storeId]);
  if (!s) return null;
  const set = (x: Partial<Store>) => setS({ ...s, ...x });
  const save = async () => { if (await run(() => api.put(`/admin/stores/${s.id}`, s), "Loja salva")) { stores.reload(); dirty(); } };
  return <>
    <div className="pagehead"><div><h1>Lojas e entrega</h1><p>Desenhe as áreas no mapa e dê a cada uma sua taxa e seu tempo. Frete grátis e taxas por regra ficam em Estratégias.</p></div>
      <div className="row">{(stores.data || []).length > 1 && <Select value={s.id} onChange={setStoreId} options={stores.data!.map((x) => ({ value: x.id, label: x.name }))} />}<Btn kind="primary" onClick={save} disabled={busy}>Salvar loja</Btn></div></div>
    <section className="panel"><header><h2>Áreas de entrega</h2><p>Clique em “Desenhar área”, marque os pontos no mapa e conclua. Arraste os pontos para ajustar.</p></header>
      <ZoneMap store={s} onChange={(zones) => set({ zones })} />
      <div className="tablewrap"><table><thead><tr><th>Área</th><th className="r">Taxa</th><th className="r">Tempo (min)</th><th>Ativa</th><th /></tr></thead>
        <tbody>{s.zones.map((z, i) => { const upd = (x: Partial<DeliveryZone>) => set({ zones: s.zones.map((y, j) => (j === i ? { ...y, ...x } : y)) }); return <tr key={z.id}>
          <td><div className="row" style={{ flexWrap: "nowrap" }}><i style={{ width: 12, height: 12, borderRadius: 3, background: z.color, flexShrink: 0 }} /><Text value={z.name} onChange={(v) => upd({ name: v })} /></div></td>
          <td className="r" style={{ width: 110 }}><Num value={z.fee} onChange={(v) => upd({ fee: v ?? 0 })} /></td>
          <td className="r" style={{ width: 150 }}><div className="row" style={{ flexWrap: "nowrap" }}><Num value={z.etaMin} onChange={(v) => upd({ etaMin: v ?? 0 })} /><span>–</span><Num value={z.etaMax} onChange={(v) => upd({ etaMax: v ?? 0 })} /></div></td>
          <td><Toggle checked={z.active} onChange={(v) => upd({ active: v })} /></td>
          <td><Btn sm kind="ghost" onClick={() => set({ zones: s.zones.filter((_, j) => j !== i) })}>✕</Btn></td></tr>; })}</tbody></table></div>
      <p className="small muted">Ordem importa: se as áreas se sobrepõem, vale a primeira da lista. Hoje a menor taxa é {BRL(Math.min(...s.zones.map((z) => z.fee), 0) || 0)}.</p>
    </section>
    <div className="grid2">
      <section className="panel"><header><h2>Dados da loja</h2>{s.status === "live" ? <Pill tone="good">aberta para pedidos</Pill> : <Pill tone="warn">{s.status === "paused" ? "pausada" : "rascunho"}</Pill>}</header>
        <div className="grid2">
          <Field label="Nome"><Text value={s.name} onChange={(v) => set({ name: v })} /></Field>
          <Field label="Situação"><Select value={s.status} onChange={(v) => set({ status: v })} options={[{ value: "live", label: "Recebendo pedidos" }, { value: "paused", label: "Pausada" }, { value: "draft", label: "Rascunho" }]} /></Field>
          <Field label="Rua"><Text value={s.address.street} onChange={(v) => set({ address: { ...s.address, street: v } })} /></Field>
          <Field label="Número"><Text value={s.address.number} onChange={(v) => set({ address: { ...s.address, number: v } })} /></Field>
          <Field label="Bairro"><Text value={s.address.district} onChange={(v) => set({ address: { ...s.address, district: v } })} /></Field>
          <Field label="Cidade / UF"><div className="row" style={{ flexWrap: "nowrap" }}><Text value={s.address.city} onChange={(v) => set({ address: { ...s.address, city: v } })} /><Text value={s.address.state} onChange={(v) => set({ address: { ...s.address, state: v.toUpperCase().slice(0, 2) } })} /></div></Field>
          <Field label="CEP"><Text value={s.address.postalCode} onChange={(v) => set({ address: { ...s.address, postalCode: v } })} /></Field>
          <Field label="WhatsApp da loja"><Text value={s.phone} onChange={(v) => set({ phone: v })} /></Field>
        </div>
        <div className="row"><Toggle checked={s.modes.delivery} onChange={(v) => set({ modes: { ...s.modes, delivery: v } })} label="Entrega" /><Toggle checked={s.modes.takeout} onChange={(v) => set({ modes: { ...s.modes, takeout: v } })} label="Retirada" /></div>
      </section>
      <section className="panel"><header><h2>Horários</h2><p>Pode passar da meia-noite (ex.: 18:00 às 01:00)</p></header>
        {DAYS.map((d, wd) => { const w = s.hours.find((h) => h.weekday === wd); return <div key={d} className="row" style={{ flexWrap: "nowrap" }}>
          <span style={{ width: 80 }} className="small">{d}</span>
          <Toggle checked={!!w} onChange={(v) => set({ hours: v ? [...s.hours, { weekday: wd as 0, open: "18:00", close: "23:30" }] : s.hours.filter((h) => h.weekday !== wd) })} />
          {w ? <><input type="time" value={w.open} onChange={(e) => set({ hours: s.hours.map((h) => (h.weekday === wd ? { ...h, open: e.target.value } : h)) })} /><span>às</span><input type="time" value={w.close} onChange={(e) => set({ hours: s.hours.map((h) => (h.weekday === wd ? { ...h, close: e.target.value } : h)) })} /></> : <span className="small muted">fechado</span>}
        </div>; })}
      </section>
    </div>
    <section className="panel"><header><h2>Formas de pagamento</h2><p>Cada uma já sai com o código que a SAIPOS reconhece. Dados de cartão nunca passam pelo cardápio.</p></header>
      <div className="grid3">{PAYS.map((pm) => { const cur = s.payments.find((x) => x.code === pm.code); return <div key={pm.code} className="tile"><Toggle checked={!!cur?.active} onChange={(v) => set({ payments: cur ? s.payments.map((x) => (x.code === pm.code ? { ...x, active: v } : x)) : [...s.payments, { ...pm, active: v }] })} label={<b>{pm.label}</b>} /><span className="small muted mono">SAIPOS {pm.saiposCode}{pm.saiposComplement ? ` · ${pm.saiposComplement}` : ""}{pm.online ? " · online" : ""}</span></div>; })}</div>
    </section>
  </>;
}

/** Mapa com áreas em polígono. Vértices arrastáveis; novo desenho por cliques. */
function ZoneMap(p: { store: Store; onChange: (z: DeliveryZone[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [drawing, setDrawing] = useState<LatLng[] | null>(null);
  const zonesRef = useRef(p.store.zones); zonesRef.current = p.store.zones;
  const drawRef = useRef(drawing); drawRef.current = drawing;
  useEffect(() => {
    if (!ref.current || map.current) return;
    const center: LatLng = p.store.address.lat != null ? [p.store.address.lat, p.store.address.lng!] : p.store.zones[0]?.polygon?.[0] || [-22.97, -43.22];
    const m = L.map(ref.current, { zoomControl: true, attributionControl: true }).setView(center, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => { if (drawRef.current) setDrawing([...drawRef.current, [e.latlng.lat, e.latlng.lng]]); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line
  useEffect(() => {
    const g = layer.current; const m = map.current; if (!g || !m) return;
    g.clearLayers();
    if (p.store.address.lat != null) L.circleMarker([p.store.address.lat, p.store.address.lng!], { radius: 7, color: "#161a16", fillColor: "#fff", fillOpacity: 1, weight: 3 }).bindTooltip("Loja").addTo(g);
    p.store.zones.forEach((z, zi) => {
      if (z.kind !== "polygon" || !z.polygon) return;
      L.polygon(z.polygon, { color: z.color, weight: 2, fillOpacity: z.active ? 0.18 : 0.05, dashArray: z.active ? undefined : "4 4" }).bindTooltip(`${z.name} · ${BRL(z.fee)} · ${z.etaMin}–${z.etaMax} min`, { sticky: true }).addTo(g);
      z.polygon.forEach((pt, pi) => {
        const mk = L.marker(pt, { draggable: true, icon: L.divIcon({ className: "", html: `<span style="display:block;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid ${z.color}"></span>`, iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(g);
        mk.on("dragend", () => { const ll = mk.getLatLng(); p.onChange(zonesRef.current.map((y, j) => (j === zi ? { ...y, polygon: y.polygon!.map((q, k) => (k === pi ? [ll.lat, ll.lng] as LatLng : q)) } : y))); });
      });
    });
    if (drawing?.length) { L.polyline(drawing, { color: "#161a16", dashArray: "5 5" }).addTo(g); drawing.forEach((pt) => L.circleMarker(pt, { radius: 5, color: "#161a16" }).addTo(g)); }
  }, [p.store.zones, p.store.address, drawing]); // eslint-disable-line
  return <div className="stack" style={{ gap: 8 }}>
    <div className="row">
      {drawing ? <><Pill tone="accent">Clique no mapa para marcar os pontos ({drawing.length})</Pill><Btn sm kind="primary" disabled={drawing.length < 3} onClick={() => { const n = p.store.zones.length; p.onChange([...p.store.zones, { id: "z" + Date.now().toString(36), name: `Área ${n + 1}`, kind: "polygon", polygon: drawing, color: COLORS[n % COLORS.length], fee: 7.9, etaMin: 30, etaMax: 45, active: true }]); setDrawing(null); }}>Concluir área</Btn><Btn sm onClick={() => setDrawing(null)}>Cancelar</Btn></> : <Btn sm onClick={() => setDrawing([])}>Desenhar área</Btn>}
    </div>
    <div ref={ref} className="map" role="application" aria-label="Mapa das áreas de entrega" />
  </div>;
}
