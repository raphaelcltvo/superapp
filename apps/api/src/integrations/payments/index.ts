import type { GatewayId } from "@cw/core";
import type { Gateway } from "./types";
import { mercadopago } from "./mercadopago";
import { pagarme } from "./pagarme";
import { asaas } from "./asaas";
import { fake } from "./fake";

export const GATEWAYS: Record<GatewayId, Gateway> = { mercadopago, pagarme, asaas, fake };
export * from "./types";
