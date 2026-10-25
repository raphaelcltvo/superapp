import { DEFAULT_ENGAGEMENT, npsKind, priceLine, r2, slugify, uid, type Automation, type Banner, type Campaign, type MessageTemplate, type Category, type Coupon, type Customer, type EngagementSettings, type Item, type LoyaltyProgram, type MerchSettings, type Option, type OptionGroup, type Order, type Page, type Segment, type Store, type Strategy, type Tenant } from "@cw/core";
import type { Db } from "../db/types";
import { hashPassword } from "../auth";
import { seedFirstVisit } from "./firstvisit";

/**
 * Marca de exemplo: Forneria Original (cardápio importado do iFood, preços da tabela de reajuste set/2026).
 * `photo(nome)` devolve a URL da foto de cada sabor; `history` gera 90 dias de navegação e pedidos sintéticos para o CRM.
 */
export interface SeedOpts { photo: (name: string) => string | undefined; media: { cover?: string; logo?: string; video?: string; poster?: string; gif?: string }; history?: boolean; now?: Date; password?: string; email?: string }

const BORDAS = ["Recheada de Catupiry", "Recheada de cream cheese Philadelphia", "Recheada Catupiry e goiabada", "Recheada de goiabada", "Recheada de doce de leite", "Recheada de creme de avelã"];
const S40: [string, number][] = [["3 Queijos Gratinada", 139], ["4 Queijos", 159], ["A Moda", 169], ["Abobrinha", 119], ["Alho", 109], ["Apimentada Original", 129], ["Atum com Cebola", 175], ["Bacon com ovos", 169], ["Bruschetta de abobrinha", 115], ["Calabresa", 108], ["Calabresa Gourmet", 118], ["Calabresa Seara sem muçarela", 99], ["Calabresa Seara com Gorgonzola", 119], ["Camarão com alho poró e cream cheese Philadelphia", 199], ["Camarão com Catupiry", 189], ["Caprese Original com Catupiry", 114], ["Caprese Parma com Catupiry", 149], ["Carioca", 130], ["Carne seca com Catupiry", 219], ["Catuperoni", 185], ["Catupiresa", 139], ["Catupiresa especial", 159], ["Champignon", 118], ["Da Barra", 139], ["Frango Caipira", 149], ["Frango Caipira com Catupiry", 179], ["Frango com Bacon Seara e Cream Cheese", 180], ["Frango com Catupiry", 172], ["Genovesa", 129], ["Lombiry", 169], ["Lombo canadense", 129], ["Lombo Original", 139], ["Marguerita", 104], ["Marguerita especial", 114], ["Marguerita romana", 119], ["Marinara", 126], ["Muçarela", 104], ["Muçarela com Catupiry", 139], ["Napolitana", 125], ["Palmito", 129], ["Parma e Pesto", 140], ["Pepperoni", 159], ["Pomodoro", 104], ["Portuguesa", 135], ["Presunto", 115], ["Presunto com champignon", 133], ["Lombo com Pesto e Parmesão (Nigro)", 154], ["Carne Seca com Queijo Coalho e Melado", 197], ["Tomate seco e rúcula", 109]];
const S99 = ["Calabresa Seara sem muçarela", "Muçarela", "Pomodoro", "Marguerita", "Marinara", "Marguerita romana", "Bruschetta de abobrinha", "Alho", "Caprese Original com Catupiry"];
const S119: [string, number][] = [...["Marguerita", "Muçarela", "Pomodoro", "Caprese Original com Catupiry", "Marinara", "Marguerita romana", "Calabresa Seara sem muçarela", "Bruschetta de abobrinha", "Alho"].map((n) => [n, 0] as [string, number]), ["Calabresa", 1], ["Tomate seco e rúcula", 2], ["Apimentada Original", 4], ["Calabresa Seara com Gorgonzola", 5]];
const S149: [string, number][] = [...["Bruschetta de abobrinha", "Calabresa Seara sem muçarela", "Caprese Original com Catupiry", "Marinara", "Marguerita", "Marguerita romana", "Muçarela", "Pomodoro"].map((n) => [n, 0] as [string, number]), ["Calabresa", 2], ["Marguerita especial", 2], ["Portuguesa", 6], ["Catupiresa", 19], ["4 Queijos", 26], ["Frango com Catupiry", 33]];
const D20 = ["Banana caramelizada", "Banana com canela", "Banana com creme de avelã", "Banoffee", "Creme de Avelã com Morango", "Cheesecake de frutas vermelhas", "Cheesecake Doce de Leite", "Doce de leite com banana", "Dulce de Leche Tostine", "Negresco", "Romeu e Julieta"];

export async function seedForneria(db: Db, o: SeedOpts) {
  const now = o.now || new Date();
  const iso = (d: Date) => d.toISOString();
  const tenant: Tenant = {
    id: "ten_forneria", slug: "forneria-original", name: "Forneria Original",
    branding: { name: "Forneria Original", logoUrl: o.media.logo, coverUrl: o.media.cover, colors: { brand: "#A3191F", brandDeep: "#6F0E12", brandSoft: "#FBE9E8", ink: "#1B1716" }, fontDisplay: "Barlow Condensed", fontText: "Barlow" },
    settings: { currency: "BRL", timezone: "America/Sao_Paulo", whatsapp: "5521999990000", legalName: "Forneria Original", priceParity: true },
  };
  await db.tenants.put(tenant as never);
  const T = tenant.id;
  await db.put("users", T, { id: "usr_owner", name: "Raphael", email: (o.email || "demo@forneria.com.br").toLowerCase(), role: "owner", passwordHash: await hashPassword(o.password || "forneria2026"), createdAt: iso(now) });

  let pdv = 70000;
  const code = () => String(++pdv);
  const opt = (name: string, price = 0, extra: Partial<Option> = {}): Option => ({ id: slugify(name).slice(0, 40), name, price, active: true, imageUrl: o.photo(name), integrationCode: code(), ...extra });

  /* loja e áreas desenhadas no mapa */
  const store: Store = {
    id: "sto_leblon", tenantId: T, name: "Leblon", slug: "leblon",
    address: { street: "Rua Dias Ferreira", number: "233", district: "Leblon", city: "Rio de Janeiro", state: "RJ", postalCode: "22431-050", lat: -22.9834, lng: -43.2245 },
    phone: "552125120000",
    hours: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w as 0, open: "17:30", close: w === 5 || w === 6 ? "01:00" : "23:59" })),
    zones: [
      { id: "z_leblon", name: "Leblon", kind: "polygon", color: "#2F6B3F", fee: 4.9, etaMin: 20, etaMax: 30, active: true, polygon: [[-22.9795, -43.2340], [-22.9780, -43.2160], [-22.9850, -43.2150], [-22.9895, -43.2215], [-22.9885, -43.2335]] },
      { id: "z_ipanema", name: "Ipanema e Lagoa", kind: "polygon", color: "#1F5F8B", fee: 6.9, etaMin: 25, etaMax: 40, active: true, polygon: [[-22.9780, -43.2160], [-22.9700, -43.2000], [-22.9790, -43.1930], [-22.9880, -43.1960], [-22.9850, -43.2150]] },
      { id: "z_gavea", name: "Gávea e Jardim Botânico", kind: "polygon", color: "#B26B00", fee: 8.9, etaMin: 30, etaMax: 45, active: true, polygon: [[-22.9795, -43.2340], [-22.9700, -43.2420], [-22.9580, -43.2300], [-22.9600, -43.2120], [-22.9700, -43.2000], [-22.9780, -43.2160]] },
    ],
    modes: { delivery: true, takeout: true },
    payments: [
      { code: "PIX_ONLINE", label: "Pix", active: true, saiposCode: "PARTNER_PAYMENT", saiposComplement: "pix", online: true },
      { code: "CARD_ON_DELIVERY", label: "Cartão na entrega", active: true, saiposCode: "CARD", online: false },
      { code: "VR_VA", label: "VR / VA", active: true, saiposCode: "VALE", online: false },
      { code: "CASH", label: "Dinheiro", active: true, saiposCode: "DIN", online: false },
    ],
    status: "live",
  };
  await db.put("stores", T, store as never);

  /* categorias */
  const cats: Category[] = [
    { id: "cat_combos", name: "Combos", slug: "combos", position: 0, visible: true, pricingLocked: true, description: "Preço fechado" },
    { id: "cat_imbat", name: "Imbatíveis · meia a meia", slug: "imbativeis", position: 1, visible: true, pricingLocked: true },
    { id: "cat_salg", name: "Pizzas salgadas", slug: "salgadas", position: 2, visible: true },
    { id: "cat_doces", name: "Pizzas doces 20cm", slug: "doces", position: 3, visible: true },
    { id: "cat_bebidas", name: "Bebidas", slug: "bebidas", position: 4, visible: true, description: "1,5l sai por R$ 9,33/L; a lata, R$ 25,43/L" },
  ];
  for (const c of cats) await db.put("categories", T, c as never);

  /* grupos de complementos */
  const massa = (id: string, cm: number, extra: number, bordas = BORDAS): OptionGroup => ({ id, name: `Massa ${cm}cm`, min: 1, max: 1, rule: "sum", allowRepeat: false, options: [opt("Gourmet", 0, { id: "gourmet", description: "Mais grossa e aerada", popular: true }), opt("Fina", 0, { id: "fina", description: "Sem borda e crocante" }), ...bordas.map((b) => opt(b, extra))] });
  const groups: OptionGroup[] = [
    massa("g_massa40", 40, 32), massa("g_massa30", 30, 26), massa("g_massa40c3", 40, 32, [BORDAS[0], BORDAS[1], BORDAS[4], BORDAS[5]]),
    { id: "g_sab40", name: "Sabores 40cm", min: 2, max: 2, rule: "fraction", allowRepeat: true, options: S40.map(([n, full]) => opt(n, 0, { fullPrice: full })) },
    { id: "g_sab99", name: "Pizza salgada 40cm", min: 2, max: 2, rule: "sum", allowRepeat: true, options: S99.map((n) => opt(n)) },
    { id: "g_sab119", name: "Pizza salgada 30cm", min: 2, max: 2, rule: "sum", allowRepeat: true, options: S119.map(([n, p]) => opt(n, p)) },
    { id: "g_sab149", name: "Pizza salgada 40cm", min: 2, max: 2, rule: "sum", allowRepeat: true, options: S149.map(([n, p]) => opt(n, p)) },
    { id: "g_doce20", name: "Pizza doce 20cm (1 sabor)", min: 1, max: 1, rule: "sum", allowRepeat: false, options: D20.map((n) => opt(n)) },
    { id: "g_doce20c2", name: "Pizza doce 20cm (1 sabor)", min: 1, max: 1, rule: "sum", allowRepeat: false, options: D20.slice(0, 9).map((n) => opt(n)) },
    { id: "g_bebida", name: "Deseja bebida?", min: 0, max: 5, rule: "sum", allowRepeat: true, liters: 1.5, options: [opt("Coca-Cola Original 1,5l", 16), opt("Coca-Cola sem Açúcar 1,5l", 16), opt("Guaraná Antarctica 1,5l", 16, { popular: true }), opt("Guaraná Antarctica Zero 1,5l", 16)] },
  ];
  for (const g of groups) await db.put("option_groups", T, g as never);
  const G = Object.fromEntries(groups.map((g) => [g.id, g]));
  const oid = (g: string, name: string) => G[g].options.find((x) => x.name === name)!.id;

  /* itens */
  const half = (a: string, b: string) => [a, b];
  const items: Item[] = [
    { id: "m1", categoryId: "cat_imbat", name: "1/2 Calabresa + 1/2 Marguerita · 30cm", description: "Calabresa Seara, muçarela e cebola + tomate, manjericão e muçarela.", kind: "offer", price: 81, compareAt: 83.5, groupIds: ["g_massa30", "g_bebida"], heroOptionNames: half("Calabresa", "Marguerita"), likes: { pct: 94, n: 210 }, tags: ["#1 mais curtido"] },
    { id: "m2", categoryId: "cat_imbat", name: "1/2 Muçarela + 1/2 Marguerita romana · 30cm", description: "Muçarela e orégano + tomate, cebola, azeitona preta e manjericão.", kind: "offer", price: 79, compareAt: 81.5, groupIds: ["g_massa30", "g_bebida"], heroOptionNames: half("Muçarela", "Marguerita romana"), likes: { pct: 92, n: 164 } },
    { id: "m3", categoryId: "cat_imbat", name: "1/2 Caprese Original c/ Catupiry + 1/2 Bruschetta de abobrinha · 30cm", description: "Búfala, tomate fatiado e Catupiry + abobrinha, pesto e parmesão.", kind: "offer", price: 79, compareAt: 86.5, groupIds: ["g_massa30", "g_bebida"], heroOptionNames: half("Caprese Original com Catupiry", "Bruschetta de abobrinha"), likes: { pct: 95, n: 121 } },
    { id: "m4", categoryId: "cat_imbat", name: "1/2 Catupiresa + 1/2 Pomodoro · 30cm", description: "Calabresa Seara e Catupiry + tomate picado, búfala e manjericão.", kind: "offer", price: 92, compareAt: 96.5, groupIds: ["g_massa30", "g_bebida"], heroOptionNames: half("Catupiresa", "Pomodoro"), likes: { pct: 93, n: 98 } },
    { id: "m5", categoryId: "cat_imbat", name: "1/2 Frango c/ Catupiry + 1/2 Calabresa Seara s/ muçarela · 30cm", description: "Frango e Catupiry + calabresa Seara, tomate picado e cebola.", kind: "offer", price: 95, compareAt: 100, groupIds: ["g_massa30", "g_bebida"], heroOptionNames: half("Frango com Catupiry", "Calabresa Seara sem muçarela"), likes: { pct: 90, n: 77 } },
    { id: "m6", categoryId: "cat_imbat", name: "1/2 Portuguesa + 1/2 Marinara · 30cm", description: "Presunto, ovos e azeitona + búfala, alho em lascas e tomate cereja.", kind: "offer", price: 99, compareAt: 107, groupIds: ["g_massa30", "g_bebida"], heroOptionNames: half("Portuguesa", "Marinara"), likes: { pct: 91, n: 64 } },
    { id: "c1", categoryId: "cat_combos", name: "Pizza 40cm (8 fatias) por R$ 99 · qualquer sabor", description: "Até dois sabores por pizza, para você experimentar.", kind: "combo", price: 99, groupIds: ["g_massa40", "g_sab99", "g_bebida"], heroOptionNames: half("Marguerita", "Muçarela"), likes: { pct: 96, n: 388 },
      presets: [{ id: "p1", label: "#1 · pedido por 120+ pessoas este mês", title: "1/2 Marguerita + 1/2 Muçarela · Gourmet", selection: { g_massa40: { gourmet: 1 }, g_sab99: { [oid("g_sab99", "Marguerita")]: 1, [oid("g_sab99", "Muçarela")]: 1 } } }, { id: "p2", label: "#2 · com Guaraná 1,5l", title: "1/2 Calabresa Seara s/ muç. + 1/2 Caprese · Gourmet", selection: { g_massa40: { gourmet: 1 }, g_sab99: { [oid("g_sab99", "Calabresa Seara sem muçarela")]: 1, [oid("g_sab99", "Caprese Original com Catupiry")]: 1 }, g_bebida: { [oid("g_bebida", "Guaraná Antarctica 1,5l")]: 1 } } }] },
    { id: "c2", categoryId: "cat_combos", name: "Duas pizzas por R$ 119 · 30cm salgada + 20cm doce", description: "Salgada de 30cm (até dois sabores) e doce de 20cm (um sabor).", kind: "combo", price: 119, compareAt: 174, groupIds: ["g_massa30", "g_sab119", "g_doce20c2"], heroOptionNames: half("Marguerita", "Calabresa"), likes: { pct: 93, n: 240 }, serves: "serve 3" },
    { id: "c3", categoryId: "cat_combos", name: "Duas pizzas por R$ 149 · 40cm salgada + 20cm doce", description: "Salgada de 40cm (até dois sabores) e doce de 20cm (um sabor).", kind: "combo", price: 149, compareAt: 270, groupIds: ["g_massa40c3", "g_sab149", "g_doce20", "g_bebida"], heroOptionNames: half("Calabresa", "Marguerita"), likes: { pct: 95, n: 302 }, serves: "serve 4–5",
      presets: [{ id: "p1", label: "#1 · o combo de domingo", title: "1/2 Calabresa + 1/2 Marguerita + Banana caramelizada", selection: { g_massa40c3: { gourmet: 1 }, g_sab149: { [oid("g_sab149", "Calabresa")]: 1, [oid("g_sab149", "Marguerita")]: 1 }, g_doce20: { [oid("g_doce20", "Banana caramelizada")]: 1 } } }] },
    { id: "s40", categoryId: "cat_salg", name: "Pizza 40cm até 2 sabores", description: "Monte sua pizza grande (8 fatias) com até dois sabores salgados. Meio a meio cobra a média dos dois sabores.", kind: "buildable", price: 99, groupIds: ["g_massa40", "g_sab40", "g_bebida"], heroOptionNames: half("Portuguesa", "Frango com Catupiry"), likes: { pct: 94, n: 180 } },
    { id: "d3", categoryId: "cat_doces", name: "Banana caramelizada · 20cm", description: "Muçarela, banana e chocolate branco forneável.", kind: "simple", price: 59, groupIds: [], imageUrl: o.photo("Banana caramelizada"), likes: { pct: 97, n: 143 } },
    { id: "d1", categoryId: "cat_doces", name: "Banana com canela · 20cm", description: "Muçarela, banana, canela e açúcar. Massa gourmet.", kind: "simple", price: 52, groupIds: [], imageUrl: o.photo("Banana com canela") },
    { id: "d2", categoryId: "cat_doces", name: "Cheesecake de frutas vermelhas · 20cm", description: "Cream cheese Philadelphia, chocolate branco e geleia.", kind: "simple", price: 59, groupIds: [], imageUrl: o.photo("Cheesecake de frutas vermelhas") },
    { id: "d4", categoryId: "cat_doces", name: "Negresco · 20cm", description: "Cream cheese, chocolate branco e pedaços de Negresco.", kind: "simple", price: 59, groupIds: [], imageUrl: o.photo("Negresco") },
    { id: "b1", categoryId: "cat_bebidas", name: "Guaraná Antarctica 1,5l", description: "R$ 9,33/L", kind: "simple", price: 14, groupIds: [], isDrink: true, liters: 1.5 },
    { id: "b2", categoryId: "cat_bebidas", name: "Coca-Cola Original 1,5l", description: "R$ 9,33/L", kind: "simple", price: 14, groupIds: [], isDrink: true, liters: 1.5 },
    { id: "b3", categoryId: "cat_bebidas", name: "Coca-Cola sem Açúcar 1,5l", description: "R$ 9,33/L", kind: "simple", price: 14, groupIds: [], isDrink: true, liters: 1.5 },
    { id: "b4", categoryId: "cat_bebidas", name: "Guaraná Antarctica lata 350ml", description: "R$ 25,43/L", kind: "simple", price: 8.9, groupIds: [], isDrink: true, liters: 0.35 },
    { id: "b5", categoryId: "cat_bebidas", name: "Água sem gás 500ml", kind: "simple", price: 5, groupIds: [], isDrink: true, liters: 0.5 },
    { id: "b6", categoryId: "cat_bebidas", name: "Chá Matte Leão Pêssego 1,5l", description: "R$ 9,33/L", kind: "simple", price: 14, groupIds: [], isDrink: true, liters: 1.5 },
  ].map((x, i) => ({ active: true, available: true, position: i, integrationCode: code(), ...x }) as Item);
  for (const it of items) await db.put("items", T, it as never);

  /* cupons e estratégias (os exemplos pedidos) */
  const coupons: Coupon[] = [
    { id: "cup_bemvindo", name: "10% no primeiro pedido", code: "BEMVINDO10", type: "percent", value: 10, maxDiscount: 20, firstOrderOnly: true, maxUsesPerCustomer: 1, marginHint: 0.42, active: true },
    { id: "cup_volta", name: "15% para quem sumiu (30+ dias)", code: "VOLTA15", type: "percent", value: 15, maxDiscount: 25, maxUsesPerCustomer: 1, marginHint: 0.42, active: true },
    { id: "cup_2pedido", name: "R$ 15 no segundo pedido", code: "SEGUNDA15", type: "amount", value: 15, minSubtotal: 80, maxUsesPerCustomer: 1, marginHint: 0.42, active: true },
    { id: "cup_frete", name: "Frete grátis (WhatsApp)", code: "FRETEZAP", type: "free_delivery", value: 0, requiresOptinWhatsapp: true, active: true },
  ];
  for (const c of coupons) await db.put("coupons", T, c as never);
  const strategies: Strategy[] = [
    { id: "st_frete120", name: "Frete grátis acima de R$ 120", active: true, priority: 10, conditions: [{ field: "subtotal", op: ">=", value: 120 }], action: { kind: "delivery_fee", mode: "free" }, showProgress: true, progressLabel: "para ganhar frete grátis" },
    { id: "st_frete_novo", name: "Frete grátis no 1º pedido", active: true, priority: 20, conditions: [{ field: "customer_orders", op: "=", value: 0 }], action: { kind: "delivery_fee", mode: "free", label: "Frete grátis no 1º pedido" } },
    { id: "st_frete_7a10", name: "Frete grátis para quem volta entre 7 e 10 dias", active: true, priority: 30, conditions: [{ field: "days_since_last_order", op: "between", min: 7, max: 10 }], action: { kind: "delivery_fee", mode: "free", label: "Frete grátis: você voltou na hora certa" } },
    { id: "st_frete_combo", name: "Frete grátis com o combo de R$ 149", active: true, priority: 40, conditions: [{ field: "cart_has_item", itemIds: ["c3"] }], action: { kind: "delivery_fee", mode: "free", label: "Frete grátis com o combo" } },
    { id: "st_frete_horario", name: "Frete grátis seg a qua, 18h–19h30", active: false, priority: 50, conditions: [{ field: "weekday", values: [1, 2, 3] }, { field: "time", from: "18:00", to: "19:30" }], action: { kind: "delivery_fee", mode: "free", label: "Frete grátis no começo da noite" } },
    { id: "st_minimo", name: "Taxa de serviço abaixo de R$ 50", description: "Não bloqueia a compra. Abaixo do mínimo cobra R$ 15; acima, a taxa não existe e nada aparece na tela.", active: true, priority: 100, conditions: [{ field: "subtotal", op: "<", value: 50 }, { field: "mode", values: ["DELIVERY"] }], action: { kind: "service_fee", amount: 15, label: "Taxa de serviço", feeType: "MIN_ORDER_FEE" } },
    { id: "st_pop_novo", name: "Cupom após 1 min sem adicionar (novos)", active: true, priority: 200, conditions: [{ field: "idle_seconds_without_add", value: 60 }, { field: "customer_orders", op: "=", value: 0 }], action: { kind: "popup_coupon", couponId: "cup_bemvindo", title: "10% off no seu primeiro pedido", text: "Use o cupom BEMVINDO10 agora. Vale só hoje.", position: "top-right", frequency: "session" } },
    { id: "st_pop_volta", name: "Cupom após 1 min sem adicionar (30+ dias sem comprar)", active: true, priority: 210, conditions: [{ field: "idle_seconds_without_add", value: 60 }, { field: "days_since_last_order", op: ">=", value: 30 }], action: { kind: "popup_coupon", couponId: "cup_volta", title: "Que saudade! 15% off", text: "Volte hoje com o cupom VOLTA15.", position: "top-right", frequency: "session" } },
  ];
  for (const s of strategies) await db.put("strategies", T, s as never);

  /* páginas (LP de campanha e pesquisa) */
  const pages: Page[] = [
    { id: "pg_avaliacao", slug: "avaliacao", title: "Como foi o seu pedido?", active: true, thankYou: "Obrigado! Sua resposta vai direto para a cozinha.", blocks: [
      { kind: "hero", media: { kind: "image", url: o.media.cover || "", alt: "Pizzas da Forneria" }, title: "Leva 20 segundos", text: "Sua resposta ajusta o próximo pedido." },
      { kind: "nps", id: "nps", question: "De 0 a 10, quanto você indicaria a Forneria para um amigo?" },
      { kind: "rating", id: "qualidade", question: "Qualidade da pizza", scale: 5 },
      { kind: "rating", id: "entrega", question: "Tempo e estado da entrega", scale: 5 },
      { kind: "choice", id: "motivo", question: "O que mais pesou?", options: ["Sabor", "Preço", "Tempo de entrega", "Atendimento", "Embalagem"], multiple: true },
      { kind: "open", id: "comentario", question: "Quer contar algo para a gente?" },
    ] },
    { id: "pg_bf", slug: "black-friday", title: "Black Friday Forneria", active: true, blocks: [
      { kind: "hero", media: { kind: "video", url: o.media.video || "", posterUrl: o.media.poster, alt: "Pizzas da Forneria em movimento" }, title: "A semana mais gostosa do ano", text: "Combos com preço fechado e frete grátis acima de R$ 120." },
      { kind: "items", title: "Os combos da semana", itemIds: ["c1", "c3", "c2"] },
      { kind: "coupon", couponId: "cup_frete", text: "Ative os avisos no WhatsApp e ganhe frete grátis." },
      { kind: "cta", label: "Ver o cardápio", link: { kind: "category", categoryId: "cat_combos" } },
    ] },
  ];
  for (const p of pages) await db.put("pages", T, p as never);

  /* banners: topo e abaixo do card sugerido, com vídeo e GIF */
  const banners: Banner[] = [
    { id: "bn_99", name: "Vídeo · Pizza 40cm por R$ 99", slot: "menu_top", media: { kind: "video", url: o.media.video || "", posterUrl: o.media.poster, alt: "Pizza 40cm por R$ 99" }, link: { kind: "item", itemId: "c1" }, audience: { profiles: ["novo", "familia"] }, priority: 1, active: true },
    { id: "bn_bf", name: "Black Friday (LP)", slot: "menu_top", media: { kind: "video", url: o.media.video || "", posterUrl: o.media.poster, alt: "Black Friday Forneria" }, headline: "Black Friday Forneria", link: { kind: "page", pageId: "pg_bf" }, audience: { profiles: ["recorrente", "em_risco"] }, priority: 1, active: true },
    { id: "bn_doces", name: "GIF · Fecha com um doce", slot: "below_suggested", media: { kind: "gif", url: o.media.gif || "", alt: "Pizzas doces girando" }, link: { kind: "category", categoryId: "cat_doces" }, audience: {}, priority: 1, active: true },
    { id: "bn_nps", name: "Avalie e ganhe cashback", slot: "after_order", media: { kind: "image", url: o.media.cover || "", alt: "Avalie o pedido" }, headline: "Avalie seu pedido", sub: "20 segundos · ajuda a cozinha", link: { kind: "page", pageId: "pg_avaliacao" }, audience: {}, priority: 1, active: true },
  ];
  for (const b of banners) await db.put("banners", T, b as never);

  /* personalização e fidelidade */
  const merch: MerchSettings = {
    categoryOrderByProfile: { novo: ["cat_combos", "cat_imbat", "cat_salg", "cat_doces", "cat_bebidas"], recorrente: ["cat_combos", "cat_imbat", "cat_bebidas", "cat_doces", "cat_salg"], familia: ["cat_combos", "cat_doces", "cat_imbat", "cat_bebidas", "cat_salg"], em_risco: ["cat_imbat", "cat_combos", "cat_salg", "cat_doces", "cat_bebidas"] },
    mostOrdered: { enabled: true, auto: true, itemIds: ["c1", "m1", "c3", "m3"], title: "Mais pedidos agora" },
    heroRules: [
      { id: "h_novo", profile: "novo", kicker: "Você veio pelo anúncio", title: "Pizza 40cm por R$ 99, qualquer sabor", sub: "Até dois sabores · 8 fatias", action: { kind: "open_item", itemId: "c1" }, active: true, priority: 1 },
      { id: "h_rec", profile: "recorrente", kicker: "Seu pedido de sempre", title: "", action: { kind: "reorder" }, active: true, priority: 1 },
      { id: "h_fam", profile: "familia", kicker: "Domingo em família", title: "Duas pizzas por R$ 149 · serve 4–5", sub: "40cm salgada + 20cm doce · frete grátis", action: { kind: "open_item", itemId: "c3" }, active: true, priority: 1 },
      { id: "h_risco", profile: "em_risco", kicker: "Faz tempo que você não pede", title: "Imbatível de R$ 79 com 15% off", sub: "Cupom VOLTA15", action: { kind: "open_item", itemId: "m3" }, active: true, priority: 1 },
    ],
    crossSell: [
      { id: "x_bebida", whenCategoryIds: ["cat_salg", "cat_imbat", "cat_combos"], suggestItemIds: ["b1", "b2"], reason: "o par mais pedido com pizza", active: true },
      { id: "x_doce", whenCategoryIds: ["cat_salg", "cat_imbat"], suggestItemIds: ["d3", "d4"], reason: "para fechar", active: true },
    ],
    hesitationHelpSeconds: 12,
    searchInHeader: true,
  };
  await db.put("settings", T, { id: "merch", value: merch });
  const loyalty: LoyaltyProgram = { active: true, kind: "cashback", earnPercent: 5, minOrder: 0, expiresInDays: 45, minRedeem: 5, maxRedeemPercent: 30, welcomeBonus: 0, tiers: [{ name: "Prata", minSpend90d: 300, earnPercent: 7 }, { name: "Ouro", minSpend90d: 600, earnPercent: 10 }] };
  await db.put("settings", T, { id: "loyalty", value: loyalty });

  /* pesquisa inteligente e engajamento */
  await db.put("coupons", T, { id: "cup_fica", name: "R$ 8 para fechar agora (antes de ir)", code: "FICA8", type: "amount", value: 8, minSubtotal: 60, maxUsesPerCustomer: 1, marginHint: 0.42, active: true } as never);
  const engagement: EngagementSettings = {
    ...DEFAULT_ENGAGEMENT,
    triage: { ...DEFAULT_ENGAGEMENT.triage, partyItems: { solo: "m1", dupla: "c2", galera: "c3" }, noveltyItemId: "m3" },
    postOrder: { ...DEFAULT_ENGAGEMENT.postOrder, alertPhone: "5521999990000", googleReviewUrl: "https://g.page/r/forneria-original/review" },
    effects: { ...DEFAULT_ENGAGEMENT.effects, exitIntent: { enabled: true, couponId: "cup_fica", title: "Antes de ir…", text: "Sua sacola fica guardada. Se fechar o pedido agora, tem R$ 8 de desconto." } },
  };
  await db.put("settings", T, { id: "engagement", value: engagement });

  /* CRM: segmentos e automações */
  const segments: Segment[] = [
    { id: "seg_1pedido", name: "Fizeram 1 pedido", description: "A maior alavanca: levar ao 2º pedido", rules: [{ field: "orders", op: "=", value: 1 }] },
    { id: "seg_risco", name: "Em risco ou hibernando", rules: [{ field: "rfm", op: "in", value: ["em_risco", "hibernando"] }] },
    { id: "seg_vip", name: "VIP (R$ 800+)", rules: [{ field: "spent", op: ">=", value: 800 }] },
    { id: "seg_optin", name: "Aceitam WhatsApp", rules: [{ field: "optin_whatsapp", op: "=", value: true }] },
  ];
  for (const s of segments) await db.put("segments", T, s as never);
  const autos: Automation[] = [
    { id: "au_2pedido", name: "2º pedido em 7 dias", trigger: { kind: "days_after_first_order", days: 7 }, channel: "whatsapp_then_email", templateId: "tpl_wa_2pedido", template: "Oi {{nome}}! Que tal repetir a Forneria hoje? R$ 15 off no segundo pedido com o cupom {{cupom}}: {{link}}", couponId: "cup_2pedido", holdoutPercent: 10, maxPerCustomerPerWeek: 1, quietHours: [22, 10], active: true },
    { id: "au_carrinho", name: "Sacola esquecida (30 min)", trigger: { kind: "cart_abandoned", afterMinutes: 30 }, channel: "whatsapp", templateId: "tpl_wa_carrinho", template: "{{nome}}, sua pizza ficou na sacola. Ela continua lá: {{link}}", holdoutPercent: 10, maxPerCustomerPerWeek: 2, active: true },
    { id: "au_ciclo", name: "Passou do ciclo de compra", trigger: { kind: "no_order_cycle", multiplier: 1.5 }, channel: "whatsapp", template: "{{nome}}, faz {{dias}} dias. Volta com 15% off: {{cupom}} {{link}}", couponId: "cup_volta", holdoutPercent: 15, maxPerCustomerPerWeek: 1, quietHours: [22, 10], active: true },
    { id: "au_nps", name: "Pesquisa 1h após a entrega", trigger: { kind: "order_concluded", afterMinutes: 60 }, channel: "whatsapp", templateId: "tpl_wa_pesquisa", template: "Como foi o pedido #{{pedido}}? Leva 20 segundos: {{link}}", pageId: "pg_avaliacao", holdoutPercent: 0, maxPerCustomerPerWeek: 2, active: true },
    { id: "au_cashback", name: "Cashback vencendo", trigger: { kind: "cashback_expiring", daysBefore: 5 }, channel: "whatsapp", template: "{{nome}}, você tem R$ {{cashback}} de cashback vencendo. Use hoje: {{link}}", holdoutPercent: 10, maxPerCustomerPerWeek: 1, active: true },
  ];
  for (const a of autos) await db.put("automations", T, a as never);

  /* modelos de mensagem (WhatsApp aprovados na Meta + e-mail) e uma campanha em rascunho */
  const templates: MessageTemplate[] = [
    { id: "tpl_wa_2pedido", name: "Segundo pedido", channel: "whatsapp", waName: "segundo_pedido", waLanguage: "pt_BR", waCategory: "MARKETING", waBody: "Oi {{1}}! Que tal repetir a {{2}} hoje? Use o cupom {{3}} e ganhe R$ 15 no segundo pedido: {{4}}", waVars: [{ source: "nome" }, { source: "marca" }, { source: "cupom" }, { source: "link" }] },
    { id: "tpl_wa_carrinho", name: "Sacola esquecida", channel: "whatsapp", waName: "carrinho_abandonado", waLanguage: "pt_BR", waCategory: "MARKETING", waBody: "{{1}}, sua pizza ficou na sacola. Ela continua lá esperando: {{2}}", waVars: [{ source: "nome" }, { source: "link" }] },
    { id: "tpl_wa_pesquisa", name: "Pesquisa pós-pedido", channel: "whatsapp", waName: "pesquisa_pos_pedido", waLanguage: "pt_BR", waCategory: "UTILITY", waBody: "Como foi o pedido #{{1}}? Leva 20 segundos e ajuda a cozinha: {{2}}", waVars: [{ source: "pedido" }, { source: "link" }] },
    { id: "tpl_wa_codigo", name: "Código de acesso", channel: "whatsapp", waName: "codigo_acesso", waLanguage: "pt_BR", waCategory: "AUTHENTICATION", waBody: "{{1}} é seu código de verificação. Por segurança, não compartilhe.", waVars: [{ source: "codigo" }] },
    { id: "tpl_em_bf", name: "Black Friday Forneria", channel: "email", subject: "{{nome}}, a Black Friday da Forneria começou", preheader: "Combos com preço fechado e frete grátis acima de R$ 120", blocks: [
      { kind: "image", url: o.media.poster || o.media.cover || "", alt: "Pizzas da Forneria", href: "{{link}}" },
      { kind: "heading", text: "A semana mais gostosa do ano" },
      { kind: "text", text: "{{nome}}, separamos os combos que mais saem às sextas. Preço fechado, até dois sabores e frete grátis acima de R$ 120." },
      { kind: "items", title: "Os combos da semana", itemIds: ["c1", "c3", "c2"] },
      { kind: "coupon", couponId: "cup_frete", text: "Ative os avisos no WhatsApp e use:" },
      { kind: "button", label: "Ver o cardápio", href: "{{link}}" },
    ] },
  ];
  for (const t0 of templates) await db.put("message_templates", T, { ...t0, createdAt: now.toISOString() } as never);
  const campaign: Campaign = { id: "cmp_bf_vip", name: "Black Friday · VIPs", channel: "email", templateId: "tpl_em_bf", segmentId: "seg_vip", couponId: "cup_frete", holdoutPercent: 10, maxPerCustomerPerWeek: 2, quietHours: [22, 9], status: "draft", createdAt: now.toISOString() };
  await db.put("campaigns", T, campaign as never);

  await seedFirstVisit(db, T);
  if (o.history) await seedHistory(db, T, items, G, now);
  return { tenant, store };
}

/** 90 dias de navegação e pedidos sintéticos, com proporções realistas de funil e recompra. */
async function seedHistory(db: Db, T: string, items: Item[], G: Record<string, OptionGroup>, now: Date) {
  let s = 42; const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <X,>(a: X[]) => a[Math.floor(rnd() * a.length)];
  const first = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabi", "Henrique", "Isabela", "João", "Larissa", "Marcelo", "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Tiago", "Vitória", "Lucas"];
  const last = ["Souza", "Lima", "Costa", "Pereira", "Almeida", "Ribeiro", "Carvalho", "Gomes", "Martins", "Rocha"];
  const sources = ["instagram", "google", "whatsapp", "direto", "instagram", "google"];
  const customers: Customer[] = [];
  for (let i = 0; i < 260; i++) customers.push({ id: `cus_seed${i}`, name: `${pick(first)} ${pick(last)}`, phone: `55219${String(80000000 + i * 7919).slice(0, 8)}`, optinWhatsapp: rnd() < 0.62, source: pick(sources), orders: 0, spent: 0, createdAt: new Date(+now - 95 * 864e5).toISOString() });
  // e-mail para parte da base (sem alterar a sequência aleatória do histórico)
  customers.forEach((c, i) => { c.email = (c.name || "cliente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, ".") + i + "@exemplo.com.br"; c.optinEmail = (i * 37) % 100 < 40; });
  const zones = ["z_leblon", "z_ipanema", "z_gavea"];
  const fees: Record<string, number> = { z_leblon: 4.9, z_ipanema: 6.9, z_gavea: 8.9 };
  const pop = ["c1", "c1", "m1", "c3", "m3", "c2", "s40", "m2", "m5", "d3"];
  const events: { id: string; sessionId: string; customerId?: string; name: string; ts: string; source?: string; device?: string; props?: Record<string, unknown> }[] = [];
  let n = 1001;
  const orders: Order[] = [];
  const freq = customers.map(() => (rnd() < 0.55 ? 1 : rnd() < 0.6 ? 2 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 8)));
  for (let ci = 0; ci < customers.length; ci++) {
    const c = customers[ci]; const k = freq[ci];
    let t = +now - (10 + rnd() * 85) * 864e5;
    for (let j = 0; j < k && t < +now; j++) {
      const pid = pick(pop); const it = items.find((x) => x.id === pid)!;
      const sel: Record<string, Record<string, number>> = {};
      for (const gid of it.groupIds) { const g = G[gid]; if (g.min > 0) { const o1 = pick(g.options.slice(0, 8)), o2 = pick(g.options.slice(0, 8)); sel[gid] = g.max >= 2 ? (o1.id === o2.id ? { [o1.id]: 2 } : { [o1.id]: 1, [o2.id]: 1 }) : { [o1.id]: 1 }; } }
      if (rnd() < 0.4 && it.groupIds.includes("g_bebida")) sel.g_bebida = { "guarana-antarctica-1-5l": 1 };
      const line = priceLine(it, it.groupIds.map((g) => G[g]), { itemId: it.id, qty: 1, selection: sel });
      const extra = rnd() < 0.3 ? priceLine(items.find((x) => x.id === "b1")!, [], { itemId: "b1", qty: 1 }) : null;
      const lines = extra ? [line, extra] : [line];
      const subtotal = r2(lines.reduce((a, l) => a + l.total, 0));
      const z = pick(zones); const free = subtotal >= 120 || j === 0;
      const discount = j === 0 && rnd() < 0.3 ? r2(Math.min(20, subtotal * 0.1)) : 0;
      const deliveryFee = free ? 0 : fees[z];
      const total = r2(subtotal - discount + deliveryFee + (subtotal < 50 ? 15 : 0));
      const at = new Date(t); at.setHours(18 + Math.floor(rnd() * 5), Math.floor(rnd() * 60));
      if (+at > +now - 3600e3) at.setTime(+now - (2 + rnd() * 20) * 3600e3); // nunca no futuro
      const status = rnd() < 0.04 ? "cancelled" : "concluded";
      const o: Order = { id: `ord_seed${n}`, displayId: String(n++), storeId: "sto_leblon", customerId: c.id, mode: "DELIVERY", lines, subtotal, discount, deliveryFee, baseDeliveryFee: fees[z], fees: subtotal < 50 ? [{ label: "Taxa de serviço", amount: 15, feeType: "MIN_ORDER_FEE" }] : [], strategiesApplied: free ? ["st_frete120"] : [], cashbackUsed: 0, total, cashbackEarned: r2(subtotal * 0.05), couponId: discount ? "cup_bemvindo" : undefined, payment: { code: pick(["PIX_ONLINE", "PIX_ONLINE", "CARD_ON_DELIVERY", "VR_VA"]) as "PIX_ONLINE" }, status, statusHistory: [{ status: "created", at: at.toISOString(), by: "cliente" }, { status, at: new Date(+at + 50 * 60e3).toISOString(), by: "saipos" }], source: c.source, createdAt: at.toISOString() };
      (o as Order & { zoneId: string }).zoneId = z;
      orders.push(o);
      const sid = `ses_${o.id}`; const dev = rnd() < 0.86 ? "mobile" : "desktop";
      const ts = (m: number) => new Date(+at - (12 - m) * 60e3).toISOString();
      for (const [m, name] of [[0, "visit"], [2, "item_view"], [4, "add_to_cart"], [6, "cart_view"], [8, "checkout_start"]] as [number, string][]) events.push({ id: `ev_${sid}_${name}`, sessionId: sid, customerId: c.id, name, ts: ts(m), source: c.source, device: dev, props: { itemId: it.id, profile: j === 0 ? "novo" : "recorrente" } });
      events.push({ id: `ev_${sid}_order`, sessionId: sid, customerId: c.id, name: "order_placed", ts: at.toISOString(), source: c.source, device: dev, props: { orderId: o.id, total } });
      t += (k > 4 ? 6 + rnd() * 10 : 12 + rnd() * 30) * 864e5;
    }
  }
  // sessões que não compraram (o funil real tem a maior parte aqui)
  for (let i = 0; i < 2600; i++) {
    const at = new Date(+now - rnd() * 90 * 864e5); at.setHours(17 + Math.floor(rnd() * 6), Math.floor(rnd() * 60));
    if (+at > +now - 600e3) at.setTime(+now - (1 + rnd() * 20) * 3600e3);
    const sid = `ses_x${i}`; const src = pick([...sources, "instagram", "instagram"]); const dev = rnd() < 0.86 ? "mobile" : "desktop";
    const it = pick(pop); const depth = rnd();
    const steps = ["visit", ...(depth > 0.35 ? ["item_view"] : []), ...(depth > 0.72 ? ["add_to_cart"] : []), ...(depth > 0.85 ? ["cart_view"] : []), ...(depth > 0.93 ? ["checkout_start"] : [])];
    steps.forEach((name, m) => events.push({ id: `ev_${sid}_${name}`, sessionId: sid, name, ts: new Date(+at + m * 60e3).toISOString(), source: src, device: dev, props: { itemId: it, profile: "novo" } }));
    if (depth > 0.5 && depth < 0.6) events.push({ id: `ev_${sid}_hes`, sessionId: sid, name: "hesitation", ts: new Date(+at + 5 * 60e3).toISOString(), source: src, device: dev });
  }
  // pesquisa pós-pedido em ~38% dos pedidos entregues, triagem e efeitos nas sessões
  const reasonsHi = DEFAULT_ENGAGEMENT.postOrder.reasonsHigh, reasonsLo = DEFAULT_ENGAGEMENT.postOrder.reasonsLow;
  const comments = ["Chegou quentinha, massa perfeita", "Demorou mais que o previsto", "A borda recheada é viciante", "Veio sem o refrigerante", "Melhor pizza do Leblon", "Achei a pizza meio fria", "Entregador super educado", "Sabor top, preço justo"];
  for (const o of orders) {
    if (o.status !== "concluded" || rnd() > 0.38) continue;
    const nps = Math.min(10, Math.max(0, Math.round(8.4 + (rnd() - 0.55) * 6)));
    const kind = npsKind(nps);
    const at = new Date(+new Date(o.createdAt) + (70 + rnd() * 120) * 60e3);
    if (+at > +now) continue;
    o.feedback = { nps, kind, at: at.toISOString(), reasons: [pick(kind === "promotor" ? reasonsHi : reasonsLo), ...(rnd() < 0.4 ? [pick(kind === "promotor" ? reasonsHi : reasonsLo)] : [])].filter((x, i, a) => a.indexOf(x) === i), wantToTry: rnd() < 0.35 ? pick(["m3", "m4", "d4", "c3", "d2"]) : undefined, comment: rnd() < 0.3 ? pick(comments) : undefined, creditGiven: kind === "detrator" ? 10 : undefined };
    events.push({ id: `ev_fb_${o.id}`, sessionId: `ses_${o.id}`, customerId: o.customerId, name: "feedback", ts: o.feedback.at, props: { orderId: o.id, nps, kind } });
  }
  for (const o of orders) {
    const sid = `ses_${o.id}`; const at = +new Date(o.createdAt);
    const ev = (name: string, m: number, props?: Record<string, unknown>) => events.push({ id: `ev_${sid}_${name}`, sessionId: sid, customerId: o.customerId, name, ts: new Date(at - m * 60e3).toISOString(), props });
    const repeat = o.customerId && orders.some((x) => x.customerId === o.customerId && x.createdAt < o.createdAt);
    if (repeat && rnd() < 0.5) { ev("triage_shown", 11.5); if (rnd() < 0.72) { const k = pick(["party", "mood", "craving"]); ev("triage_answer", 11.4, { kind: k, values: [pick(k === "party" ? ["solo", "dupla", "galera", "galera"] : k === "mood" ? ["salgada", "ambas", "doce"] : ["de_sempre", "novidade"])] }); } else ev("triage_skip", 11.4, { kind: "skip", values: [] }); }
    if (rnd() < 0.45) ev("fx_glow_cta", 3);
    if (rnd() < 0.2) ev("fx_glow_preset", 3.5);
    if (rnd() < 0.18) ev("fx_free_ship_nudge", 5);
    if (rnd() < 0.06) ev("return_toast", 7);
    if (rnd() < 0.05) ev("exit_shown", 6);
  }
  for (let i = 0; i < 2600; i += 7) { const sid = `ses_x${i}`; const v = events.find((e) => e.id === `ev_${sid}_visit`); if (!v) continue; const t0 = +new Date(v.ts); if (rnd() < 0.5) events.push({ id: `ev_${sid}_exit`, sessionId: sid, name: "exit_shown", ts: new Date(t0 + 4 * 60e3).toISOString() }); if (rnd() < 0.3) events.push({ id: `ev_${sid}_glow`, sessionId: sid, name: "fx_glow_cta", ts: new Date(t0 + 2 * 60e3).toISOString() }); }
  for (const o of orders) await db.put("orders", T, o as never);
  const byC = new Map<string, Order[]>();
  for (const o of orders) if (o.status !== "cancelled") { if (!byC.has(o.customerId!)) byC.set(o.customerId!, []); byC.get(o.customerId!)!.push(o); }
  for (const c of customers) {
    const l = (byC.get(c.id) || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    c.orders = l.length; c.spent = r2(l.reduce((a, o) => a + o.total, 0)); c.firstOrderAt = l[0]?.createdAt; c.lastOrderAt = l[l.length - 1]?.createdAt;
    await db.put("customers", T, c as never);
    for (const o of l) await db.put("ledger", T, { id: `led_${o.id}`, customerId: c.id, type: "earn", amount: o.cashbackEarned, orderId: o.id, createdAt: o.createdAt, expiresAt: new Date(+new Date(o.createdAt) + 45 * 864e5).toISOString() });
  }
  await db.events.insert(T, events);
  // respostas de NPS
  for (let i = 0; i < 64; i++) {
    const nps = Math.min(10, Math.max(0, Math.round(8.3 + (rnd() - 0.5) * 5)));
    await db.put("page_responses", T, { id: `rsp_seed${i}`, pageId: "pg_avaliacao", customerId: customers[i].id, answers: { nps, qualidade: Math.min(5, Math.max(2, Math.round(4.4 + (rnd() - 0.5) * 2))), entrega: Math.min(5, Math.max(1, Math.round(4 + (rnd() - 0.5) * 3))), motivo: [pick(["Sabor", "Preço", "Tempo de entrega", "Embalagem"])] }, createdAt: new Date(+now - rnd() * 60 * 864e5).toISOString() });
  }
}
