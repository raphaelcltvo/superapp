import { z } from "zod";

/** Validação de entrada do painel. Campos opcionais permitem salvar rascunho; a publicação valida o conjunto. */
const id = z.string().min(1);
const money = z.number().min(0).max(100000);
const weekday = z.number().int().min(0).max(6);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const measure = z.object({ unit: z.enum(["g", "kg", "ml", "l", "un"]), amount: z.number().positive().max(100000) });
const availability = z.object({ weekdays: z.array(weekday).optional(), from: hhmm.optional(), to: hhmm.optional() });
const groupRole = z.enum(["size", "base", "flavor", "protein", "addon", "side", "sauce", "instruction", "drink", "dessert"]);

export const linkTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item"), itemId: id }),
  z.object({ kind: z.literal("category"), categoryId: id }),
  z.object({ kind: z.literal("page"), pageId: id }),
  z.object({ kind: z.literal("url"), url: z.string().url() }),
  z.object({ kind: z.literal("none") }),
]);

export const audience = z.object({
  profiles: z.array(z.enum(["novo", "recorrente", "familia", "em_risco", "qualquer"])).optional(),
  segmentIds: z.array(id).optional(),
  sources: z.array(z.string()).optional(),
  weekdays: z.array(weekday).optional(),
  hours: z.tuple([z.number().int().min(0).max(24), z.number().int().min(0).max(24)]).optional(),
  newOnly: z.boolean().optional(),
});

export const schemas = {
  stores: z.object({
    name: z.string().min(1), slug: z.string().min(1),
    address: z.object({ street: z.string(), number: z.string(), district: z.string(), city: z.string(), state: z.string().length(2), postalCode: z.string(), lat: z.number().optional(), lng: z.number().optional() }),
    phone: z.string().optional(),
    hours: z.array(z.object({ weekday, open: hhmm, close: hhmm })),
    zones: z.array(z.object({ id, name: z.string(), kind: z.enum(["polygon", "radius"]), polygon: z.array(z.tuple([z.number(), z.number()])).optional(), radiusKm: z.number().optional(), color: z.string(), fee: money, etaMin: z.number().int(), etaMax: z.number().int(), active: z.boolean() })),
    modes: z.object({ delivery: z.boolean(), takeout: z.boolean() }),
    payments: z.array(z.object({ code: z.enum(["PIX_ONLINE", "CARD_ONLINE", "CARD_ON_DELIVERY", "CREDIT_ON_DELIVERY", "DEBIT_ON_DELIVERY", "VR_VA", "CASH"]), label: z.string(), active: z.boolean(), saiposCode: z.string(), saiposComplement: z.string().optional(), online: z.boolean(), brands: z.array(z.string().max(30)).max(20).optional() })),
    status: z.enum(["draft", "live", "paused"]),
    pausedReason: z.string().optional(),
  }),
  categories: z.object({ name: z.string().min(1), slug: z.string().min(1), position: z.number().int(), visible: z.boolean(), description: z.string().optional(), pricingLocked: z.boolean().optional() }),
  option_groups: z.object({
    name: z.string().min(1), min: z.number().int().min(0), max: z.number().int().min(1), rule: z.enum(["sum", "fraction"]), allowRepeat: z.boolean(), liters: z.number().optional(), freeQuota: z.number().int().min(0).max(50).optional(), role: groupRole.optional(),
    options: z.array(z.object({ id, name: z.string().min(1), description: z.string().optional(), price: money, fullPrice: money.optional(), imageUrl: z.string().optional(), integrationCode: z.string().optional(), active: z.boolean(), popular: z.boolean().optional(), tags: z.array(z.string()).optional(), measure: measure.optional() })),
  }).refine((g) => g.max >= g.min, "máximo menor que mínimo").refine((g) => g.rule === "sum" || g.options.every((o) => o.fullPrice != null), "no meio a meio todo sabor precisa do preço da pizza inteira"),
  items: z.object({
    categoryId: id, name: z.string().min(1), description: z.string().optional(), imageUrl: z.string().optional(), heroOptionNames: z.array(z.string()).optional(),
    kind: z.enum(["simple", "buildable", "combo", "offer"]), price: money, compareAt: money.optional(), groupIds: z.array(id),
    presets: z.array(z.object({ id, label: z.string(), title: z.string(), selection: z.record(z.record(z.number())) })).optional(),
    integrationCode: z.string().optional(), active: z.boolean(), available: z.boolean(), tags: z.array(z.string()).optional(), serves: z.string().optional(), position: z.number().int(),
    likes: z.object({ pct: z.number(), n: z.number() }).optional(), isDrink: z.boolean().optional(), liters: z.number().optional(),
    measure: measure.optional(), leadTimeHours: z.number().min(0).max(24 * 30).optional(), availability: availability.optional(), importedFrom: z.object({ source: z.literal("ifood"), id: z.string() }).optional(),
  }),
  strategies: z.object({
    name: z.string().min(1), description: z.string().optional(), active: z.boolean(), priority: z.number().int(),
    conditions: z.array(z.record(z.unknown()).and(z.object({ field: z.string() }))),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("delivery_fee"), mode: z.enum(["free", "fixed", "percent_off"]), value: z.number().optional(), label: z.string().optional() }),
      z.object({ kind: z.literal("service_fee"), amount: money, label: z.string(), feeType: z.enum(["MIN_ORDER_FEE", "SERVICE_FEE"]) }),
      z.object({ kind: z.literal("popup_coupon"), couponId: z.string(), title: z.string(), text: z.string(), position: z.enum(["top-right", "top", "bottom"]), frequency: z.enum(["session", "day", "once"]) }),
    ]),
    showProgress: z.boolean().optional(), progressLabel: z.string().optional(), startsAt: z.string().optional(), endsAt: z.string().optional(),
  }),
  coupons: z.object({
    name: z.string().min(1), code: z.string().regex(/^[A-Z0-9_-]*$/, "use letras maiúsculas e números").optional(), type: z.enum(["percent", "amount", "free_delivery"]), value: z.number().min(0),
    maxDiscount: money.optional(), minSubtotal: money.optional(), firstOrderOnly: z.boolean().optional(), segmentIds: z.array(id).optional(), itemIds: z.array(id).optional(), categoryIds: z.array(id).optional(),
    validFrom: z.string().optional(), validTo: z.string().optional(), weekdays: z.array(weekday).optional(), maxUses: z.number().int().optional(), maxUsesPerCustomer: z.number().int().optional(),
    marginHint: z.number().min(0).max(1).optional(), active: z.boolean(), requiresOptinWhatsapp: z.boolean().optional(), uses: z.number().int().optional(),
  }),
  banners: z.object({
    name: z.string().min(1), slot: z.enum(["menu_top", "below_suggested", "bag", "after_order"]),
    media: z.object({ kind: z.enum(["image", "gif", "video"]), url: z.string().min(1), posterUrl: z.string().optional(), alt: z.string() }),
    headline: z.string().optional(), sub: z.string().optional(), cta: z.string().optional(), link: linkTarget, audience,
    startsAt: z.string().optional(), endsAt: z.string().optional(), priority: z.number().int(), weight: z.number().optional(), active: z.boolean(),
  }),
  pages: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1), blocks: z.array(z.record(z.unknown()).and(z.object({ kind: z.string() }))), active: z.boolean(), thankYou: z.string().optional() }),
  segments: z.object({ name: z.string().min(1), description: z.string().optional(), rules: z.array(z.record(z.unknown()).and(z.object({ field: z.string() }))) }),
  automations: z.object({
    name: z.string().min(1), trigger: z.record(z.unknown()).and(z.object({ kind: z.string() })), segmentId: z.string().optional(), channel: z.enum(["whatsapp", "email", "whatsapp_then_email"]), template: z.string().min(1), templateId: z.string().optional(), emailTemplateId: z.string().optional(),
    couponId: z.string().optional(), pageId: z.string().optional(), holdoutPercent: z.number().min(0).max(50), quietHours: z.tuple([z.number(), z.number()]).optional(), maxPerCustomerPerWeek: z.number().int().min(1), active: z.boolean(),
  }),
  message_templates: z.object({
    name: z.string().min(1), channel: z.enum(["whatsapp", "email"]),
    waName: z.string().regex(/^[a-z0-9_]*$/, "nome do modelo na Meta: minúsculas, números e _").optional(), waLanguage: z.string().optional(), waCategory: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(), waBody: z.string().optional(),
    waVars: z.array(z.object({ source: z.enum(["nome", "cupom", "link", "marca", "dias", "pedido", "cashback", "codigo", "fixo"]), value: z.string().optional() })).optional(), waHeaderImage: z.string().optional(),
    subject: z.string().optional(), preheader: z.string().optional(), blocks: z.array(z.record(z.unknown()).and(z.object({ kind: z.enum(["heading", "text", "image", "button", "items", "coupon", "divider"]) }))).optional(),
  }).refine((t) => t.channel === "email" ? !!t.subject : true, "e-mail precisa de assunto"),
  campaigns: z.object({
    name: z.string().min(1), channel: z.enum(["whatsapp", "email"]), templateId: z.string().min(1), segmentId: z.string().optional(), couponId: z.string().optional(), pageId: z.string().optional(),
    scheduleAt: z.string().optional(), holdoutPercent: z.number().min(0).max(50), quietHours: z.tuple([z.number(), z.number()]).optional(), maxPerCustomerPerWeek: z.number().int().min(1),
    status: z.enum(["draft", "scheduled", "sending", "done", "paused"]),
  }),
  webhooks: z.object({ url: z.string().url(), events: z.array(z.enum(["order.created", "order.status", "customer.created", "page.response"])), secret: z.string().min(8), active: z.boolean() }),
} as const;

export type CrudTable = keyof typeof schemas;

export const loyaltySchema = z.object({
  active: z.boolean(), kind: z.literal("cashback"), earnPercent: z.number().min(0).max(50), minOrder: money, maxEarnPerOrder: money.optional(), expiresInDays: z.number().int().min(1),
  minRedeem: money, maxRedeemPercent: z.number().min(0).max(100), welcomeBonus: money.optional(),
  tiers: z.array(z.object({ name: z.string(), minSpend90d: money, earnPercent: z.number() })).optional(), excludedCategoryIds: z.array(id).optional(),
});

export const merchSchema = z.object({
  categoryOrderByProfile: z.record(z.array(id)),
  mostOrdered: z.object({ enabled: z.boolean(), itemIds: z.array(id).optional(), auto: z.boolean(), title: z.string() }),
  heroRules: z.array(z.object({ id, profile: z.enum(["novo", "recorrente", "familia", "em_risco", "qualquer"]), title: z.string(), kicker: z.string(), sub: z.string().optional(), action: z.union([z.object({ kind: z.literal("open_item"), itemId: id }), z.object({ kind: z.literal("reorder") })]), active: z.boolean(), priority: z.number() })),
  crossSell: z.array(z.object({ id, whenCategoryIds: z.array(id).optional(), whenItemIds: z.array(id).optional(), suggestItemIds: z.array(id), reason: z.string(), active: z.boolean() })),
  hesitationHelpSeconds: z.number().int().min(0),
  searchInHeader: z.boolean(),
});

export const brandSchema = z.object({
  name: z.string().min(1),
  branding: z.object({ name: z.string(), logoUrl: z.string().optional(), coverUrl: z.string().optional(), colors: z.object({ brand: z.string(), brandDeep: z.string(), brandSoft: z.string(), ink: z.string() }), fontDisplay: z.string().optional(), fontText: z.string().optional() }),
  settings: z.object({ currency: z.literal("BRL"), timezone: z.string(), whatsapp: z.string().optional(), legalName: z.string().optional(), cnpj: z.string().optional(), priceParity: z.boolean().optional(),
    cuisine: z.enum(["pizza", "hamburguer", "japonesa", "acai", "confeitaria", "churrasco", "marmita", "arabe", "salgados", "poke", "padaria", "saudavel", "italiana", "mexicana", "bar", "generico"]).optional(),
    cuisines: z.array(z.string()).max(6).optional(), instagram: z.string().max(60).optional() }),
});

export const saiposConfigSchema = z.object({
  enabled: z.boolean(), env: z.enum(["homolog", "production"]), idPartner: z.string(), secret: z.string(), codStore: z.string(), deliveryBy: z.enum(["RESTAURANT", "PARTNER"]), autoSend: z.boolean(),
  payments: z.record(z.object({ code: z.string(), complement: z.string().optional(), type: z.enum(["ONLINE", "OFFLINE"]) })), baseUrl: z.string().optional(), webhookSecret: z.string().optional(),
});

export const checkoutSchema = z.object({
  storeId: id,
  sessionId: z.string().optional(),
  source: z.string().optional(),
  mode: z.enum(["DELIVERY", "TAKEOUT"]),
  lines: z.array(z.object({ itemId: id, qty: z.number().int().min(1).max(50), selection: z.record(z.record(z.number().int().min(0))).optional(), notes: z.string().max(140).optional() })).min(1),
  address: z.object({ street: z.string(), number: z.string(), district: z.string(), city: z.string(), state: z.string(), postalCode: z.string(), complement: z.string().optional(), reference: z.string().optional(), lat: z.number().optional(), lng: z.number().optional() }).optional(),
  payment: z.object({
    code: z.enum(["PIX_ONLINE", "CARD_ONLINE", "CARD_ON_DELIVERY", "CREDIT_ON_DELIVERY", "DEBIT_ON_DELIVERY", "VR_VA", "CASH"]), changeFor: z.number().optional(),
    // cartão online: só o token gerado no navegador pelo gateway (número do cartão nunca chega aqui)
    cardToken: z.string().max(200).optional(), installments: z.number().int().min(1).max(12).optional(), cardBrand: z.string().max(20).optional(), cardLast4: z.string().regex(/^\d{4}$/).optional(), issuerId: z.string().max(20).optional(),
  }),
  customerDocument: z.string().max(18).optional(),
  couponCode: z.string().optional(),
  useCashback: z.boolean().optional(),
  notes: z.string().max(300).optional(),
  scheduledFor: z.string().optional(),
  customer: z.object({ name: z.string().min(1), phone: z.string().min(10), email: z.string().email().optional(), optinWhatsapp: z.boolean().optional() }).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const paymentsConfigSchema = z.object({
  enabled: z.boolean(), gateway: z.enum(["mercadopago", "pagarme", "asaas", "fake"]), env: z.enum(["sandbox", "production"]),
  accessToken: z.string().optional(), publicKey: z.string().optional(), secretKey: z.string().optional(), apiKey: z.string().optional(), webhookSecret: z.string().optional(),
  methods: z.object({ pix: z.boolean(), card: z.boolean() }), pixExpiresMinutes: z.number().int().min(2).max(1440), maxInstallments: z.number().int().min(1).max(12),
  softDescriptor: z.string().max(13).optional(), captureOnlyIfStoreOpen: z.boolean().optional(), baseUrl: z.string().optional(), fakeAutoPaySeconds: z.number().int().min(0).max(600).optional(), requirePassword: z.boolean().optional(),
});
export const whatsappConfigSchema = z.object({
  enabled: z.boolean(), provider: z.enum(["meta", "zapi", "evolution", "fake"]),
  phoneNumberId: z.string().optional(), wabaId: z.string().optional(), token: z.string().optional(), appSecret: z.string().optional(), verifyToken: z.string().optional(),
  graphVersion: z.string().optional(), otpTemplate: z.object({ name: z.string(), language: z.string() }).optional(), costPerMessage: z.number().optional(),
  zapi: z.object({ instanceId: z.string().min(1), instanceToken: z.string().min(1), clientToken: z.string().optional(), baseUrl: z.string().url().optional() }).optional(),
  evolution: z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1), instance: z.string().min(1).max(60) }).optional(),
  webhookToken: z.string().optional(),
  dailyCap: z.number().int().min(1).max(5000).optional(), perTick: z.number().int().min(1).max(60).optional(),
}).superRefine((c, x) => {
  const need = (ok: unknown, msg: string) => { if (!ok) x.addIssue({ code: "custom", message: msg }); };
  if (c.provider === "meta") need(c.phoneNumberId && c.token && c.appSecret && c.verifyToken, "API oficial: informe ID do número, token, App Secret e token de verificação");
  if (c.provider === "zapi") need(c.zapi, "Z-API: informe o ID e o token da instância");
  if (c.provider === "evolution") need(c.evolution, "Evolution API: informe a URL, a chave e o nome da instância");
});
const notifyRule = z.object({ enabled: z.boolean(), text: z.string().min(3).max(1000), waName: z.string().max(120).optional().or(z.literal("")), waLanguage: z.string().max(10).optional() });
export const notificationsSchema = z.object({ enabled: z.boolean(), events: z.object({ confirmed: notifyRule, ready: notifyRule, dispatched: notifyRule, concluded: notifyRule, cancelled: notifyRule }) });
export const emailConfigSchema = z.object({
  enabled: z.boolean(), provider: z.enum(["resend", "brevo", "fake"]), apiKey: z.string(), fromName: z.string().min(1), fromEmail: z.string().email(), replyTo: z.string().email().optional().or(z.literal("")), webhookToken: z.string().optional(),
});
