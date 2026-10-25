/** Implantação (Setup): passos, formas de pagamento na entrega e cores derivadas da marca. */
import type { PaymentCode, PaymentMethod } from "./types";

export type SetupStepId = "marca" | "culinaria" | "loja" | "cardapio" | "pagamento" | "pedidos" | "whatsapp" | "base" | "publicar";
export const SETUP_STEPS: { id: SetupStepId; label: string; optional?: boolean; hint: string }[] = [
  { id: "marca", label: "Marca", hint: "Nome, endereço do cardápio, logo e cor" },
  { id: "culinaria", label: "Culinária", hint: "Define o modelo de cardápio e as regras do segmento" },
  { id: "loja", label: "Loja e entrega", hint: "Endereço, horários, raio e taxa" },
  { id: "cardapio", label: "Cardápio", hint: "Copiar do iFood, começar do modelo ou do zero" },
  { id: "pagamento", label: "Pagamento", hint: "Maquininha na entrega; online é opcional" },
  { id: "pedidos", label: "Pedidos", hint: "Gestor de pedidos do SuperApp ou PDV" },
  { id: "whatsapp", label: "WhatsApp", hint: "Avisos de pedido, atendimento e campanhas" },
  { id: "base", label: "Base de clientes", optional: true, hint: "Suba clientes e pedidos para o algoritmo achar os perfis" },
  { id: "publicar", label: "Publicar", hint: "Revisão final e link do cardápio" },
];

/** Formas de pagamento na entrega com os códigos da SAIPOS (usados só se o PDV for ligado). */
export const OFFLINE_PAYMENTS: (Omit<PaymentMethod, "active" | "brands"> & { hint: string })[] = [
  { code: "CREDIT_ON_DELIVERY", label: "Crédito na maquininha", saiposCode: "CRE", online: false, hint: "Leva a maquininha" },
  { code: "DEBIT_ON_DELIVERY", label: "Débito na maquininha", saiposCode: "DEB", online: false, hint: "Leva a maquininha" },
  { code: "VR_VA", label: "Vale-refeição", saiposCode: "VALE", online: false, hint: "VR, Alelo, Sodexo, Ticket" },
  { code: "CASH", label: "Dinheiro", saiposCode: "DIN", online: false, hint: "Cliente informa o troco" },
  { code: "CARD_ON_DELIVERY", label: "Pix na maquininha", saiposCode: "CARD", online: false, hint: "QR Code na maquininha da entrega" },
];
export const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express"];
export const VOUCHER_BRANDS = ["Alelo", "Sodexo (Pluxee)", "Ticket", "VR", "Ben"];

/** Monta a lista de pagamentos da loja a partir das escolhas do Setup, preservando o Pix online se houver. */
export function paymentsFromSetup(current: PaymentMethod[], on: PaymentCode[], brands: { card?: string[]; voucher?: string[] }): PaymentMethod[] {
  const online = current.filter((p) => p.online);
  const offline = OFFLINE_PAYMENTS.map(({ hint: _h, ...p }) => ({
    ...p, active: on.includes(p.code),
    ...(p.code === "VR_VA" ? { brands: brands.voucher } : p.code === "CREDIT_ON_DELIVERY" || p.code === "DEBIT_ON_DELIVERY" ? { brands: brands.card } : {}),
  }));
  return [...online, ...offline];
}

/* ---------------- cores ---------------- */
const hex2rgb = (h: string) => { const x = h.replace("#", ""); const n = parseInt(x.length === 3 ? x.split("").map((c) => c + c).join("") : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** A partir da cor principal: tom escuro (texto em botões, hover) e tom claro (fundos). */
export function brandPalette(brand: string) {
  const [r, g, b] = hex2rgb(brand);
  return { brand: rgb2hex(r, g, b), brandDeep: rgb2hex(r * 0.68, g * 0.68, b * 0.68), brandSoft: rgb2hex(r + (255 - r) * 0.9, g + (255 - g) * 0.9, b + (255 - b) * 0.9), ink: "#1B1716" };
}
