import type { OnlineCfg } from "./payments";
import type { Banner, CartLineInput, CrossSellRule, Item, OptionGroup, Page, PaymentCode, Strategy, Tenant } from "@cw/core";

export type MenuItem = Item & { fromPrice: boolean; minPrice?: number };
/** Preço exibido no card: o menor preço possível do item. */
export const shownPrice = (it: { price: number; minPrice?: number }) => it.minPrice ?? it.price;
export type MenuStrategy = Strategy & { coupon?: { id?: string; name?: string; code?: string; type?: string; value?: number; maxDiscount?: number; minSubtotal?: number } };

export interface Menu {
  tenant: Pick<Tenant, "id" | "slug" | "name" | "branding" | "settings">;
  store: {
    id: string; name: string; address: { street: string; number: string; district: string; city: string; state: string; postalCode: string };
    phone?: string; open: boolean; modes: { delivery: boolean; takeout: boolean };
    payments: { code: PaymentCode; label: string; online: boolean }[]; eta?: [number, number]; hours: { weekday: number; open: string; close: string }[];
  } | null;
  profile: string;
  hero: null | { kicker: string; title: string; sub?: string; personal?: boolean; campaign?: string; action: { kind: "open_item"; itemId: string; selection?: Record<string, Record<string, number>> } | { kind: "reorder"; orderId?: string; lines: CartLineInput[] } | { kind: "category"; categoryId: string } };
  /** triagem da primeira visita (só para quem não é cliente e ainda não respondeu) */
  firstVisit?: FirstVisit | null;
  lead?: { id: string; couponUnlocked: boolean; couponCode?: string } | null;
  banners: Partial<Record<"menu_top" | "below_suggested" | "bag" | "after_order", Banner | undefined>>;
  mostOrdered: { title: string; itemIds: string[] } | null;
  categories: { id: string; name: string; description?: string; pricingLocked: boolean; itemIds: string[] }[];
  items: Record<string, MenuItem>;
  groups: Record<string, OptionGroup>;
  crossSell: CrossSellRule[];
  strategies: MenuStrategy[];
  hesitationHelpSeconds: number;
  searchInHeader: boolean;
  loyalty: null | { earnPercent: number; minRedeem: number; maxRedeemPercent: number; expiresInDays: number };
  customer: null | { id: string; name?: string; orders: number; daysSinceLastOrder?: number; wallet: { balance: number; expiringSoon: number } | null };
  pages: Pick<Page, "id" | "slug" | "title" | "active">[];
  onlinePayments?: OnlineCfg | null;
}

export interface QuoteResp {
  lines: { itemId: string; name: string; qty: number; unit: number; total: number }[];
  issues: { line: number; issues: { message: string }[] }[];
  subtotal: number; discount: number; deliveryFee: number; baseDeliveryFee: number; deliveryLabel?: string;
  fees: { label: string; amount: number }[];
  progress?: { label: string; missing: number; target: number; pct: number };
  coupon?: { ok: boolean; reason?: string; discount: number; freeDelivery: boolean; name: string };
  cashbackAvailable: number; cashbackUsed: number; cashbackEarned: number; total: number; outOfArea: boolean;
}

export interface CartLine { key: string; itemId: string; qty: number; selection: Record<string, Record<string, number>>; notes?: string }

export interface FirstVisit {
  mode: "reward" | "gate";
  source: "personas" | "playbook";
  coupon: { name: string; type: string; value: number; maxDiscount?: number; minSubtotal?: number } | null;
  questions: { id: string; title: string; options: { id: string; label: string; final?: boolean }[] }[];
  afterSeconds: number;
  consentText: string;
}
