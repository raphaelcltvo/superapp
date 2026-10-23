import type { Branding, Coupon, EmailBlock, Item, OptionGroup } from "@cw/core";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const fillVars = (t: string, v: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? "");
const BRL = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

export interface RenderInput {
  brand: Branding;
  subject: string;
  preheader?: string;
  blocks: EmailBlock[];
  vars: Record<string, string>;
  items: Record<string, Item>;
  groups: Record<string, OptionGroup>;
  coupons: Record<string, Coupon>;
  couponId?: string;
  ctaLink: string;
  unsubscribeUrl: string;
  address?: string;
}

function itemImage(it: Item, groups: Record<string, OptionGroup>) {
  if (it.imageUrl) return it.imageUrl;
  const n = it.heroOptionNames?.[0];
  if (!n) return undefined;
  for (const gid of it.groupIds) { const o = groups[gid]?.options.find((x) => x.name === n && x.imageUrl); if (o) return o.imageUrl; }
  return undefined;
}

/** E-mail responsivo em tabelas (funciona no Gmail, Outlook e Apple Mail), com as cores e a logo da marca. */
export function renderEmail(r: RenderInput): { html: string; text: string; subject: string } {
  const c = r.brand.colors;
  const v = r.vars;
  const out: string[] = [];
  const txt: string[] = [];
  const td = (inner: string, pad = "8px 32px") => `<tr><td style="padding:${pad}">${inner}</td></tr>`;
  for (const b of r.blocks) {
    if (b.kind === "heading") { out.push(td(`<h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.2;color:${c.ink}">${esc(fillVars(b.text, v))}</h1>`, "20px 32px 6px")); txt.push(fillVars(b.text, v).toUpperCase()); }
    if (b.kind === "text") { out.push(td(`<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#333">${esc(fillVars(b.text, v)).replace(/\n/g, "<br>")}</p>`)); txt.push(fillVars(b.text, v)); }
    if (b.kind === "image") { const img = `<img src="${esc(b.url)}" alt="${esc(b.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:12px">`; out.push(td(b.href ? `<a href="${esc(fillVars(b.href, v))}">${img}</a>` : img, "12px 32px")); }
    if (b.kind === "button") { const href = fillVars(b.href || "{{link}}", v); out.push(td(`<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:${c.brand}"><a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">${esc(fillVars(b.label, v))}</a></td></tr></table>`, "14px 32px")); txt.push(`${fillVars(b.label, v)}: ${href}`); }
    if (b.kind === "divider") out.push(td(`<hr style="border:0;border-top:1px solid #eee;margin:8px 0">`));
    if (b.kind === "items") {
      const list = b.itemIds.map((id) => r.items[id]).filter(Boolean);
      if (b.title) out.push(td(`<h2 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:19px;color:${c.ink}">${esc(b.title)}</h2>`, "18px 32px 4px"));
      for (const it of list) {
        const img = itemImage(it, r.groups);
        out.push(td(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${img ? `<td width="96" valign="top"><img src="${esc(img)}" alt="" width="88" height="88" style="display:block;width:88px;height:88px;object-fit:cover;border-radius:10px"></td>` : ""}<td valign="top" style="font-family:Arial,Helvetica,sans-serif"><a href="${esc(r.ctaLink)}" style="color:${c.ink};text-decoration:none;font-size:15px;font-weight:bold">${esc(it.name.split(" · ")[0])}</a><div style="font-size:13px;color:#666;line-height:1.4;margin-top:3px">${esc(it.description || "")}</div><div style="font-size:15px;font-weight:bold;color:${c.brand};margin-top:6px">${it.kind === "buildable" ? "a partir de " : ""}${BRL(it.price)}${it.compareAt ? ` <s style="color:#999;font-weight:normal">${BRL(it.compareAt)}</s>` : ""}</div></td></tr></table>`, "8px 32px"));
        txt.push(`- ${it.name}: ${BRL(it.price)}`);
      }
    }
    if (b.kind === "coupon") {
      const cp = r.coupons[b.couponId || r.couponId || ""];
      if (cp?.code) { out.push(td(`<div style="border:2px dashed ${c.brand};border-radius:12px;padding:16px;text-align:center;font-family:Arial,Helvetica,sans-serif;background:${c.brandSoft}">${b.text ? `<div style="font-size:14px;color:#333;margin-bottom:6px">${esc(fillVars(b.text, v))}</div>` : ""}<div style="font-size:24px;font-weight:bold;letter-spacing:2px;color:${c.brandDeep}">${esc(cp.code)}</div><div style="font-size:12px;color:#666;margin-top:4px">${esc(cp.name)}</div></div>`, "12px 32px")); txt.push(`Cupom: ${cp.code} (${cp.name})`); }
    }
  }
  const subject = fillVars(r.subject, v);
  const pre = r.preheader ? fillVars(r.preheader, v) : "";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f1ee">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f1ee"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:${c.brand};padding:18px 32px">${r.brand.logoUrl ? `<img src="${esc(r.brand.logoUrl)}" alt="${esc(r.brand.name)}" width="56" height="56" style="display:block;border-radius:50%;border:2px solid #fff">` : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#fff">${esc(r.brand.name)}</span>`}</td></tr>
${out.join("\n")}
<tr><td style="padding:24px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#888">Você recebe este e-mail porque aceitou novidades da ${esc(r.brand.name)}.${r.address ? ` ${esc(r.address)}.` : ""}<br><a href="${esc(r.unsubscribeUrl)}" style="color:#888">Não quero mais receber e-mails</a></td></tr>
</table></td></tr></table></body></html>`;
  txt.push("", `Para não receber mais: ${r.unsubscribeUrl}`);
  return { html, text: txt.join("\n"), subject };
}

/** Troca cada link pelo redirecionador de cliques e adiciona o pixel de abertura. Devolve os links originais (lista branca do redirecionador). */
export function instrument(html: string, opts: { clickBase: string; pixelUrl: string; skip: (url: string) => boolean }) {
  const links: string[] = [];
  const out = html.replace(/href="([^"]+)"/g, (m, raw: string) => {
    const url = raw.replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url) || opts.skip(url)) return m;
    if (!links.includes(url)) links.push(url);
    return `href="${opts.clickBase}?u=${encodeURIComponent(url)}"`;
  });
  return { html: out.replace("</body>", `<img src="${opts.pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0"></body>`), links };
}
