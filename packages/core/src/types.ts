/** Tipos de domínio compartilhados entre API, painel e cardápio. Valores em reais (2 casas). */

export type ID = string;

export interface Branding {
  name: string;
  logoUrl?: string;
  coverUrl?: string;
  colors: { brand: string; brandDeep: string; brandSoft: string; ink: string };
  fontDisplay?: string;
  fontText?: string;
}

export interface Tenant {
  id: ID;
  slug: string;
  name: string;
  branding: Branding;
  settings: {
    currency: "BRL";
    timezone: string;
    whatsapp?: string;
    legalName?: string;
    cnpj?: string;
    priceParity?: boolean; // "mesmo preço do balcão"
  };
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface OpeningWindow { weekday: Weekday; open: string; close: string } // "18:00" - "23:30"

export type LatLng = [number, number];
/** Zona desenhada no mapa (polígono) ou raio a partir da loja. Cada zona tem a sua taxa e o seu tempo. */
export interface DeliveryZone {
  id: ID;
  name: string;
  kind: "polygon" | "radius";
  polygon?: LatLng[];
  radiusKm?: number;
  color: string;
  fee: number;
  etaMin: number;
  etaMax: number;
  active: boolean;
}

export type PaymentCode = "PIX_ONLINE" | "CARD_ONLINE" | "CARD_ON_DELIVERY" | "CREDIT_ON_DELIVERY" | "DEBIT_ON_DELIVERY" | "VR_VA" | "CASH";
export interface PaymentMethod { code: PaymentCode; label: string; active: boolean; saiposCode: string; saiposComplement?: string; online: boolean }

export interface Store {
  id: ID;
  tenantId: ID;
  name: string;
  slug: string;
  address: { street: string; number: string; district: string; city: string; state: string; postalCode: string; lat?: number; lng?: number };
  phone?: string;
  hours: OpeningWindow[];
  zones: DeliveryZone[];
  modes: { delivery: boolean; takeout: boolean };
  payments: PaymentMethod[];
  status: "draft" | "live" | "paused";
  pausedReason?: string;
}

export interface Category {
  id: ID;
  name: string;
  slug: string;
  position: number;
  visible: boolean;
  description?: string;
  /** combos e ofertas têm preço fechado: a regra de meio a meio nunca se aplica. */
  pricingLocked?: boolean;
}

/** sum = cada opção soma o seu preço; fraction = meio a meio (cada fração cobra a diferença proporcional ao sabor inteiro). */
export type GroupRule = "sum" | "fraction";

export interface Option {
  id: ID;
  name: string;
  description?: string;
  /** rule=sum: acréscimo da opção. */
  price: number;
  /** rule=fraction: preço do sabor inteiro (ex.: 4 Queijos 40cm = 159). */
  fullPrice?: number;
  imageUrl?: string;
  integrationCode?: string; // código PDV (SAIPOS codigo_saipos)
  active: boolean;
  popular?: boolean;
  tags?: string[];
}

export interface OptionGroup {
  id: ID;
  name: string;
  min: number;
  max: number;
  rule: GroupRule;
  allowRepeat: boolean;
  /** exibe preço por litro quando a opção é bebida (ex.: 1,5). */
  liters?: number;
  options: Option[];
}

export type ItemKind = "simple" | "buildable" | "combo" | "offer";

export interface Preset { id: ID; label: string; title: string; selection: Selection }

export interface Item {
  id: ID;
  categoryId: ID;
  name: string;
  description?: string;
  imageUrl?: string;
  /** fotos por sabor para montar meio a meio na capa do item */
  heroOptionNames?: string[];
  kind: ItemKind;
  /** simple/combo/offer: preço cheio. buildable: preço base (combinação mais barata). */
  price: number;
  compareAt?: number;
  groupIds: ID[];
  presets?: Preset[];
  integrationCode?: string;
  active: boolean;
  available: boolean;
  tags?: string[];
  serves?: string;
  position: number;
  likes?: { pct: number; n: number };
  isDrink?: boolean;
  liters?: number;
}

/** groupId -> optionId -> quantidade */
export type Selection = Record<ID, Record<ID, number>>;

export interface CartLineInput { itemId: ID; qty: number; selection?: Selection; notes?: string }

export interface PricedChoice { groupId: ID; optionId: ID; name: string; qty: number; unitDelta: number; fraction?: string; integrationCode?: string }
export interface PricedLine { itemId: ID; name: string; qty: number; unit: number; total: number; base: number; choices: PricedChoice[]; notes?: string; integrationCode?: string }

/* ---------------- estratégias (regras de frete, taxas, pop-ups) ---------------- */
export type Condition =
  | { field: "subtotal"; op: ">=" | "<"; value: number }
  | { field: "cart_has_item"; itemIds: ID[] }
  | { field: "cart_has_category"; categoryIds: ID[] }
  | { field: "customer_orders"; op: "=" | ">=" | "<="; value: number }
  | { field: "days_since_last_order"; op: "between"; min: number; max: number }
  | { field: "days_since_last_order"; op: ">=" | "<="; value: number }
  | { field: "weekday"; values: Weekday[] }
  | { field: "time"; from: string; to: string }
  | { field: "zone"; zoneIds: ID[] }
  | { field: "segment"; segmentIds: ID[] }
  | { field: "source"; values: string[] }
  | { field: "mode"; values: ("DELIVERY" | "TAKEOUT")[] }
  | { field: "idle_seconds_without_add"; value: number };

export type StrategyAction =
  | { kind: "delivery_fee"; mode: "free" | "fixed" | "percent_off"; value?: number; label?: string }
  | { kind: "service_fee"; amount: number; label: string; feeType: "MIN_ORDER_FEE" | "SERVICE_FEE" }
  | { kind: "popup_coupon"; couponId: ID; title: string; text: string; position: "top-right" | "top" | "bottom"; frequency: "session" | "day" | "once" };

export interface Strategy {
  id: ID;
  name: string;
  description?: string;
  active: boolean;
  priority: number; // menor = avaliada antes
  conditions: Condition[];
  action: StrategyAction;
  /** mostra barra de progresso "faltam R$ X para ..." quando só falta o subtotal */
  showProgress?: boolean;
  progressLabel?: string;
  startsAt?: string;
  endsAt?: string;
}

/* ---------------- ofertas ---------------- */
export type CouponType = "percent" | "amount" | "free_delivery";
export interface Coupon {
  id: ID;
  name: string;
  code?: string; // vazio = automático
  type: CouponType;
  value: number;
  maxDiscount?: number;
  minSubtotal?: number;
  firstOrderOnly?: boolean;
  segmentIds?: ID[];
  itemIds?: ID[];
  categoryIds?: ID[];
  validFrom?: string;
  validTo?: string;
  weekdays?: Weekday[];
  maxUses?: number;
  maxUsesPerCustomer?: number;
  uses?: number;
  /** margem de contribuição média (0-1) usada para o ponto de equilíbrio */
  marginHint?: number;
  active: boolean;
  requiresOptinWhatsapp?: boolean;
}

export interface LoyaltyTier { name: string; minSpend90d: number; earnPercent: number }
export interface LoyaltyProgram {
  active: boolean;
  kind: "cashback";
  earnPercent: number;
  minOrder: number;
  maxEarnPerOrder?: number;
  expiresInDays: number;
  minRedeem: number;
  maxRedeemPercent: number; // % do subtotal que pode ser pago com cashback
  welcomeBonus?: number;
  tiers?: LoyaltyTier[];
  excludedCategoryIds?: ID[];
}
export type LedgerType = "earn" | "redeem" | "expire" | "bonus" | "adjust" | "reverse";
export interface LedgerEntry { id: ID; customerId: ID; type: LedgerType; amount: number; orderId?: ID; createdAt: string; expiresAt?: string; note?: string }

/* ---------------- merchandising ---------------- */
export type BannerSlot = "menu_top" | "below_suggested" | "bag" | "after_order";
export type LinkTarget =
  | { kind: "item"; itemId: ID }
  | { kind: "category"; categoryId: ID }
  | { kind: "page"; pageId: ID }
  | { kind: "url"; url: string }
  | { kind: "none" };
export interface Banner {
  id: ID;
  name: string;
  slot: BannerSlot;
  media: { kind: "image" | "gif" | "video"; url: string; posterUrl?: string; alt: string };
  headline?: string;
  sub?: string;
  cta?: string;
  link: LinkTarget;
  audience: Audience;
  startsAt?: string;
  endsAt?: string;
  priority: number;
  weight?: number; // variantes A/B no mesmo slot
  active: boolean;
}
export interface Audience {
  profiles?: ProfileKey[];
  segmentIds?: ID[];
  sources?: string[]; // utm_source / origem
  weekdays?: Weekday[];
  hours?: [number, number];
  newOnly?: boolean;
}

export type PageBlock =
  | { kind: "hero"; media: Banner["media"]; title: string; text?: string }
  | { kind: "text"; title?: string; text: string }
  | { kind: "items"; title: string; itemIds: ID[] }
  | { kind: "coupon"; couponId: ID; text?: string }
  | { kind: "nps"; id: ID; question: string }
  | { kind: "rating"; id: ID; question: string; scale: 5 }
  | { kind: "choice"; id: ID; question: string; options: string[]; multiple?: boolean }
  | { kind: "open"; id: ID; question: string }
  | { kind: "cta"; label: string; link: LinkTarget };
export interface Page { id: ID; slug: string; title: string; blocks: PageBlock[]; active: boolean; thankYou?: string }
export interface PageResponse { id: ID; pageId: ID; customerId?: ID; sessionId?: ID; answers: Record<ID, string | number | string[]>; createdAt: string }

/* ---------------- personalização ---------------- */
export type ProfileKey = "novo" | "recorrente" | "familia" | "em_risco" | "qualquer";
export interface HeroRule { id: ID; profile: ProfileKey; title: string; kicker: string; sub?: string; action: { kind: "open_item"; itemId: ID } | { kind: "reorder" }; active: boolean; priority: number }
export interface CrossSellRule { id: ID; whenCategoryIds?: ID[]; whenItemIds?: ID[]; suggestItemIds: ID[]; reason: string; active: boolean }
export interface MerchSettings {
  categoryOrderByProfile: Partial<Record<ProfileKey, ID[]>>;
  mostOrdered: { enabled: boolean; itemIds?: ID[]; auto: boolean; title: string };
  heroRules: HeroRule[];
  crossSell: CrossSellRule[];
  hesitationHelpSeconds: number;
  searchInHeader: boolean;
}

/* ---------------- CRM ---------------- */
export type FunnelEvent = "visit" | "item_view" | "add_to_cart" | "cart_view" | "checkout_start" | "order_placed";
export const FUNNEL: FunnelEvent[] = ["visit", "item_view", "add_to_cart", "cart_view", "checkout_start", "order_placed"];
export interface TrackEvent { id: ID; sessionId: ID; customerId?: ID; name: string; ts: string; props?: Record<string, unknown>; source?: string; device?: string }

export interface Customer {
  id: ID;
  name?: string;
  phone?: string; // E.164 sem +
  email?: string;
  document?: string;
  optinWhatsapp?: boolean;
  optinEmail?: boolean;
  emailStatus?: "valid" | "bounced" | "complained" | "unsubscribed";
  birthday?: string;
  source?: string;
  externalIds?: Record<string, string>; // saipos, ifood, importação
  firstOrderAt?: string;
  lastOrderAt?: string;
  orders: number;
  spent: number;
  tags?: string[];
  createdAt: string;
}

export type SegmentRule =
  | { field: "orders"; op: ">=" | "<=" | "="; value: number }
  | { field: "days_since_last_order"; op: ">=" | "<="; value: number }
  | { field: "spent"; op: ">=" | "<="; value: number }
  | { field: "avg_ticket"; op: ">=" | "<="; value: number }
  | { field: "rfm"; op: "in"; value: RfmSegment[] }
  | { field: "source"; op: "in"; value: string[] }
  | { field: "optin_whatsapp"; op: "="; value: boolean }
  | { field: "tag"; op: "in"; value: string[] };
export interface Segment { id: ID; name: string; rules: SegmentRule[]; description?: string }

export type RfmSegment = "campeoes" | "fieis" | "promissores" | "novos" | "em_risco" | "hibernando" | "perdidos";

export type AutomationTrigger =
  | { kind: "cart_abandoned"; afterMinutes: number }
  | { kind: "no_order_cycle"; multiplier: number } // sem pedido há multiplier x intervalo médio do cliente
  | { kind: "days_after_first_order"; days: number }
  | { kind: "birthday" }
  | { kind: "order_concluded"; afterMinutes: number }
  | { kind: "cashback_expiring"; daysBefore: number };
export interface Automation {
  id: ID;
  name: string;
  trigger: AutomationTrigger;
  segmentId?: ID;
  channel: AutomationChannel;
  /** modelo aprovado (WhatsApp) ou e-mail; sem ele, usa o texto de `template` */
  templateId?: ID;
  emailTemplateId?: ID;
  template: string; // {{nome}}, {{cupom}}, {{cashback}}, {{link}}
  couponId?: ID;
  pageId?: ID;
  holdoutPercent: number; // grupo de controle para medir incremento
  quietHours?: [number, number];
  maxPerCustomerPerWeek: number;
  active: boolean;
}

/* ---------------- pedidos ---------------- */
export type OrderStatus = "awaiting_payment" | "payment_failed" | "created" | "sent_to_pos" | "pos_error" | "confirmed" | "ready" | "dispatched" | "concluded" | "cancelled";
export interface Order {
  id: ID;
  displayId: string;
  storeId: ID;
  customerId?: ID;
  sessionId?: ID;
  mode: "DELIVERY" | "TAKEOUT";
  lines: PricedLine[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  baseDeliveryFee?: number;
  fees: { label: string; amount: number; feeType: "MIN_ORDER_FEE" | "SERVICE_FEE" }[];
  strategiesApplied: ID[];
  cashbackUsed: number;
  total: number;
  cashbackEarned: number;
  couponId?: ID;
  payment: { code: PaymentCode; changeFor?: number; online?: OnlinePayment };
  address?: Store["address"] & { complement?: string; reference?: string };
  notes?: string;
  scheduledFor?: string;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string; by: string; note?: string }[];
  pos?: { provider: "saipos"; sentAt?: string; error?: string; payload?: unknown; response?: unknown };
  source?: string;
  createdAt: string;
}

/* ---------------- pagamento online (gateway) ---------------- */
export type GatewayId = "mercadopago" | "pagarme" | "asaas" | "fake";
export type OnlinePaymentStatus = "pending" | "paid" | "failed" | "expired" | "refunded";
export interface OnlinePayment {
  gateway: GatewayId;
  chargeId: string;
  status: OnlinePaymentStatus;
  method: "pix" | "card";
  pix?: { qrText: string; qrImage?: string; expiresAt: string };
  card?: { brand?: string; last4?: string; installments?: number };
  paidAt?: string;
  refundedAt?: string;
  failureReason?: string;
}

/* ---------------- mensagens: WhatsApp e e-mail ---------------- */
export type MessageChannel = "whatsapp" | "email";
export type AutomationChannel = "whatsapp" | "email" | "whatsapp_then_email";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "opened" | "clicked" | "failed" | "bounced" | "controle";
/** origem de cada variável de um modelo */
export type TemplateVar = "nome" | "cupom" | "link" | "marca" | "dias" | "pedido" | "cashback" | "codigo" | "fixo";

export type EmailBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; alt: string; href?: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "items"; title?: string; itemIds: ID[] }
  | { kind: "coupon"; couponId?: ID; text?: string }
  | { kind: "divider" };

export interface MessageTemplate {
  id: ID;
  name: string;
  channel: MessageChannel;
  /** WhatsApp: nome do modelo aprovado na Meta, idioma, categoria e de-para das variáveis {{1}}, {{2}}… */
  waName?: string;
  waLanguage?: string;
  waCategory?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  waBody?: string; // texto como aprovado, para a pré-visualização
  waVars?: { source: TemplateVar; value?: string }[];
  waHeaderImage?: string;
  /** e-mail */
  subject?: string;
  preheader?: string;
  blocks?: EmailBlock[];
  createdAt?: string;
}

export interface Campaign {
  id: ID;
  name: string;
  channel: MessageChannel;
  templateId: ID;
  segmentId?: ID;
  couponId?: ID;
  pageId?: ID;
  scheduleAt?: string; // vazio = enviar ao clicar
  holdoutPercent: number;
  quietHours?: [number, number];
  maxPerCustomerPerWeek: number;
  status: "draft" | "scheduled" | "sending" | "done" | "paused";
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
}

export interface InboxMessage {
  id: ID;
  from: string;
  customerId?: ID;
  name?: string;
  text: string;
  at: string;
  status: "open" | "resolved";
  replies?: { text: string; at: string; by: string; status: string }[];
}
