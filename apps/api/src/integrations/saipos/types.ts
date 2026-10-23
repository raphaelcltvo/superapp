import type { PaymentCode } from "@cw/core";

/** Configuração do canal SAIPOS por loja (Menu > Canais de Venda e Integrações na conta Saipos). */
export interface SaiposConfig {
  enabled: boolean;
  env: "homolog" | "production";
  idPartner: string;
  secret: string;
  codStore: string; // "ID da loja no parceiro" cadastrado na Saipos
  deliveryBy: "RESTAURANT" | "PARTNER";
  autoSend: boolean;
  /** de-para das formas de pagamento do cardápio para os códigos da Saipos */
  payments: Partial<Record<PaymentCode, { code: string; complement?: string; type: "ONLINE" | "OFFLINE" }>>;
  baseUrl?: string; // sobrescreve (testes / proxy)
  webhookSecret?: string; // token na URL do webhook que a Saipos chama
}

export const SAIPOS_BASE = { production: "https://order-api.saipos.com", homolog: "https://homolog-order-api.saipos.com" } as const;

export const DEFAULT_PAYMENTS: SaiposConfig["payments"] = {
  PIX_ONLINE: { code: "PARTNER_PAYMENT", complement: "pix", type: "ONLINE" },
  CARD_ONLINE: { code: "PARTNER_PAYMENT", complement: "", type: "ONLINE" }, // complemento = bandeira do cartão aprovado
  CARD_ON_DELIVERY: { code: "CARD", type: "OFFLINE" },
  CREDIT_ON_DELIVERY: { code: "CRE", type: "OFFLINE" },
  DEBIT_ON_DELIVERY: { code: "DEB", type: "OFFLINE" },
  VR_VA: { code: "VALE", type: "OFFLINE" },
  CASH: { code: "DIN", type: "OFFLINE" },
};

export interface SaiposChoice { integration_code: string; desc_item_choice: string; aditional_price: number; quantity: number; notes: string }
export interface SaiposItem { integration_code: string; desc_item: string; quantity: number; unit_price: number; notes: string; choice_items: SaiposChoice[] }
export interface SaiposOrder {
  order_id: string;
  display_id: string;
  cod_store: string;
  created_at: string;
  notes: string;
  total_increase: number;
  otherFees?: { description: string; type: "SERVICE_FEE" | "MIN_ORDER_FEE"; liability: "PARTNER" | "RESTAURANT"; value: number }[];
  total_discount: number;
  total_amount: number;
  customer: { id: string; name: string; phone: string; email?: string; document_number?: string; localizer?: string };
  order_method: { mode: "DELIVERY" | "TAKEOUT"; delivery_by?: "RESTAURANT" | "PARTNER"; delivery_fee?: number; scheduled: boolean; delivery_date_time?: string; pickupCode?: string };
  delivery_address?: { country: string; state: string; city: string; district: string; street_name: string; street_number: string; postal_code: string; reference?: string; complement?: string; coordinates?: { latitude: number; longitude: number } };
  items: SaiposItem[];
  payment_types: { code: string; amount: number; change_for: number; complement?: string; type?: "ONLINE" | "OFFLINE" }[];
}

export type SaiposEvent = "CONFIRMED" | "READY_TO_DELIVER" | "DISPATCHED" | "CONCLUDED" | "CANCELLED";

export interface SaiposCatalogRow {
  tipo: string; categoria: string; tamanho: string; id_store_item: number; item: string; id_store_choice: number | null;
  complemento: string; complemento_item: string; price: number; codigo_saipos: string;
  store_item_enabled: "Y" | "N"; store_choice_enabled: "Y" | "N"; store_choice_item_enabled: "Y" | "N";
  item_type: string; min_choices: number | null; max_choices: number | null; calc_method: string | null; print_by_quantity: string | null;
}

export class SaiposError extends Error {
  constructor(public status: number, public code: number | undefined, message: string, public body?: unknown) { super(message); }
}
