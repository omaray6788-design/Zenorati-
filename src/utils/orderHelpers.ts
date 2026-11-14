import type {
  CurrencyCode,
  CurrencyConfig,
  Order,
  OrderChannel,
  OrderHistoryEntry,
  OrderItem,
  OrderStatus,
  Product,
  TenantProfile,
} from '../types/zenorati';
import {
  convertCurrencyAmount,
  DEFAULT_USD_TO_EGP_RATE,
  getEffectiveUsdToEgpRate,
  resolveTransactionCurrency,
} from './currency';
import { createSafeId } from './formatters';

export const ORDER_STATUS_LIST: OrderStatus[] = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
];

export const ORDER_CHANNEL_LIST: OrderChannel[] = [
  'Direct Store',
  'Wholesale',
  'Marketplace',
  'Manual',
];

export const VARIANT_PRESETS_BY_CATEGORY: Record<string, string[]> = {
  'Audio Gear': ['Obsidian Black', 'Arctic Silver', 'Midnight Navy', 'Studio Edition'],
  'Desk Hardware': ['Matte Black / Tactile', 'Anodized Silver / Linear', 'Space Gray', 'Standard'],
  'Home & Brew': ['Matte Obsidian / Walnut', 'Brushed Steel', 'Ceramic White', 'Standard'],
  'Carry & Leather': ['Indigo Full-Grain', 'Espresso Leather', 'Slate Nylon', 'Standard'],
};

export const DEFAULT_VARIANT_OPTIONS = [
  'Standard',
  'Matte Black',
  'Midnight Navy',
  'Arctic Silver',
  'Walnut Edition',
];

export function getVariantOptionsForProduct(product?: Product): string[] {
  if (!product) return DEFAULT_VARIANT_OPTIONS;
  return VARIANT_PRESETS_BY_CATEGORY[product.category] ?? DEFAULT_VARIANT_OPTIONS;
}

export function isConfirmedStatus(status: OrderStatus): boolean {
  return status === 'processing' || status === 'shipped' || status === 'delivered';
}

export function isRestoredStatus(status: OrderStatus): boolean {
  return status === 'cancelled' || status === 'returned';
}

export function inferStockDeducted(order: Pick<Order, 'status' | 'stockDeducted'>): boolean {
  if (typeof order.stockDeducted === 'boolean') return order.stockDeducted;
  return isConfirmedStatus(order.status);
}

/**
 * Generates a guaranteed-unique human-readable order number (ZN-XXXX)
 * using the maximum existing numeric suffix rather than array length.
 */
export function generateUniqueOrderNumber(existingOrders: Order[]): string {
  let maxNum = 1048;
  for (const ord of existingOrders) {
    const match = /^ZN-(\d+)$/i.exec(ord.orderNumber.trim());
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxNum) {
        maxNum = parsed;
      }
    }
  }
  const existingSet = new Set(existingOrders.map((o) => o.orderNumber.toUpperCase()));
  let candidate = maxNum + 1;
  while (existingSet.has(`ZN-${candidate}`)) {
    candidate += 1;
  }
  return `ZN-${candidate}`;
}

export interface LineItemDraft {
  id?: string;
  productId: string;
  variant: string;
  quantity: number;
}

export type DiscountMode = 'fixed' | 'percent';

export function calculateOrderFinancials(params: {
  lineItems: LineItemDraft[];
  products: Product[];
  ownerId: string;
  discountMode: DiscountMode;
  discountValue: number;
  shippingCost: number;
  applyTax: boolean;
  taxRate: number;
  orderCurrency?: CurrencyCode;
  currencyContext?:
    | CurrencyConfig
    | Pick<TenantProfile, 'currency' | 'usdToEgpRate' | 'legacyCurrency'>;
  usdToEgpRate?: number;
}): {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingCost: number;
  totalAmount: number;
  totalCost: number;
  itemCount: number;
  itemsSummary: string;
  items: OrderItem[];
  conversionError?: string;
} {
  const {
    lineItems,
    products,
    ownerId,
    discountMode,
    discountValue,
    shippingCost,
    applyTax,
    taxRate,
    orderCurrency,
    currencyContext,
    usdToEgpRate,
  } = params;

  const targetCurrency: CurrencyCode =
    orderCurrency ??
    (currencyContext
      ? 'reportingCurrency' in currencyContext
        ? currencyContext.reportingCurrency
        : currencyContext.currency
      : 'USD');
  const effectiveRate =
    usdToEgpRate ??
    (currencyContext && 'usdToEgpRate' in currencyContext
      ? getEffectiveUsdToEgpRate(currencyContext.usdToEgpRate)
      : DEFAULT_USD_TO_EGP_RATE);

  let subtotal = 0;
  let totalCost = 0;
  let itemCount = 0;
  let conversionError: string | undefined;
  const summaryParts: string[] = [];
  const builtItems: OrderItem[] = [];

  for (const line of lineItems) {
    const prod = products.find((p) => p.id === line.productId);
    if (!prod || line.quantity < 1) continue;
    const qty = Math.max(1, Math.round(line.quantity));
    const variant = (line.variant || 'Standard').trim().slice(0, 80) || 'Standard';

    const prodCurrency = resolveTransactionCurrency(prod.currency, currencyContext);
    const priceConv = convertCurrencyAmount(
      prod.price,
      prodCurrency,
      targetCurrency,
      effectiveRate
    );
    const costConv = convertCurrencyAmount(
      prod.cost,
      prodCurrency,
      targetCurrency,
      effectiveRate
    );

    if (!priceConv.ok || !costConv.ok) {
      conversionError = `No valid exchange rate available to convert ${prod.name} (${prodCurrency}) to ${targetCurrency}.`;
      continue;
    }

    const unitPrice = priceConv.amount;
    const unitCost = costConv.amount;
    const lineTotal = Number((unitPrice * qty).toFixed(2));
    subtotal += lineTotal;
    totalCost += unitCost * qty;
    itemCount += qty;
    summaryParts.push(
      variant === 'Standard' ? `${qty}x ${prod.name}` : `${qty}x ${prod.name} (${variant})`
    );
    builtItems.push({
      id: line.id || createSafeId('item'),
      ownerId,
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      variant,
      quantity: qty,
      unitPrice,
      unitCost,
      lineTotal,
    });
  }

  const cleanSubtotal = Number(subtotal.toFixed(2));
  const safeDiscountInput = Math.max(0, Number.isFinite(discountValue) ? discountValue : 0);
  const rawDiscount =
    discountMode === 'percent'
      ? (cleanSubtotal * Math.min(100, safeDiscountInput)) / 100
      : safeDiscountInput;
  const discountAmount = Number(Math.min(cleanSubtotal, Math.max(0, rawDiscount)).toFixed(2));
  const discountedSubtotal = Math.max(0, Number((cleanSubtotal - discountAmount).toFixed(2)));
  const cleanShipping = Number(Math.max(0, Number.isFinite(shippingCost) ? shippingCost : 0).toFixed(2));
  const taxAmount = applyTax
    ? Number(((discountedSubtotal * Math.max(0, taxRate)) / 100).toFixed(2))
    : 0;
  const totalAmount = Number((discountedSubtotal + taxAmount + cleanShipping).toFixed(2));

  return {
    subtotal: cleanSubtotal,
    discountAmount,
    taxAmount,
    shippingCost: cleanShipping,
    totalAmount,
    totalCost: Number(totalCost.toFixed(2)),
    itemCount,
    itemsSummary: summaryParts.join(', ').slice(0, 300) || 'Custom order',
    items: builtItems,
    ...(conversionError ? { conversionError } : {}),
  };
}

export interface StockUpdateOp {
  product: Product;
  nextStock: number;
  delta: number;
}

export type StockPlanResult =
  | {
      ok: true;
      nextStockDeducted: boolean;
      stockUpdates: StockUpdateOp[];
    }
  | {
      ok: false;
      error: string;
    };

function aggregateItemQuantities(items: OrderItem[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!items) return map;
  for (const item of items) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + Math.max(0, Math.round(item.quantity)));
  }
  return map;
}

/**
 * Computes idempotent stock deltas for creating or editing an order,
 * preventing negative inventory.
 */
export function computeOrderStockPlan(params: {
  products: Product[];
  previousOrder: Order | null;
  nextItems: OrderItem[];
  nextStatus: OrderStatus;
}): StockPlanResult {
  const { products, previousOrder, nextItems, nextStatus } = params;
  const wasDeducted = previousOrder ? inferStockDeducted(previousOrder) : false;
  const willDeduct = isConfirmedStatus(nextStatus);

  const oldQtyMap = wasDeducted ? aggregateItemQuantities(previousOrder?.items) : new Map<string, number>();
  const newQtyMap = willDeduct ? aggregateItemQuantities(nextItems) : new Map<string, number>();

  const allProductIds = new Set<string>([...oldQtyMap.keys(), ...newQtyMap.keys()]);
  const stockUpdates: StockUpdateOp[] = [];

  for (const pid of allProductIds) {
    const oldQty = oldQtyMap.get(pid) ?? 0;
    const newQty = newQtyMap.get(pid) ?? 0;
    const delta = newQty - oldQty; // positive = deduct from stock, negative = restore to stock
    if (delta === 0) continue;

    const product = products.find((p) => p.id === pid);
    if (!product) {
      if (delta > 0) {
        return {
          ok: false,
          error: 'One or more selected products no longer exist in the catalog.',
        };
      }
      continue;
    }

    const nextStock = product.stock - delta;
    if (nextStock < 0) {
      return {
        ok: false,
        error: `Insufficient inventory for ${product.name} (${product.stock} available, need ${delta} additional unit${delta === 1 ? '' : 's'}).`,
      };
    }

    stockUpdates.push({
      product,
      nextStock,
      delta,
    });
  }

  return {
    ok: true,
    nextStockDeducted: willDeduct,
    stockUpdates,
  };
}

/**
 * Computes idempotent stock deltas when transitioning an order's status,
 * ensuring stock is deducted on confirmation and restored once on cancellation/return.
 */
export function computeStatusTransitionStockPlan(
  products: Product[],
  order: Order,
  nextStatus: OrderStatus
): StockPlanResult {
  const items = order.items ?? [];
  return computeOrderStockPlan({
    products,
    previousOrder: order,
    nextItems: items,
    nextStatus,
  });
}

/**
 * Computes stock restoration when deleting an order that currently holds deducted inventory.
 */
export function computeDeleteOrderStockPlan(
  products: Product[],
  order: Order
): StockUpdateOp[] {
  if (!inferStockDeducted(order)) return [];
  const qtyMap = aggregateItemQuantities(order.items);
  const updates: StockUpdateOp[] = [];
  for (const [pid, qty] of qtyMap.entries()) {
    if (qty <= 0) continue;
    const product = products.find((p) => p.id === pid);
    if (product) {
      updates.push({
        product,
        nextStock: product.stock + qty,
        delta: -qty,
      });
    }
  }
  return updates;
}

export function buildHistoryEntry(
  ownerId: string,
  status: OrderStatus,
  title: string,
  detail: string
): OrderHistoryEntry {
  return {
    id: createSafeId('hist'),
    ownerId,
    status,
    title: title.slice(0, 160),
    detail: detail.slice(0, 300),
    createdAt: new Date().toISOString(),
  };
}
