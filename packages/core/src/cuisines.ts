/**
 * Culinárias: um modelo de cardápio por segmento, de bolo a costela.
 * A estrutura é a mesma para todos (categoria → item → grupos de complemento → opções);
 * o que muda são as particularidades, ligadas por campos genéricos:
 *   meio a meio (rule "fraction"), cota grátis (freeQuota), medida (measure: kg, ml, un),
 *   encomenda (leadTimeHours), janela de venda (availability), papel do grupo (role) e selos (tags).
 */
import type { Availability, Category, CuisineId, GroupRole, Item, ItemKind, Measure, OptionGroup, Weekday } from "./types";
import { BRL, r2 } from "./pricing";

export type CuisineFeature = "halves" | "sizes" | "quota" | "by_weight" | "preorder" | "daily_menu" | "doneness" | "pieces" | "serves" | "build";

export const FEATURE_INFO: Record<CuisineFeature, { label: string; how: string }> = {
  halves: { label: "Meio a meio", how: "Grupo com regra meio a meio: cada sabor guarda o preço inteiro e a fração cobra a média." },
  sizes: { label: "Tamanhos", how: "Grupo de tamanho obrigatório (escolhe 1) com o acréscimo de cada tamanho." },
  quota: { label: "Complementos grátis até N", how: "Grupo com cota grátis: as N primeiras escolhas saem de graça, as demais cobram." },
  by_weight: { label: "Venda por peso", how: "O item informa a medida (500 g, 1 kg) e o cardápio mostra o preço por kg." },
  preorder: { label: "Encomenda", how: "Itens com antecedência mínima: o pedido vira agendado para a data escolhida." },
  daily_menu: { label: "Cardápio do dia", how: "Itens com dias e horário de venda (prato do dia, café da manhã)." },
  doneness: { label: "Ponto da carne", how: "Grupo de instrução obrigatório sem preço." },
  pieces: { label: "Peças e caixas", how: "Caixa com N unidades: o cliente distribui os sabores até completar." },
  serves: { label: "Serve N pessoas", how: "Porções com quantas pessoas servem, usado na triagem e no topo do cardápio." },
  build: { label: "Monte o seu", how: "Item montado por etapas: base, proteína, complementos e molho." },
};

export interface TemplateOption { name: string; price?: number; fullPrice?: number; description?: string; measure?: Measure; tags?: string[] }
export interface TemplateGroup { key: string; name: string; role: GroupRole; min: number; max: number; rule?: "sum" | "fraction"; allowRepeat?: boolean; freeQuota?: number; options: TemplateOption[] }
export interface TemplateItem {
  cat: number; name: string; description?: string; kind?: ItemKind; price: number; groups?: string[];
  measure?: Measure; leadTimeHours?: number; availability?: Availability; tags?: string[]; serves?: string; isDrink?: boolean; compareAt?: number;
}
export interface CuisineTemplate {
  id: CuisineId;
  label: string;
  /** frase curta do que o modelo já traz */
  pitch: string;
  /** palavras que identificam a culinária em nomes de itens e categorias (importação, detecção) */
  keywords: string[];
  features: CuisineFeature[];
  categories: { name: string; locked?: boolean; description?: string; availability?: Availability }[];
  groups: TemplateGroup[];
  items: TemplateItem[];
  /** roteiro de primeira visita usado quando ainda não há base de clientes */
  triage: "pizza" | "generico";
  /** cuidados de cardápio específicos do segmento, mostrados no Setup */
  tips: string[];
}

const ml = (amount: number): Measure => ({ unit: "ml", amount });
const g = (amount: number): Measure => ({ unit: "g", amount });
const un = (amount: number): Measure => ({ unit: "un", amount });
const drinkCat = { name: "Bebidas" };
const DRINKS = (cat: number): TemplateItem[] => [
  { cat, name: "Refrigerante lata", price: 7.5, measure: ml(350), isDrink: true },
  { cat, name: "Água mineral", price: 5, measure: ml(500), isDrink: true },
];

export const CUISINES: CuisineTemplate[] = [
  {
    id: "pizza", label: "Pizzaria", pitch: "Pizza montável com meio a meio, bordas, combos de preço fechado e bebidas.",
    keywords: ["pizza", "calabresa", "muçarela", "mussarela", "margherita", "portuguesa", "borda", "broto", "4 queijos", "quatro queijos", "napolitana"],
    features: ["halves", "sizes", "serves"], triage: "pizza",
    categories: [{ name: "Combos", locked: true }, { name: "Pizzas salgadas" }, { name: "Pizzas doces" }, drinkCat],
    groups: [
      { key: "massa", name: "Massa e borda", role: "base", min: 1, max: 1, options: [{ name: "Tradicional", price: 0 }, { name: "Borda de catupiry", price: 12 }, { name: "Borda de cheddar", price: 12 }] },
      { key: "sabores", name: "Escolha até 2 sabores", role: "flavor", min: 2, max: 2, rule: "fraction", allowRepeat: true, options: [
        { name: "Muçarela", fullPrice: 69.9 }, { name: "Calabresa", fullPrice: 74.9 }, { name: "Margherita", fullPrice: 76.9 }, { name: "Portuguesa", fullPrice: 82.9 }, { name: "Frango com catupiry", fullPrice: 84.9 }, { name: "Quatro queijos", fullPrice: 89.9 }] },
      { key: "doces", name: "Sabor doce", role: "flavor", min: 1, max: 1, options: [{ name: "Chocolate com morango", price: 0 }, { name: "Banana com canela", price: 0 }, { name: "Romeu e Julieta", price: 0 }] },
      { key: "refri", name: "Refrigerante 2 L", role: "drink", min: 1, max: 1, options: [{ name: "Coca-Cola", price: 0 }, { name: "Guaraná", price: 0 }] },
    ],
    items: [
      { cat: 1, name: "Pizza grande até 2 sabores", description: "8 fatias. Meio a meio cobra a média dos dois sabores.", kind: "buildable", price: 69.9, groups: ["massa", "sabores"], serves: "serve 3" },
      { cat: 2, name: "Pizza doce broto", description: "4 fatias", price: 39.9, groups: ["doces"], serves: "serve 1" },
      { cat: 0, name: "Pizza grande + refrigerante 2 L", kind: "combo", price: 89.9, compareAt: 99.8, groups: ["sabores", "refri"], serves: "serve 3" },
      ...DRINKS(3),
    ],
    tips: ["Sabores do meio a meio guardam o preço da pizza inteira; o item mostra “a partir de” pelo sabor mais barato.", "Combos ficam em categoria de preço fechado: lá o meio a meio nunca cobra diferença."],
  },
  {
    id: "hamburguer", label: "Hamburgueria", pitch: "Burgers com ponto da carne, adicionais repetíveis, combos com troca de acompanhamento.",
    keywords: ["burger", "hambúrguer", "hamburguer", "smash", "cheddar", "bacon", "blend", "batata frita", "onion"],
    features: ["doneness", "build"], triage: "generico",
    categories: [{ name: "Combos", locked: true }, { name: "Burgers" }, { name: "Acompanhamentos" }, drinkCat, { name: "Sobremesas" }],
    groups: [
      { key: "ponto", name: "Ponto da carne", role: "instruction", min: 1, max: 1, options: [{ name: "Ao ponto", price: 0 }, { name: "Mal passado", price: 0 }, { name: "Bem passado", price: 0 }] },
      { key: "adicionais", name: "Turbine seu burger", role: "addon", min: 0, max: 6, allowRepeat: true, options: [{ name: "Bacon", price: 6 }, { name: "Cheddar extra", price: 5 }, { name: "Ovo", price: 4 }, { name: "Burger extra 160 g", price: 14 }, { name: "Cebola caramelizada", price: 4 }] },
      { key: "molhos", name: "Molhos", role: "sauce", min: 0, max: 2, options: [{ name: "Maionese da casa", price: 0 }, { name: "Barbecue", price: 0 }, { name: "Molho especial", price: 3 }] },
      { key: "lado", name: "Acompanhamento do combo", role: "side", min: 1, max: 1, options: [{ name: "Fritas média", price: 0 }, { name: "Batata rústica", price: 4 }, { name: "Onion rings", price: 6 }] },
      { key: "bebida", name: "Bebida do combo", role: "drink", min: 1, max: 1, options: [{ name: "Refrigerante lata", price: 0 }, { name: "Suco natural", price: 4 }] },
    ],
    items: [
      { cat: 1, name: "Smash duplo", description: "2 smash de 80 g, cheddar, cebola e picles no pão brioche", price: 34.9, groups: ["adicionais", "molhos"] },
      { cat: 1, name: "Cheese bacon 160 g", description: "Blend de 160 g, queijo prato e bacon crocante", price: 38.9, groups: ["ponto", "adicionais", "molhos"] },
      { cat: 1, name: "Veggie de grão-de-bico", price: 36.9, groups: ["adicionais", "molhos"], tags: ["vegetariano"] },
      { cat: 0, name: "Combo cheese bacon + fritas + bebida", kind: "combo", price: 52.9, compareAt: 61.3, groups: ["ponto", "lado", "bebida"] },
      { cat: 2, name: "Fritas média", price: 16.9, serves: "serve 1" },
      ...DRINKS(3),
      { cat: 4, name: "Milkshake de Ovomaltine", price: 22.9, measure: ml(400) },
    ],
    tips: ["Ponto da carne é grupo obrigatório sem preço: entra na comanda e no PDV.", "Adicionais podem repetir (2× bacon); defina o máximo para não virar outro burger."],
  },
  {
    id: "japonesa", label: "Japonesa", pitch: "Combinados por peças, temaki com proteína e extras, molhos e hashi.",
    keywords: ["sushi", "sashimi", "temaki", "uramaki", "hossomaki", "hot roll", "niguiri", "combinado", "yakisoba", "gyoza", "shoyu", "salmão"],
    features: ["pieces", "serves", "build"], triage: "generico",
    categories: [{ name: "Combinados", locked: true }, { name: "Temakis" }, { name: "Sushis e sashimis" }, { name: "Quentes" }, drinkCat],
    groups: [
      { key: "recheio", name: "Recheio do temaki", role: "protein", min: 1, max: 1, options: [{ name: "Salmão", price: 0 }, { name: "Salmão grelhado", price: 0 }, { name: "Atum", price: 4 }, { name: "Camarão empanado", price: 6 }] },
      { key: "extras", name: "Extras", role: "addon", min: 0, max: 3, options: [{ name: "Cream cheese", price: 3 }, { name: "Cebolinha", price: 0 }, { name: "Crispy de couve", price: 3 }] },
      { key: "molho", name: "Molhos", role: "sauce", min: 0, max: 2, options: [{ name: "Shoyu", price: 0 }, { name: "Shoyu light", price: 0 }, { name: "Tarê", price: 2 }] },
      { key: "hashi", name: "Talheres", role: "instruction", min: 0, max: 1, options: [{ name: "Enviar hashi", price: 0 }, { name: "Não precisa enviar", price: 0 }] },
    ],
    items: [
      { cat: 0, name: "Combinado 20 peças", description: "Sushis, sashimis e uramakis do dia", kind: "combo", price: 79.9, measure: un(20), groups: ["molho", "hashi"], serves: "serve 1" },
      { cat: 0, name: "Combinado 40 peças", kind: "combo", price: 139.9, measure: un(40), groups: ["molho", "hashi"], serves: "serve 2" },
      { cat: 1, name: "Temaki", description: "Cone de alga com arroz e o recheio escolhido", price: 32.9, groups: ["recheio", "extras", "molho"] },
      { cat: 2, name: "Hot roll", price: 29.9, measure: un(10), groups: ["molho"] },
      { cat: 2, name: "Sashimi de salmão", price: 44.9, measure: un(10), tags: ["sem_gluten"] },
      { cat: 3, name: "Yakisoba de frango", price: 39.9, serves: "serve 1" },
      ...DRINKS(4),
    ],
    tips: ["Mostre a quantidade de peças: o cardápio exibe o preço por peça para comparar combinados.", "Hashi como pergunta opcional reduz desperdício e entra na comanda."],
  },
  {
    id: "acai", label: "Açaí e sorvetes", pitch: "Tamanhos por ml e complementos com cota grátis: os 3 primeiros não cobram.",
    keywords: ["açaí", "acai", "cupuaçu", "granola", "leite em pó", "paçoca", "sorvete", "picolé", "milkshake", "creme de ninho"],
    features: ["sizes", "quota", "build"], triage: "generico",
    categories: [{ name: "Monte seu açaí" }, { name: "Açaís da casa" }, drinkCat],
    groups: [
      { key: "tamanho", name: "Tamanho", role: "size", min: 1, max: 1, options: [{ name: "300 ml", price: 0, measure: ml(300) }, { name: "500 ml", price: 6, measure: ml(500) }, { name: "700 ml", price: 11, measure: ml(700) }, { name: "1 litro", price: 18, measure: ml(1000) }] },
      { key: "comp", name: "Complementos · 3 grátis", role: "addon", min: 0, max: 8, freeQuota: 3, options: [{ name: "Granola", price: 3 }, { name: "Leite em pó", price: 3 }, { name: "Banana", price: 3 }, { name: "Paçoca", price: 3 }, { name: "Leite condensado", price: 3 }, { name: "Morango", price: 4 }, { name: "Kiwi", price: 4 }] },
      { key: "premium", name: "Coberturas premium", role: "addon", min: 0, max: 3, options: [{ name: "Nutella", price: 7 }, { name: "Creme de Ninho", price: 6 }, { name: "Pistache", price: 9 }] },
    ],
    items: [
      { cat: 0, name: "Açaí do seu jeito", description: "Escolha o tamanho e 3 complementos grátis", price: 16.9, measure: ml(300), groups: ["tamanho", "comp", "premium"] },
      { cat: 1, name: "Açaí tropical 500 ml", description: "Banana, morango, granola e leite condensado", price: 29.9, measure: ml(500), groups: ["premium"] },
      { cat: 1, name: "Cupuaçu 400 ml", price: 24.9, measure: ml(400), groups: ["comp"] },
      ...DRINKS(2),
    ],
    tips: ["Coberturas caras (Nutella, pistache) ficam em grupo separado, fora da cota grátis.", "O preço por ml ajuda o cliente a subir de tamanho."],
  },
  {
    id: "confeitaria", label: "Confeitaria e bolos", pitch: "Bolos sob encomenda com antecedência, tamanhos por pessoas, massa, recheio e mensagem.",
    keywords: ["bolo", "torta", "brigadeiro", "cento", "doces finos", "confeitaria", "cupcake", "fatia", "brownie", "naked", "chantininho", "kit festa"],
    features: ["preorder", "sizes", "serves", "pieces"], triage: "generico",
    categories: [{ name: "Doces do dia" }, { name: "Bolos sob encomenda", description: "Pedidos com 48 h de antecedência" }, { name: "Tortas" }, { name: "Kits festa", locked: true }, drinkCat],
    groups: [
      { key: "tamanho", name: "Tamanho", role: "size", min: 1, max: 1, options: [{ name: "15 cm · serve 10", price: 0 }, { name: "20 cm · serve 20", price: 60 }, { name: "25 cm · serve 30", price: 120 }] },
      { key: "massa", name: "Massa", role: "base", min: 1, max: 1, options: [{ name: "Baunilha", price: 0 }, { name: "Chocolate", price: 0 }, { name: "Red velvet", price: 10 }] },
      { key: "recheio", name: "Recheios", role: "flavor", min: 1, max: 2, options: [{ name: "Brigadeiro", price: 0 }, { name: "Ninho", price: 0 }, { name: "Doce de leite", price: 0 }, { name: "Frutas vermelhas", price: 15 }] },
      { key: "msg", name: "Mensagem no topo", role: "instruction", min: 0, max: 1, options: [{ name: "Escrever mensagem (informe nas observações)", price: 10 }] },
      { key: "docinhos", name: "Sabores dos docinhos (até 4)", role: "flavor", min: 1, max: 4, options: [{ name: "Brigadeiro", price: 0 }, { name: "Beijinho", price: 0 }, { name: "Casadinho", price: 0 }, { name: "Bicho de pé", price: 0 }] },
    ],
    items: [
      { cat: 0, name: "Fatia de bolo do dia", price: 16.9, serves: "serve 1" },
      { cat: 0, name: "Brownie", price: 12.9, measure: g(90) },
      { cat: 1, name: "Bolo personalizado", description: "Monte tamanho, massa e recheio. Entrega a partir de 48 h.", price: 129.9, groups: ["tamanho", "massa", "recheio", "msg"], leadTimeHours: 48, serves: "serve 10" },
      { cat: 2, name: "Torta de limão inteira", price: 89.9, leadTimeHours: 24, serves: "serve 12" },
      { cat: 3, name: "Kit festa 20 pessoas", description: "Bolo 20 cm, 100 docinhos e 100 salgados", kind: "combo", price: 289.9, groups: ["recheio", "docinhos"], leadTimeHours: 72, serves: "serve 20" },
      { cat: 3, name: "Cento de brigadeiro gourmet", kind: "combo", price: 220, measure: un(100), leadTimeHours: 48, groups: ["docinhos"] },
      ...DRINKS(4),
    ],
    tips: ["Encomendas pedem data e horário na finalização; o pedido entra na coluna Agendados do gestor.", "Tamanho em “serve N” vende melhor que centímetros."],
  },
  {
    id: "churrasco", label: "Churrasco e costela", pitch: "Carnes por peso com preço por kg, ponto, acompanhamentos com cota e kits para a família.",
    keywords: ["costela", "picanha", "fraldinha", "churrasco", "brasa", "linguiça", "cupim", "maminha", "bafo", "defumad", "farofa", "vinagrete", "pão de alho"],
    features: ["by_weight", "serves", "doneness", "quota"], triage: "generico",
    categories: [{ name: "Kits para a família", locked: true }, { name: "Costelas" }, { name: "Carnes na brasa" }, { name: "Acompanhamentos" }, drinkCat],
    groups: [
      { key: "peso", name: "Quantidade", role: "size", min: 1, max: 1, options: [{ name: "500 g · serve 2", price: 0, measure: g(500) }, { name: "1 kg · serve 4", price: 64, measure: g(1000) }, { name: "1,5 kg · serve 6", price: 125, measure: g(1500) }] },
      { key: "ponto", name: "Ponto", role: "instruction", min: 1, max: 1, options: [{ name: "Ao ponto", price: 0 }, { name: "Ao ponto para mal", price: 0 }, { name: "Bem passada", price: 0 }] },
      { key: "acomp", name: "Acompanhamentos · 2 grátis", role: "side", min: 0, max: 4, freeQuota: 2, options: [{ name: "Arroz branco", price: 8 }, { name: "Farofa de bacon", price: 8 }, { name: "Vinagrete", price: 6 }, { name: "Mandioca cozida", price: 10 }, { name: "Feijão tropeiro", price: 12 }] },
    ],
    items: [
      { cat: 1, name: "Costela no bafo", description: "12 horas no fogo de chão, desfiando", price: 69.9, measure: g(500), groups: ["peso", "acomp"], serves: "serve 2" },
      { cat: 2, name: "Picanha fatiada", price: 89.9, measure: g(400), groups: ["ponto", "acomp"], serves: "serve 2", tags: ["sem_gluten"] },
      { cat: 2, name: "Linguiça toscana", price: 34.9, measure: g(500) },
      { cat: 0, name: "Kit churrasco família", description: "1 kg de costela, 500 g de linguiça, farofa, vinagrete e pão de alho", kind: "combo", price: 189.9, compareAt: 214.6, serves: "serve 4" },
      { cat: 3, name: "Pão de alho", price: 19.9, measure: un(4) },
      ...DRINKS(4),
    ],
    tips: ["Carne por peso: o cardápio mostra o preço por kg ao lado do preço da porção.", "“Serve N” alimenta a pergunta “pra quantas pessoas?” da triagem."],
  },
  {
    id: "marmita", label: "Marmitas e almoço", pitch: "Prato do dia por dia da semana, monte sua marmita com proteína e acompanhamentos com cota.",
    keywords: ["marmita", "marmitex", "prato do dia", "prato feito", "pf", "executivo", "feijoada", "strogonoff", "arroz e feijão", "quentinha"],
    features: ["daily_menu", "quota", "sizes", "build"], triage: "generico",
    categories: [{ name: "Prato do dia", description: "Muda todo dia" }, { name: "Monte sua marmita" }, { name: "Fit" }, drinkCat, { name: "Sobremesas" }],
    groups: [
      { key: "tamanho", name: "Tamanho", role: "size", min: 1, max: 1, options: [{ name: "Pequena · 400 g", price: 0, measure: g(400) }, { name: "Média · 600 g", price: 4, measure: g(600) }, { name: "Grande · 800 g", price: 8, measure: g(800) }] },
      { key: "proteina", name: "Proteína", role: "protein", min: 1, max: 1, options: [{ name: "Frango grelhado", price: 0 }, { name: "Carne de panela", price: 3 }, { name: "Peixe", price: 4 }, { name: "Omelete", price: 0 }] },
      { key: "acomp", name: "Acompanhamentos · 3 grátis", role: "side", min: 2, max: 5, freeQuota: 3, options: [{ name: "Arroz branco", price: 2 }, { name: "Arroz integral", price: 2 }, { name: "Feijão", price: 2 }, { name: "Farofa", price: 2 }, { name: "Salada", price: 2 }, { name: "Legumes", price: 2 }, { name: "Purê", price: 3 }] },
    ],
    items: [
      { cat: 0, name: "Feijoada completa", price: 32.9, availability: { weekdays: [3, 6] }, serves: "serve 1" },
      { cat: 0, name: "Strogonoff de frango", price: 27.9, availability: { weekdays: [1, 4] } },
      { cat: 1, name: "Monte sua marmita", description: "Escolha tamanho, proteína e 3 acompanhamentos grátis", price: 21.9, groups: ["tamanho", "proteina", "acomp"] },
      { cat: 2, name: "Frango com batata-doce", price: 26.9, tags: ["fit", "sem_gluten", "sem_lactose"] },
      ...DRINKS(3),
      { cat: 4, name: "Pudim", price: 9.9 },
    ],
    tips: ["Prato do dia tem dias de venda: fora deles aparece como “volta na quarta”.", "Acompanhamentos com cota grátis evitam cadastrar uma marmita para cada combinação."],
  },
  {
    id: "arabe", label: "Árabe e esfiharia", pitch: "Esfihas por unidade e caixas de 12 em que o cliente distribui os sabores.",
    keywords: ["esfiha", "esfirra", "kibe", "quibe", "kafta", "homus", "babaganuche", "tabule", "falafel", "shawarma", "baklava", "árabe"],
    features: ["pieces", "serves"], triage: "generico",
    categories: [{ name: "Esfihas" }, { name: "Caixas e kits", locked: true }, { name: "Pratos" }, { name: "Doces árabes" }, drinkCat],
    groups: [
      { key: "caixa", name: "Distribua as 12 esfihas", role: "flavor", min: 12, max: 12, allowRepeat: true, options: [{ name: "Carne", price: 0 }, { name: "Queijo", price: 0 }, { name: "Calabresa", price: 0 }, { name: "Escarola", price: 0 }, { name: "Frango com catupiry", price: 1 }] },
    ],
    items: [
      { cat: 0, name: "Esfiha aberta de carne", price: 6.9, measure: un(1) },
      { cat: 0, name: "Esfiha de queijo", price: 6.9, measure: un(1), tags: ["vegetariano"] },
      { cat: 1, name: "Caixa com 12 esfihas", kind: "combo", price: 69.9, measure: un(12), groups: ["caixa"], serves: "serve 3" },
      { cat: 2, name: "Kafta no prato", description: "Com arroz, homus e salada", price: 42.9 },
      { cat: 2, name: "Homus com pão sírio", price: 24.9, tags: ["vegano"] },
      { cat: 3, name: "Baklava", price: 9.9 },
      ...DRINKS(4),
    ],
    tips: ["Caixa com N unidades: grupo com mínimo e máximo iguais e repetição liberada.", "Mostrar o preço por unidade na caixa evidencia a economia."],
  },
  {
    id: "salgados", label: "Salgados e festas", pitch: "Salgados por unidade e centos para festa com encomenda.",
    keywords: ["coxinha", "risole", "bolinha de queijo", "enroladinho", "empada", "pastel", "salgado", "cento", "mini"],
    features: ["pieces", "preorder"], triage: "generico",
    categories: [{ name: "Fritos na hora" }, { name: "Assados" }, { name: "Cento para festa", description: "Encomende com 24 h" }, drinkCat],
    groups: [{ key: "sabores", name: "Sabores (até 4, divididos igualmente)", role: "flavor", min: 1, max: 4, options: [{ name: "Coxinha", price: 0 }, { name: "Bolinha de queijo", price: 0 }, { name: "Risole de presunto", price: 0 }, { name: "Kibe", price: 0 }, { name: "Enroladinho de salsicha", price: 0 }] }],
    items: [
      { cat: 0, name: "Coxinha de frango", price: 7.5, measure: un(1) },
      { cat: 0, name: "Pastel de carne", price: 9.9 },
      { cat: 1, name: "Empada de palmito", price: 8.9, tags: ["vegetariano"] },
      { cat: 2, name: "Cento de salgados fritos", price: 89.9, measure: un(100), groups: ["sabores"], leadTimeHours: 24, serves: "serve 10" },
      ...DRINKS(3),
    ],
    tips: ["Centos são encomenda: o cliente escolhe data e horário.", "Preço por unidade aparece no cento para comparar com o avulso."],
  },
  {
    id: "poke", label: "Poke", pitch: "Monte seu poke em etapas: base, proteína, toppings com cota grátis e molho.",
    keywords: ["poke", "bowl", "edamame", "ponzu", "sriracha", "salmão", "tofu", "quinoa"],
    features: ["build", "quota"], triage: "generico",
    categories: [{ name: "Monte seu poke" }, { name: "Pokes da casa" }, drinkCat],
    groups: [
      { key: "base", name: "Base", role: "base", min: 1, max: 1, options: [{ name: "Arroz japonês", price: 0 }, { name: "Arroz integral", price: 0 }, { name: "Mix de folhas", price: 0 }, { name: "Quinoa", price: 3 }] },
      { key: "proteina", name: "Proteína", role: "protein", min: 1, max: 2, options: [{ name: "Salmão", price: 0 }, { name: "Tofu", price: 0 }, { name: "Atum", price: 4 }, { name: "Camarão", price: 6 }] },
      { key: "toppings", name: "Toppings · 4 grátis", role: "addon", min: 0, max: 8, freeQuota: 4, options: [{ name: "Manga", price: 2.5 }, { name: "Pepino", price: 2 }, { name: "Edamame", price: 3 }, { name: "Abacate", price: 3 }, { name: "Cebola roxa", price: 2 }, { name: "Cream cheese", price: 3 }, { name: "Kani", price: 3 }] },
      { key: "molho", name: "Molho", role: "sauce", min: 1, max: 2, options: [{ name: "Shoyu", price: 0 }, { name: "Tarê", price: 0 }, { name: "Ponzu", price: 0 }, { name: "Maionese de sriracha", price: 0 }] },
    ],
    items: [
      { cat: 0, name: "Poke do seu jeito", description: "Base, proteína, 4 toppings grátis e molho", price: 39.9, groups: ["base", "proteina", "toppings", "molho"] },
      { cat: 1, name: "Poke salmão clássico", price: 44.9, groups: ["molho"] },
      { cat: 1, name: "Poke vegano de tofu", price: 36.9, groups: ["molho"], tags: ["vegano"] },
      ...DRINKS(2),
    ],
    tips: ["Etapas na ordem base → proteína → toppings → molho deixam o “monte o seu” rápido no celular."],
  },
  {
    id: "padaria", label: "Padaria e café", pitch: "Café da manhã com horário, pães por peso e cafés com tamanho e tipo de leite.",
    keywords: ["pão", "padaria", "croissant", "café", "cappuccino", "pão de queijo", "misto quente", "tapioca", "café da manhã", "broa"],
    features: ["daily_menu", "by_weight", "sizes"], triage: "generico",
    categories: [{ name: "Café da manhã", description: "Até as 11h", availability: { to: "11:00" } }, { name: "Pães e salgados" }, { name: "Doces e bolos" }, { name: "Cafés e bebidas" }],
    groups: [
      { key: "tamanho", name: "Tamanho", role: "size", min: 1, max: 1, options: [{ name: "Pequeno · 180 ml", price: 0, measure: ml(180) }, { name: "Grande · 300 ml", price: 3, measure: ml(300) }] },
      { key: "leite", name: "Leite", role: "base", min: 1, max: 1, options: [{ name: "Integral", price: 0 }, { name: "Desnatado", price: 0 }, { name: "Vegetal (aveia)", price: 3, tags: ["vegano"] }] },
    ],
    items: [
      { cat: 0, name: "Kit café da manhã", description: "Pão na chapa, café com leite, suco e fruta", price: 34.9, availability: { to: "11:00" }, serves: "serve 1" },
      { cat: 1, name: "Pão de queijo", price: 6.9, measure: g(100) },
      { cat: 1, name: "Misto quente", price: 14.9 },
      { cat: 2, name: "Bolo de cenoura com chocolate", price: 9.9, description: "Fatia" },
      { cat: 3, name: "Café com leite", price: 8.9, groups: ["tamanho", "leite"] },
      { cat: 3, name: "Suco de laranja", price: 11.9, measure: ml(300), isDrink: true },
    ],
    tips: ["Categorias com horário somem do topo fora da janela e voltam sozinhas no dia seguinte."],
  },
  {
    id: "saudavel", label: "Saudável e fit", pitch: "Bowls e saladas com selos (vegano, sem glúten, low carb) e filtros no cardápio.",
    keywords: ["fit", "low carb", "salada", "bowl", "integral", "sem glúten", "vegano", "detox", "proteico", "whey"],
    features: ["build"], triage: "generico",
    categories: [{ name: "Bowls" }, { name: "Saladas" }, { name: "Sucos e detox" }, { name: "Snacks" }],
    groups: [{ key: "molho", name: "Molho", role: "sauce", min: 0, max: 1, options: [{ name: "Mostarda e mel", price: 0 }, { name: "Iogurte e ervas", price: 0 }, { name: "Tahine", price: 0, tags: ["vegano"] }] }],
    items: [
      { cat: 0, name: "Bowl de frango com quinoa", price: 38.9, groups: ["molho"], tags: ["sem_gluten", "fit"] },
      { cat: 0, name: "Bowl vegano de grão-de-bico", price: 34.9, groups: ["molho"], tags: ["vegano", "sem_gluten"] },
      { cat: 1, name: "Salada caesar com frango", price: 32.9, groups: ["molho"], tags: ["low_carb"] },
      { cat: 2, name: "Suco verde", price: 14.9, measure: ml(400), isDrink: true, tags: ["vegano", "zero_acucar"] },
      { cat: 3, name: "Cookie integral", price: 9.9, tags: ["vegano"] },
    ],
    tips: ["Selos viram filtros no topo do cardápio (vegano, sem glúten, sem lactose)."],
  },
  {
    id: "italiana", label: "Italiana e massas", pitch: "Massa monte a sua (tipo + molho), pratos prontos, risotos e vinhos.",
    keywords: ["massa", "lasanha", "nhoque", "espaguete", "penne", "fettuccine", "risoto", "parmegiana", "bolonhesa", "carbonara", "tiramisù"],
    features: ["build", "serves"], triage: "generico",
    categories: [{ name: "Massas" }, { name: "Pratos" }, { name: "Risotos" }, { name: "Sobremesas" }, { name: "Vinhos e bebidas" }],
    groups: [
      { key: "massa", name: "Massa", role: "base", min: 1, max: 1, options: [{ name: "Espaguete", price: 0 }, { name: "Penne", price: 0 }, { name: "Fettuccine", price: 0 }, { name: "Nhoque de batata", price: 5 }, { name: "Penne sem glúten", price: 6, tags: ["sem_gluten"] }] },
      { key: "molho", name: "Molho", role: "flavor", min: 1, max: 1, options: [{ name: "Sugo", price: 0 }, { name: "Bolonhesa", price: 6 }, { name: "Quatro queijos", price: 8 }, { name: "Pesto", price: 6 }, { name: "Carbonara", price: 9 }] },
      { key: "extra", name: "Adicionais", role: "addon", min: 0, max: 3, options: [{ name: "Parmesão extra", price: 4 }, { name: "Frango grelhado", price: 9 }, { name: "Camarão", price: 16 }] },
    ],
    items: [
      { cat: 0, name: "Massa do seu jeito", price: 42.9, groups: ["massa", "molho", "extra"], serves: "serve 1" },
      { cat: 1, name: "Lasanha à bolonhesa", price: 54.9, serves: "serve 1" },
      { cat: 1, name: "Parmegiana de frango para 2", price: 89.9, serves: "serve 2" },
      { cat: 2, name: "Risoto de cogumelos", price: 62.9, tags: ["vegetariano", "sem_gluten"] },
      { cat: 3, name: "Tiramisù", price: 24.9 },
      { cat: 4, name: "Vinho tinto chileno", price: 69.9, measure: ml(750), isDrink: true },
    ],
    tips: ["Massa + molho como etapas evita dezenas de itens repetidos."],
  },
  {
    id: "mexicana", label: "Mexicana", pitch: "Burritos e tacos com proteína, nível de pimenta e extras.",
    keywords: ["burrito", "taco", "nachos", "quesadilla", "guacamole", "jalapeño", "chili", "mexican", "tortilla"],
    features: ["build"], triage: "generico",
    categories: [{ name: "Burritos" }, { name: "Tacos" }, { name: "Nachos e entradas" }, drinkCat],
    groups: [
      { key: "proteina", name: "Proteína", role: "protein", min: 1, max: 1, options: [{ name: "Carne desfiada", price: 0 }, { name: "Frango", price: 0 }, { name: "Feijão e legumes", price: 0, tags: ["vegano"] }, { name: "Camarão", price: 8 }] },
      { key: "pimenta", name: "Nível de pimenta", role: "instruction", min: 1, max: 1, options: [{ name: "Sem pimenta", price: 0 }, { name: "Leve", price: 0 }, { name: "Médio", price: 0 }, { name: "Ardido", price: 0 }] },
      { key: "extras", name: "Extras", role: "addon", min: 0, max: 3, options: [{ name: "Guacamole", price: 6 }, { name: "Cheddar", price: 4 }, { name: "Sour cream", price: 4 }] },
    ],
    items: [
      { cat: 0, name: "Burrito", price: 36.9, groups: ["proteina", "pimenta", "extras"] },
      { cat: 1, name: "Tacos (3 un)", price: 32.9, measure: un(3), groups: ["proteina", "pimenta"] },
      { cat: 2, name: "Nachos com guacamole", price: 29.9, serves: "serve 2", tags: ["vegetariano"] },
      ...DRINKS(3),
    ],
    tips: ["Nível de pimenta é grupo obrigatório sem preço: reduz reclamação de “muito apimentado”."],
  },
  {
    id: "bar", label: "Bar e petiscos", pitch: "Porções meia ou inteira com “serve N”, drinks e cervejas por ml.",
    keywords: ["porção", "petisco", "chopp", "cerveja", "caipirinha", "drink", "gin", "batata frita", "isca", "bolinho de bacalhau", "torresmo"],
    features: ["sizes", "serves"], triage: "generico",
    categories: [{ name: "Combos para a galera", locked: true }, { name: "Porções" }, { name: "Drinks" }, { name: "Cervejas" }],
    groups: [{ key: "tamanho", name: "Tamanho da porção", role: "size", min: 1, max: 1, options: [{ name: "Meia · serve 2", price: 0 }, { name: "Inteira · serve 4", price: 24 }] }],
    items: [
      { cat: 1, name: "Batata frita com cheddar e bacon", price: 34.9, groups: ["tamanho"], serves: "serve 2" },
      { cat: 1, name: "Isca de peixe", price: 49.9, groups: ["tamanho"], serves: "serve 2" },
      { cat: 1, name: "Bolinho de bacalhau", price: 42.9, measure: un(10) },
      { cat: 2, name: "Caipirinha de limão", price: 22.9, isDrink: true },
      { cat: 3, name: "Cerveja long neck", price: 12.9, measure: ml(355), isDrink: true },
      { cat: 0, name: "Combo galera: 2 porções inteiras + 6 long necks", kind: "combo", price: 179.9, compareAt: 194.8, serves: "serve 6" },
    ],
    tips: ["Bebida alcoólica exige confirmar maioridade na entrega: avise na descrição."],
  },
  {
    id: "generico", label: "Outra culinária", pitch: "Estrutura básica: destaques, pratos, adicionais, bebidas e sobremesas.",
    keywords: [],
    features: [], triage: "generico",
    categories: [{ name: "Destaques" }, { name: "Pratos" }, drinkCat, { name: "Sobremesas" }],
    groups: [{ key: "adicionais", name: "Adicionais", role: "addon", min: 0, max: 3, options: [{ name: "Adicional 1", price: 5 }, { name: "Adicional 2", price: 5 }] }],
    items: [
      { cat: 1, name: "Prato da casa", price: 39.9, groups: ["adicionais"] },
      ...DRINKS(2),
      { cat: 3, name: "Sobremesa do dia", price: 14.9 },
    ],
    tips: ["Comece pelos 10 itens que mais vendem; o resto entra depois."],
  },
];

export const cuisineById = (id?: string) => CUISINES.find((c) => c.id === id) || CUISINES[CUISINES.length - 1];

/* ---------------- selos (tags) padronizados ---------------- */
export const DIET_TAGS: { id: string; label: string; words: RegExp }[] = [
  { id: "vegano", label: "Vegano", words: /\bvegan[oa]s?\b|\bveg\b|plant[- ]based/i },
  { id: "vegetariano", label: "Vegetariano", words: /vegetarian[oa]/i },
  { id: "sem_gluten", label: "Sem glúten", words: /sem gl[uú]ten|gluten[- ]free/i },
  { id: "sem_lactose", label: "Sem lactose", words: /sem lactose|zero lactose|lactose[- ]free/i },
  { id: "zero_acucar", label: "Zero açúcar", words: /zero a[cç][uú]car|sem a[cç][uú]car|diet\b/i },
  { id: "low_carb", label: "Low carb", words: /low ?carb/i },
  { id: "fit", label: "Fit", words: /\bfit\b|proteic[oa]/i },
  { id: "picante", label: "Picante", words: /picante|apimentad|pimenta|ardid|jalape/i },
];
export const tagLabel = (id: string) => DIET_TAGS.find((t) => t.id === id)?.label || id;
export function tagsFromText(...texts: (string | undefined)[]) {
  const s = texts.filter(Boolean).join(" ");
  return DIET_TAGS.filter((t) => t.words.test(s)).map((t) => t.id);
}

/* ---------------- detecção da culinária ---------------- */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pontua cada culinária pelas palavras-chave nos nomes do cardápio. Devolve as mais prováveis primeiro. */
export function detectCuisine(names: string[]): { id: CuisineId; label: string; score: number }[] {
  const text = names.map(norm);
  const out = CUISINES.filter((c) => c.keywords.length).map((c) => {
    let hits = 0;
    for (const k of c.keywords.map(norm)) for (const t of text) if (t.includes(k)) hits++;
    return { id: c.id, label: c.label, score: hits };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const total = out.reduce((a, b) => a + b.score, 0) || 1;
  return out.map((x) => ({ ...x, score: r2(x.score / total) }));
}

/* ---------------- aplicar o modelo ---------------- */
const slug = (s: string) => norm(s).replace(/&/g, "e").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Gera categorias, grupos e itens de exemplo do modelo, prontos para gravar no rascunho. */
export function applyTemplate(t: CuisineTemplate, opts: { withSamples?: boolean; prefix?: string } = {}) {
  const pre = opts.prefix || t.id;
  const categories: Category[] = t.categories.map((c, i) => ({ id: `cat_${pre}_${slug(c.name)}`, name: c.name, slug: slug(c.name), position: i, visible: true, ...(c.locked ? { pricingLocked: true } : {}), ...(c.description ? { description: c.description } : {}), ...(c.availability ? { availability: c.availability } : {}) }));
  const groups: OptionGroup[] = t.groups.map((gr) => ({
    id: `grp_${pre}_${gr.key}`, name: gr.name, min: gr.min, max: gr.max, rule: gr.rule || "sum", allowRepeat: !!gr.allowRepeat, role: gr.role,
    ...(gr.freeQuota ? { freeQuota: gr.freeQuota } : {}),
    options: gr.options.map((o) => ({ id: slug(o.name).slice(0, 40), name: o.name, price: gr.rule === "fraction" ? 0 : o.price ?? 0, ...(o.fullPrice != null ? { fullPrice: o.fullPrice } : {}), ...(o.description ? { description: o.description } : {}), ...(o.measure ? { measure: o.measure } : {}), ...(o.tags ? { tags: o.tags } : {}), active: true })),
  }));
  const gid = (k: string) => `grp_${pre}_${k}`;
  const items: Item[] = (opts.withSamples === false ? [] : t.items).map((it, i) => ({
    id: `itm_${pre}_${slug(it.name)}`, categoryId: categories[it.cat].id, name: it.name, ...(it.description ? { description: it.description } : {}),
    kind: it.kind || (it.groups?.some((k) => t.groups.find((x) => x.key === k)?.rule === "fraction") ? "buildable" : "simple"),
    price: it.price, ...(it.compareAt ? { compareAt: it.compareAt } : {}), groupIds: (it.groups || []).map(gid), active: true, available: true, position: i,
    ...(it.measure ? { measure: it.measure } : {}), ...(it.leadTimeHours ? { leadTimeHours: it.leadTimeHours } : {}), ...(it.availability ? { availability: it.availability } : {}),
    ...(it.tags ? { tags: it.tags } : {}), ...(it.serves ? { serves: it.serves } : {}), ...(it.isDrink ? { isDrink: true } : {}),
  }));
  return { categories, groups, items };
}

/* ---------------- medidas, janelas e encomendas ---------------- */
const UNIT: Record<Measure["unit"], string> = { g: "g", kg: "kg", ml: "ml", l: "L", un: "un" };
export function measureLabel(m: Measure) {
  if (m.unit === "g" && m.amount >= 1000) return `${String(m.amount / 1000).replace(".", ",")} kg`;
  if (m.unit === "ml" && m.amount >= 1000) return `${String(m.amount / 1000).replace(".", ",")} L`;
  return `${String(m.amount).replace(".", ",")} ${UNIT[m.unit]}`;
}
/** "R$ 139,80/kg", "R$ 0,06/ml" vira "R$ 56,33/L", "R$ 5,83/un". */
export function pricePerMeasure(price: number, m?: Measure): string | null {
  if (!m || !m.amount || !price) return null;
  if (m.unit === "un") return m.amount > 1 ? `${BRL(price / m.amount)}/un` : null;
  if (m.unit === "g") return `${BRL((price / m.amount) * 1000)}/kg`;
  if (m.unit === "kg") return `${BRL(price / m.amount)}/kg`;
  if (m.unit === "ml") return `${BRL((price / m.amount) * 1000)}/L`;
  return `${BRL(price / m.amount)}/L`;
}

const WD = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function localParts(d: Date, tz = "America/Sao_Paulo") {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")!.value) as Weekday;
  const hh = p.find((x) => x.type === "hour")!.value.replace("24", "00");
  return { weekday: wd, time: `${hh}:${p.find((x) => x.type === "minute")!.value}` };
}
/** Está dentro da janela de venda? Se não, devolve quando volta ("volta quarta", "a partir das 11:00"). */
export function availableAt(av: Availability | undefined, now: Date, tz?: string): { ok: boolean; label?: string } {
  if (!av || (!av.weekdays?.length && !av.from && !av.to)) return { ok: true };
  const { weekday, time } = localParts(now, tz);
  const dayOk = !av.weekdays?.length || av.weekdays.includes(weekday);
  const timeOk = (!av.from || time >= av.from) && (!av.to || time < av.to);
  if (dayOk && timeOk) return { ok: true };
  if (dayOk && av.from && time < av.from) return { ok: false, label: `a partir das ${av.from}` };
  const days = av.weekdays?.length ? av.weekdays : ([0, 1, 2, 3, 4, 5, 6] as Weekday[]);
  for (let k = 1; k <= 7; k++) { const w = ((weekday + k) % 7) as Weekday; if (days.includes(w)) return { ok: false, label: k === 1 ? `volta amanhã${av.from ? ` às ${av.from}` : ""}` : `volta ${WD[w]}${av.from ? ` às ${av.from}` : ""}` }; }
  return { ok: false, label: "indisponível agora" };
}
export function availabilityLabel(av?: Availability) {
  if (!av) return "";
  const d = av.weekdays?.length ? (av.weekdays.length === 7 ? "todos os dias" : av.weekdays.map((w) => WD[w].slice(0, 3)).join(", ")) : "";
  const h = av.from && av.to ? `${av.from}–${av.to}` : av.from ? `a partir das ${av.from}` : av.to ? `até ${av.to}` : "";
  return [d, h].filter(Boolean).join(" · ");
}
export function leadTimeLabel(h?: number) {
  if (!h) return "";
  return h % 24 === 0 ? `encomenda com ${h / 24} ${h === 24 ? "dia" : "dias"} de antecedência` : `encomenda com ${h} h de antecedência`;
}
/** Primeiro horário possível de entrega para uma sacola com itens de encomenda. */
export function earliestSchedule(items: Pick<Item, "leadTimeHours">[], now: Date): Date | null {
  const h = Math.max(0, ...items.map((i) => i.leadTimeHours || 0));
  return h ? new Date(+now + h * 3600e3) : null;
}
