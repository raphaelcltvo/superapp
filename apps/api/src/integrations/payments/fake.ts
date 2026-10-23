import type { OnlinePaymentStatus } from "@cw/core";
import { PaymentError, safeEqual, type Gateway } from "./types";

/**
 * Gateway de teste (demonstração e testes automáticos). Nenhum dinheiro circula.
 * Pix: pago ao chamar /public/:slug/payments/fake/:id/pay ou depois de fakeAutoPaySeconds.
 * Cartão: o navegador gera o token fake_tok_<últimos4>_<bandeira>; final 0002 é recusado, o resto aprova.
 */
const state = new Map<string, OnlinePaymentStatus>();
export const fakeState = state;

/** QR "de mentira" em SVG, só para a tela ter o formato real. */
function fakeQr(seed: string) {
  let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  let rects = "";
  for (let y = 0; y < 29; y++) for (let x = 0; x < 29; x++) {
    const fx = x % 22, fy = y % 22, finder = (x < 7 && y < 7) || (x > 21 && y < 7) || (x < 7 && y > 21);
    const on = finder ? fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4) : rnd() > 0.52;
    if (on) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 33 33" shape-rendering="crispEdges"><rect x="-2" y="-2" width="33" height="33" fill="#fff"/><g fill="#111">${rects}</g></svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

export const fake: Gateway = {
  id: "fake",
  label: "Gateway de teste",
  supports: { pix: true, card: true },
  async createPix(c) {
    const id = "fake_pix_" + c.order.id.slice(-10) + "_" + Math.floor(+c.now / 1000).toString(36);
    state.set(id, "pending");
    const qrText = `00020126580014BR.GOV.BCB.PIX0136${id}520400005303986540${c.order.total.toFixed(2).length}${c.order.total.toFixed(2)}5802BR5913SUPERAPP TESTE6009SAO PAULO62070503***6304ABCD`;
    return { chargeId: id, qrText, qrImage: fakeQr(id), expiresAt: new Date(+c.now + c.cfg.pixExpiresMinutes * 60e3).toISOString() };
  },
  async createCard(c, card) {
    const m = card.token.match(/^fake_tok_(\d{4})_([a-z]+)_/);
    if (!m) throw new PaymentError(422, "Token de cartão inválido para o gateway de teste");
    const id = "fake_card_" + c.order.id.slice(-10);
    const declined = m[1] === "0002";
    state.set(id, declined ? "failed" : "paid");
    return { chargeId: id, status: declined ? "failed" : "paid", brand: m[2], last4: m[1], failureReason: declined ? "Cartão recusado pelo banco emissor (cartão de teste)" : undefined };
  },
  async status(_cfg, _http, id) { return state.get(id) || "pending"; },
  async refund(_cfg, _http, id) { state.set(id, "refunded"); },
  async parseWebhook(req, cfg) {
    if (!safeEqual(req.query.token || "", cfg.webhookToken)) throw new PaymentError(401, "Token inválido");
    const b = JSON.parse(req.body || "{}") as { chargeId?: string; status?: OnlinePaymentStatus };
    return b.chargeId && b.status ? { chargeId: b.chargeId, status: b.status } : null;
  },
  async test() { return "Gateway de teste ativo: nenhum dinheiro circula"; },
  publicConfig(cfg) { return { gateway: "fake", env: "sandbox", methods: cfg.methods, maxInstallments: cfg.maxInstallments, requiresDocument: false }; },
};
