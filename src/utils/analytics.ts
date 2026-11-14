import type {
  AppLanguage,
  CurrencyConfig,
  DashboardMetrics,
  DateRangeFilter,
  Expense,
  ExpenseCategory,
  FinanceAnalyticsData,
  FinancialGranularity,
  FinancialOrderScope,
  FinancialPeriodSummary,
  Order,
  Product,
  SalesSeriesPoint,
  TopProductPerformance,
} from '../types/zenorati';
import { DEFAULT_USD_TO_EGP_RATE, resolveReportingAmount } from './currency';

function isWithinRange(isoDate: string, range: DateRangeFilter): boolean {
  if (range === 'all') return true;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const target = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(target.getTime())) return true;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return target >= cutoff;
}

function formatAxisLabel(isoDate: string, language: AppLanguage = 'en'): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

const DEFAULT_CURRENCY_CONFIG: CurrencyConfig = {
  reportingCurrency: 'USD',
  usdToEgpRate: DEFAULT_USD_TO_EGP_RATE,
  language: 'en',
};

export function computeDashboardMetrics(
  orders: Order[],
  products: Product[],
  expenses: Expense[],
  range: DateRangeFilter,
  lowStockThreshold: number,
  currencyConfig: CurrencyConfig = DEFAULT_CURRENCY_CONFIG
): DashboardMetrics {
  const language: AppLanguage = currencyConfig.language ?? 'en';
  const filteredOrders = orders.filter((o) => isWithinRange(o.orderDate, range));
  const filteredExpenses = expenses.filter((e) => isWithinRange(e.expenseDate, range));

  const activeOrders = filteredOrders.filter(
    (o) => o.status !== 'cancelled' && o.status !== 'returned'
  );
  const cancelledOrders = filteredOrders.length - activeOrders.length;

  let unconvertedCount = 0;
  let totalRevenue = 0;
  let totalCogs = 0;
  let countedOrderCount = 0;

  // Build chronological time-series from actual order & expense dates
  const dateBuckets = new Map<string, { revenue: number; cogs: number; expenses: number; orders: number }>();

  if (range !== 'all') {
    const bucketDays = range === '7d' ? 7 : range === '30d' ? 14 : 18;
    const stepDays = range === '7d' ? 1 : range === '30d' ? 2 : 5;
    for (let i = bucketDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * stepDays);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dateBuckets.set(iso, { revenue: 0, cogs: 0, expenses: 0, orders: 0 });
    }
  }

  const ensureBucket = (isoDate: string) => {
    if (dateBuckets.has(isoDate)) return isoDate;
    if (range === 'all') {
      dateBuckets.set(isoDate, { revenue: 0, cogs: 0, expenses: 0, orders: 0 });
      return isoDate;
    }
    // Snap to closest bucket on or before isoDate for multi-day intervals
    const keys = Array.from(dateBuckets.keys()).sort();
    let targetKey = keys[0];
    for (const k of keys) {
      if (k <= isoDate) targetKey = k;
    }
    return targetKey;
  };

  // Top products computed directly from real order line items
  const productPerf = new Map<string, { unitsSold: number; revenue: number; grossProfit: number }>();

  for (const order of activeOrders) {
    const revRes = resolveReportingAmount({
      amount: Math.max(0, Number(order.totalAmount) || 0),
      recordCurrency: order.currency,
      recordedExchangeRate: order.exchangeRate,
      recordedConvertedAmount: order.convertedAmount,
      recordedReportingCurrency: order.reportingCurrency,
      config: currencyConfig,
    });
    if (!revRes.ok) {
      unconvertedCount += 1;
      continue;
    }

    const mult = revRes.multiplier;
    const orderRevenue = revRes.amount;
    const orderCost = Number(((Math.max(0, Number(order.totalCost) || 0)) * mult).toFixed(2));

    totalRevenue += orderRevenue;
    totalCogs += orderCost;
    countedOrderCount += 1;

    const key = ensureBucket(order.orderDate);
    if (key) {
      const bucket = dateBuckets.get(key)!;
      bucket.revenue += orderRevenue;
      bucket.cogs += orderCost;
      bucket.orders += 1;
    }

    if (order.items && order.items.length > 0) {
      for (const item of order.items) {
        const current = productPerf.get(item.productId) ?? { unitsSold: 0, revenue: 0, grossProfit: 0 };
        current.unitsSold += item.quantity;
        current.revenue += item.lineTotal * mult;
        current.grossProfit += (item.unitPrice - item.unitCost) * item.quantity * mult;
        productPerf.set(item.productId, current);
      }
    }
  }

  let totalExpenses = 0;
  const categoryMap = new Map<ExpenseCategory, number>();

  for (const exp of filteredExpenses) {
    const expRes = resolveReportingAmount({
      amount: Math.max(0, Number(exp.amount) || 0),
      recordCurrency: exp.currency,
      recordedExchangeRate: exp.exchangeRate,
      recordedConvertedAmount: exp.convertedAmount,
      recordedReportingCurrency: exp.reportingCurrency,
      config: currencyConfig,
    });
    if (!expRes.ok) {
      unconvertedCount += 1;
      continue;
    }

    totalExpenses += expRes.amount;
    categoryMap.set(exp.category, (categoryMap.get(exp.category) ?? 0) + expRes.amount);

    const key = ensureBucket(exp.expenseDate);
    if (key) {
      const bucket = dateBuckets.get(key)!;
      bucket.expenses += expRes.amount;
    }
  }

  const netProfit = totalRevenue - totalCogs - totalExpenses;
  const profitMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const totalOrders = countedOrderCount;
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  let inventoryValueRetail = 0;
  let inventoryValueCost = 0;
  for (const p of products) {
    const retailRes = resolveReportingAmount({
      amount: p.price * p.stock,
      recordCurrency: p.currency,
      config: currencyConfig,
    });
    const costRes = resolveReportingAmount({
      amount: p.cost * p.stock,
      recordCurrency: p.currency,
      config: currencyConfig,
    });
    if (retailRes.ok && costRes.ok) {
      inventoryValueRetail += retailRes.amount;
      inventoryValueCost += costRes.amount;
    } else {
      unconvertedCount += 1;
    }
  }

  const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= lowStockThreshold).length;
  const outOfStockCount = products.filter((p) => p.stock === 0).length;

  const salesSeries: SalesSeriesPoint[] = Array.from(dateBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => ({
      date,
      label: formatAxisLabel(date, language),
      revenue: Number(val.revenue.toFixed(2)),
      expenses: Number((val.expenses + val.cogs).toFixed(2)),
      netProfit: Number((val.revenue - val.cogs - val.expenses).toFixed(2)),
      orders: val.orders,
    }));

  const expensesByCategory = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      sharePct: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const topProducts: TopProductPerformance[] = products
    .map((product) => {
      const perf = productPerf.get(product.id) ?? { unitsSold: 0, revenue: 0, grossProfit: 0 };
      const marginPct =
        product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0;
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        imageKey: product.imageKey,
        unitsSold: perf.unitsSold,
        revenue: Number(perf.revenue.toFixed(2)),
        grossProfit: Number(perf.grossProfit.toFixed(2)),
        marginPct: Number(marginPct.toFixed(1)),
        stock: product.stock,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold);

  return {
    totalRevenue,
    totalCogs,
    totalExpenses,
    netProfit,
    profitMarginPct,
    totalOrders,
    cancelledOrders,
    averageOrderValue,
    inventoryValueRetail,
    inventoryValueCost,
    lowStockCount,
    outOfStockCount,
    unconvertedCount,
    salesSeries,
    expensesByCategory,
    topProducts,
  };
}

function getPeriodMeta(
  isoDate: string,
  granularity: FinancialGranularity,
  language: AppLanguage = 'en'
): { periodKey: string; label: string } {
  const safeIso = /^\d{4}-\d{2}-\d{2}/.test(isoDate) ? isoDate.slice(0, 10) : '';
  if (!safeIso) {
    return { periodKey: 'unknown', label: language === 'ar' ? 'غير محدد' : 'Unspecified' };
  }

  if (granularity === 'daily') {
    return { periodKey: safeIso, label: formatAxisLabel(safeIso, language) };
  }

  if (granularity === 'weekly') {
    const parsed = new Date(`${safeIso}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return { periodKey: safeIso, label: safeIso };
    }
    const day = parsed.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    parsed.setDate(parsed.getDate() + diffToMonday);
    const weekKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    const prefix = language === 'ar' ? 'أسبوع' : 'Wk';
    return { periodKey: weekKey, label: `${prefix} ${formatAxisLabel(weekKey, language)}` };
  }

  const monthKey = safeIso.slice(0, 7);
  const [yrStr, moStr] = monthKey.split('-');
  const year = Number(yrStr);
  const month = Number(moStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { periodKey: monthKey, label: monthKey };
  }
  const monthLabel = new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
  return { periodKey: monthKey, label: monthLabel };
}

export function computeFinanceAnalytics(
  orders: Order[],
  products: Product[],
  expenses: Expense[],
  granularity: FinancialGranularity,
  scope: FinancialOrderScope,
  currencyConfig: CurrencyConfig = DEFAULT_CURRENCY_CONFIG
): FinanceAnalyticsData {
  const language: AppLanguage = currencyConfig.language ?? 'en';
  const productMap = new Map(products.map((p) => [p.id, p]));

  const nonCancelledOrders = orders.filter(
    (o) => o.status !== 'cancelled' && o.status !== 'returned'
  );
  const excludedOrderCount = orders.length - nonCancelledOrders.length;
  const deliveredOrderCount = orders.filter((o) => o.status === 'delivered').length;

  const includedOrders =
    scope === 'delivered'
      ? nonCancelledOrders.filter((o) => o.status === 'delivered')
      : nonCancelledOrders;

  let totalRevenue = 0;
  let orderSubtotalNet = 0;
  let orderTaxTotal = 0;
  let productCosts = 0;
  let orderShippingCosts = 0;
  let countedOrders = 0;
  let unconvertedCount = 0;

  const periodMap = new Map<
    string,
    {
      label: string;
      ordersCount: number;
      revenue: number;
      productCosts: number;
      shippingCosts: number;
      additionalExpenses: number;
    }
  >();

  const bestSellerMap = new Map<
    string,
    {
      productId: string;
      name: string;
      sku: string;
      category: string;
      imageKey: Product['imageKey'];
      unitsSold: number;
      revenue: number;
      cost: number;
      stock: number;
    }
  >();

  const ensurePeriod = (isoDate: string) => {
    const meta = getPeriodMeta(isoDate, granularity, language);
    const existing = periodMap.get(meta.periodKey);
    if (existing) return existing;
    const created = {
      label: meta.label,
      ordersCount: 0,
      revenue: 0,
      productCosts: 0,
      shippingCosts: 0,
      additionalExpenses: 0,
    };
    periodMap.set(meta.periodKey, created);
    return created;
  };

  for (const order of includedOrders) {
    const revRes = resolveReportingAmount({
      amount: Math.max(0, Number(order.totalAmount) || 0),
      recordCurrency: order.currency,
      recordedExchangeRate: order.exchangeRate,
      recordedConvertedAmount: order.convertedAmount,
      recordedReportingCurrency: order.reportingCurrency,
      config: currencyConfig,
    });
    if (!revRes.ok) {
      unconvertedCount += 1;
      continue;
    }

    const mult = revRes.multiplier;
    const rev = revRes.amount;
    const shipping = Math.max(0, Number(order.shippingCost) || 0) * mult;
    const tax = Math.max(0, Number(order.taxAmount) || 0) * mult;
    const netSub = Math.max(
      0,
      (Number(order.subtotal) || 0) - (Number(order.discountAmount) || 0)
    ) * mult;

    let orderCogs = 0;
    if (order.items && order.items.length > 0) {
      for (const item of order.items) {
        const qty = Math.max(0, Number(item.quantity) || 0);
        const catalogProduct = productMap.get(item.productId);
        const unitCost =
          Number.isFinite(item.unitCost) && item.unitCost >= 0
            ? item.unitCost
            : Math.max(0, catalogProduct?.cost ?? 0);
        const itemCost = unitCost * qty * mult;
        const itemRevenue = Math.max(0, Number(item.lineTotal) || 0) * mult;

        orderCogs += itemCost;

        if (qty > 0) {
          const prev = bestSellerMap.get(item.productId) ?? {
            productId: item.productId,
            name: catalogProduct?.name ?? item.productName,
            sku: catalogProduct?.sku ?? item.sku,
            category: catalogProduct?.category ?? (language === 'ar' ? 'الكتالوج' : 'Catalog'),
            imageKey: catalogProduct?.imageKey ?? 'none',
            unitsSold: 0,
            revenue: 0,
            cost: 0,
            stock: catalogProduct?.stock ?? 0,
          };
          prev.unitsSold += qty;
          prev.revenue += itemRevenue;
          prev.cost += itemCost;
          bestSellerMap.set(item.productId, prev);
        }
      }
    } else {
      orderCogs = Math.max(0, Number(order.totalCost) || 0) * mult;
    }

    totalRevenue += rev;
    orderSubtotalNet += netSub;
    orderTaxTotal += tax;
    productCosts += orderCogs;
    orderShippingCosts += shipping;
    countedOrders += 1;

    const bucket = ensurePeriod(order.orderDate);
    bucket.ordersCount += 1;
    bucket.revenue += rev;
    bucket.productCosts += orderCogs;
    bucket.shippingCosts += shipping;
  }

  let additionalExpenses = 0;
  let shippingExpensesInLedger = 0;
  const categoryMap = new Map<ExpenseCategory, number>();

  for (const exp of expenses) {
    const expRes = resolveReportingAmount({
      amount: Math.max(0, Number(exp.amount) || 0),
      recordCurrency: exp.currency,
      recordedExchangeRate: exp.exchangeRate,
      recordedConvertedAmount: exp.convertedAmount,
      recordedReportingCurrency: exp.reportingCurrency,
      config: currencyConfig,
    });
    if (!expRes.ok) {
      unconvertedCount += 1;
      continue;
    }

    const amount = expRes.amount;
    additionalExpenses += amount;
    if (exp.category === 'Shipping') {
      shippingExpensesInLedger += amount;
    }
    categoryMap.set(exp.category, (categoryMap.get(exp.category) ?? 0) + amount);

    const bucket = ensurePeriod(exp.expenseDate);
    bucket.additionalExpenses += amount;
  }

  const grossProfit = totalRevenue - productCosts;
  // Note: orderShippingCosts is part of order totalAmount (customer shipping revenue/pass-through)
  // and carrier shipping invoices belong in additionalExpenses, so shipping is never subtracted twice.
  const netProfit = totalRevenue - productCosts - additionalExpenses;
  const profitMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const orderCount = countedOrders;
  const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

  const chronologicalPeriods: FinancialPeriodSummary[] = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, p]) => {
      const periodNet = p.revenue - p.productCosts - p.additionalExpenses;
      const periodMargin = p.revenue > 0 ? (periodNet / p.revenue) * 100 : 0;
      return {
        periodKey,
        label: p.label,
        ordersCount: p.ordersCount,
        revenue: Number(p.revenue.toFixed(2)),
        productCosts: Number(p.productCosts.toFixed(2)),
        shippingCosts: Number(p.shippingCosts.toFixed(2)),
        additionalExpenses: Number(p.additionalExpenses.toFixed(2)),
        netProfit: Number(periodNet.toFixed(2)),
        marginPct: Number(periodMargin.toFixed(1)),
      };
    });

  const chartSeries: SalesSeriesPoint[] = chronologicalPeriods.map((p) => ({
    date: p.periodKey,
    label: p.label,
    revenue: p.revenue,
    expenses: Number((p.productCosts + p.additionalExpenses).toFixed(2)),
    netProfit: p.netProfit,
    orders: p.ordersCount,
  }));

  const periodSummaries = [...chronologicalPeriods].reverse();

  const expensesByCategory = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount: Number(amount.toFixed(2)),
      sharePct: additionalExpenses > 0 ? (amount / additionalExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const bestSellingProducts: TopProductPerformance[] = Array.from(bestSellerMap.values())
    .map((p) => {
      const gp = p.revenue - p.cost;
      const marginPct = p.revenue > 0 ? (gp / p.revenue) * 100 : 0;
      return {
        productId: p.productId,
        name: p.name,
        sku: p.sku,
        category: p.category,
        imageKey: p.imageKey,
        unitsSold: p.unitsSold,
        revenue: Number(p.revenue.toFixed(2)),
        grossProfit: Number(gp.toFixed(2)),
        marginPct: Number(marginPct.toFixed(1)),
        stock: p.stock,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold);

  return {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    orderSubtotalNet: Number(orderSubtotalNet.toFixed(2)),
    orderTaxTotal: Number(orderTaxTotal.toFixed(2)),
    productCosts: Number(productCosts.toFixed(2)),
    orderShippingCosts: Number(orderShippingCosts.toFixed(2)),
    additionalExpenses: Number(additionalExpenses.toFixed(2)),
    shippingExpensesInLedger: Number(shippingExpensesInLedger.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    profitMarginPct: Number(profitMarginPct.toFixed(1)),
    orderCount,
    averageOrderValue: Number(averageOrderValue.toFixed(2)),
    deliveredOrderCount,
    excludedOrderCount,
    unconvertedCount,
    periodSummaries,
    chartSeries,
    expensesByCategory,
    bestSellingProducts,
  };
}
