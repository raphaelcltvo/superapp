import { useMemo, useRef, useState } from "react";

/** Linha com até 2 séries no mesmo eixo, grade discreta, cruz e dica ao passar o mouse. */
export function LineChart(p: { labels: string[]; series: { name: string; values: number[]; color: string; dashed?: boolean }[]; format: (v: number) => string; height?: number }) {
  const W = 640, H = p.height || 200, L = 46, R = 12, T = 12, B = 26;
  const max = Math.max(1, ...p.series.flatMap((s) => s.values));
  const nice = (() => { const m = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / m) * m; })();
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, p.labels.length - 1);
  const y = (v: number) => T + (1 - v / nice) * (H - T - B);
  const [hi, setHi] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const ticks = [0, 0.5, 1].map((f) => f * nice);
  const step = Math.ceil(p.labels.length / 6);
  return <div style={{ position: "relative" }}>
    {p.series.length > 1 && <div className="row small" style={{ gap: 14, marginBottom: 6 }}>{p.series.map((s) => <span key={s.name} className="row" style={{ gap: 6 }}><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} /></svg>{s.name}</span>)}</div>}
    <svg ref={ref} className="viz" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={p.series.map((s) => s.name).join(" e ")}
      onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHi(Math.max(0, Math.min(p.labels.length - 1, Math.round(((px - L) / (W - L - R)) * (p.labels.length - 1))))); }}
      onMouseLeave={() => setHi(null)}>
      {ticks.map((t) => <g key={t}><line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 4} textAnchor="end">{p.format(t)}</text></g>)}
      <line className="axis" x1={L} x2={W - R} y1={H - B} y2={H - B} />
      {p.labels.map((l, i) => i % step === 0 ? <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle">{l}</text> : null)}
      {p.series.map((s) => <path key={s.name} d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />)}
      {p.series[0] && <circle cx={x(p.series[0].values.length - 1)} cy={y(p.series[0].values[p.series[0].values.length - 1] || 0)} r="4" fill={p.series[0].color} stroke="var(--surface)" strokeWidth="2" />}
      {hi !== null && <g><line className="axis" x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} />{p.series.map((s) => <circle key={s.name} cx={x(hi)} cy={y(s.values[hi] || 0)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}</g>}
    </svg>
    {hi !== null && <div className="tip" style={{ left: `${(x(hi) / W) * 100}%`, top: 0, transform: x(hi) > W * 0.7 ? "translateX(-105%)" : "translateX(8px)" }}>
      <b>{p.labels[hi]}</b>{p.series.map((s) => <div key={s.name} className="row" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />{s.name}: <b className="num">{p.format(s.values[hi] || 0)}</b></div>)}
    </div>}
  </div>;
}

/** Funil em barras horizontais (rampa ordinal de uma cor), com % sobre visitas e queda entre etapas. */
const RAMP = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf"];
export function Funnel(p: { rows: { label: string; sessions: number; pctOfVisits: number; pctOfPrev: number; dropFromPrev: number }[] }) {
  const max = Math.max(1, p.rows[0]?.sessions || 1);
  const [hi, setHi] = useState<number | null>(null);
  return <div className="stack" style={{ gap: 6 }} role="list">
    {p.rows.map((r, i) => <div key={r.label} role="listitem" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 120px", gap: 10, alignItems: "center" }}>
      <span className="small" style={{ fontWeight: 600 }}>{r.label}</span>
      <div style={{ position: "relative", height: 26 }}>
        <div style={{ position: "absolute", inset: 0, background: "var(--sunk)", borderRadius: 4 }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(1.5, (r.sessions / max) * 100)}%`, background: RAMP[Math.min(i, RAMP.length - 1)], borderRadius: "0 4px 4px 0", outline: hi === i ? "2px solid var(--ink)" : undefined }} />
        <span className="num small" style={{ position: "absolute", left: 8, top: 4, color: i >= 3 ? "#ffffff" : "#0b0b0b", fontWeight: 650 }}>{r.sessions.toLocaleString("pt-BR")}</span>
      </div>
      <span className="small num" style={{ textAlign: "right" }}><b>{r.pctOfVisits.toFixed(1).replace(".", ",")}%</b>{i > 0 && <span className="muted"> · {r.pctOfPrev.toFixed(0)}% da anterior</span>}</span>
    </div>)}
  </div>;
}

/** Barras horizontais simples (uma série) para distribuições. */
export function Bars(p: { rows: { label: string; value: number; note?: string }[]; format: (v: number) => string; color?: string }) {
  const max = useMemo(() => Math.max(1, ...p.rows.map((r) => r.value)), [p.rows]);
  return <div className="stack" style={{ gap: 6 }}>
    {p.rows.map((r) => <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 140px) minmax(0,1fr) auto", gap: 10, alignItems: "center" }} title={`${r.label}: ${p.format(r.value)}`}>
      <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
      <div style={{ height: 12, background: "var(--sunk)", borderRadius: 3 }}><div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: p.color || "var(--s1)", borderRadius: "0 3px 3px 0" }} /></div>
      <span className="small num">{p.format(r.value)}{r.note && <span className="muted"> · {r.note}</span>}</span>
    </div>)}
  </div>;
}
