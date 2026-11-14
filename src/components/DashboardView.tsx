import React from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Package,
  Plus,
  ShoppingBag,
  Receipt,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  Loader2,
  Database,
  RotateCcw,
} from 'lucide-react';
import type {
  BusinessActivity,
  CurrencyCode,
  CurrencyConfig,
  DashboardMetrics,
  DateRangeFilter,
  NavSection,
  Order,
  OrderStatus,
} from '../types/zenorati';
import {
  formatCurrency,
  formatDateShort,
  formatNumber,
  formatRelativeTime,
  getProductImageSrc,
  ORDER_STATUS_META,
} from '../utils/formatters';
import {
  buildCurrencyConfig,
  resolveReportingAmount,
  resolveTransactionCurrency,
} from '../utils/currency';
import { useI18n } from '../i18n/I18nContext';
import { SalesAnalyticsChart } from './SalesAnalyticsChart';

interface DashboardViewProps {
  metrics: DashboardMetrics;
  orders: Order[];
  activities: BusinessActivity[];
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  dateRange: DateRangeFilter;
  onDateRangeChange: (range: DateRangeFilter) => void;
  searchQuery: string;
  onNavigate: (section: NavSection) => void;
  onSelectOrder: (order: Order) => void;
  onOpenNewOrder: () => void;
  onOpenNewProduct: () => void;
  onOpenNewExpense: () => void;
  isCloudEmpty?: boolean;
  onSeedCloudSample?: () => void;
  isSeeding?: boolean;
}

function renderOrderStatusIcon(status: OrderStatus) {
  switch (status) {
    case 'delivered':
      return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
    case 'shipped':
      return <Truck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
    case 'processing':
      return <Loader2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
    case 'cancelled':
      return <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
    case 'returned':
      return <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
    default:
      return <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
  }
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  metrics,
  orders,
  activities,
  currency,
  currencyConfig,
  dateRange,
  onDateRangeChange,
  searchQuery,
  onNavigate,
  onSelectOrder,
  onOpenNewOrder,
  onOpenNewProduct,
  onOpenNewExpense,
  isCloudEmpty,
  onSeedCloudSample,
  isSeeding,
}) => {
  const { language, t, tOrderStatus, tChannel } = useI18n();
  const effectiveConfig =
    currencyConfig ?? buildCurrencyConfig({ currency, language });
  const reportingCurrency = effectiveConfig.reportingCurrency;
  const q = searchQuery.trim().toLowerCase();

  const filteredOrders = orders
    .filter((o) => {
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.itemsSummary.toLowerCase().includes(q)
      );
    })
    .slice(0, 6);

  const filteredTopProducts = metrics.topProducts
    .filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    })
    .slice(0, 5);

  const filteredActivities = activities
    .filter((a) => {
      if (!q) return true;
      return a.title.toLowerCase().includes(q) || a.detail.toLowerCase().includes(q);
    })
    .slice(0, 6);

  const kpiCards = [
    {
      label: t('kpiTotalRevenue'),
      value: formatCurrency(metrics.totalRevenue, reportingCurrency, 2, language),
      detail: t('kpiTotalRevenueDetail', { count: formatNumber(metrics.totalOrders, language) }),
      accentClass: 'text-blue-600 dark:text-blue-400',
      positive: true,
    },
    {
      label: t('kpiNetProfit'),
      value: formatCurrency(metrics.netProfit, reportingCurrency, 2, language),
      detail: t('kpiNetProfitDetail', { pct: metrics.profitMarginPct.toFixed(1) }),
      accentClass:
        metrics.netProfit >= 0
          ? 'text-cyan-600 dark:text-cyan-400'
          : 'text-rose-600 dark:text-rose-400',
      positive: metrics.netProfit >= 0,
    },
    {
      label: t('kpiTotalOrders'),
      value: formatNumber(metrics.totalOrders, language),
      detail:
        metrics.cancelledOrders > 0
          ? t('kpiTotalOrdersCancelled', { count: metrics.cancelledOrders })
          : t('kpiTotalOrdersActive'),
      accentClass: 'text-indigo-600 dark:text-indigo-400',
      positive: true,
    },
    {
      label: t('kpiTotalExpenses'),
      value: formatCurrency(metrics.totalExpenses, reportingCurrency, 2, language),
      detail: t('kpiTotalExpensesDetail', {
        cogs: formatCurrency(metrics.totalCogs, reportingCurrency, 2, language),
      }),
      accentClass: 'text-purple-600 dark:text-purple-400',
      positive: false,
    },
    {
      label: t('kpiAov'),
      value: formatCurrency(metrics.averageOrderValue, reportingCurrency, 2, language),
      detail: t('kpiAovDetail', { count: metrics.lowStockCount + metrics.outOfStockCount }),
      accentClass: 'text-slate-900 dark:text-slate-100',
      positive: true,
    },
  ];

  const dateRanges: Array<{ id: DateRangeFilter; label: string }> = [
    { id: '7d', label: t('range7d') },
    { id: '30d', label: t('range30d') },
    { id: '90d', label: t('range90d') },
    { id: 'all', label: t('rangeAll') },
  ];

  return (
    <div className="space-y-6">
      {/* Header action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
            {t('execOverview')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('execSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Range Segmented Filter */}
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#0D162E] border border-slate-200 dark:border-slate-800/80"
            role="group"
            aria-label="Date range filter"
          >
            {dateRanges.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onDateRangeChange(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  dateRange === opt.id
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenNewOrder}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('newOrderBtn')}
          </button>
        </div>
      </div>

      {/* Incompatible currency exclusion notice */}
      {(metrics.unconvertedCount ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          {t('unconvertedBanner', { count: metrics.unconvertedCount ?? 0 })}
        </div>
      )}

      {/* Empty Cloud Tenant Onboarding Banner */}
      {isCloudEmpty && onSeedCloudSample && (
        <div className="rounded-2xl border border-blue-500/30 bg-blue-50/70 dark:bg-blue-950/30 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('emptyCloudTitle')}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
              {t('emptyCloudDesc')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenNewProduct}
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              {t('addFirstProduct')}
            </button>
            <button
              type="button"
              disabled={isSeeding}
              onClick={onSeedCloudSample}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              {isSeeding ? t('loadingSampleData') : t('loadSampleData')}
            </button>
          </div>
        </div>
      )}

      {/* 5 Core KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 transition-colors hover:border-blue-500/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {kpi.label}
              </span>
              {kpi.positive ? (
                <ArrowUpRight className={`w-4 h-4 ${kpi.accentClass}`} aria-hidden="true" />
              ) : (
                <ArrowDownRight className={`w-4 h-4 ${kpi.accentClass}`} aria-hidden="true" />
              )}
            </div>
            <div className={`mt-2.5 text-2xl font-bold font-mono tabular-nums tracking-tight ${kpi.accentClass}`}>
              {kpi.value}
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              {kpi.detail}
            </p>
          </div>
        ))}
      </div>

      {/* Main Analytics Chart + Business Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <SalesAnalyticsChart data={metrics.salesSeries} currency={reportingCurrency} />
        </div>

        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('businessActivityTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('businessActivitySubtitle')}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenNewExpense}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:border-purple-500/40 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t('addExpenseShort')}
              </button>
            </div>
          </div>

          {filteredActivities.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              {t('noActivities')}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70 flex-1">
              {filteredActivities.map((act) => (
                <div key={act.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-600 dark:text-cyan-400 shrink-0">
                      {act.type === 'order' ? (
                        <ShoppingBag className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : act.type === 'expense' ? (
                        <Receipt className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" aria-hidden="true" />
                      ) : (
                        <Package className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {act.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {act.detail}
                      </p>
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    {act.amount !== 0 && (
                      <div
                        className={`text-xs font-mono tabular-nums font-semibold ${
                          act.amount > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-purple-600 dark:text-purple-400'
                        }`}
                      >
                        {act.amount > 0 ? '+' : ''}
                        {formatCurrency(act.amount, reportingCurrency, 2, language)}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono tabular-nums mt-0.5">
                      {formatRelativeTime(act.createdAt, language)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent Orders & Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Recent Orders */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('recentOrdersTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('recentOrdersSubtitle')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('viewAllOrders')}
            </button>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="flex-1 py-10 flex flex-col items-center justify-center text-center gap-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('noMatchingOrders')}
              </p>
              <button
                type="button"
                onClick={onOpenNewOrder}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
              >
                {t('createFirstOrder')}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-start border-collapse min-w-[520px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="pb-2.5 pe-3">{t('colOrder')}</th>
                    <th className="pb-2.5 pe-3">{t('colCustomer')}</th>
                    <th className="pb-2.5 pe-3">{t('colDate')}</th>
                    <th className="pb-2.5 pe-3">{t('colStatus')}</th>
                    <th className="pb-2.5 text-end">{t('colTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {filteredOrders.map((order) => {
                    const statusMeta = ORDER_STATUS_META[order.status];
                    const ordCurrency = resolveTransactionCurrency(
                      order.currency,
                      effectiveConfig
                    );
                    const converted =
                      ordCurrency !== reportingCurrency
                        ? resolveReportingAmount({
                            amount: order.totalAmount,
                            recordCurrency: order.currency,
                            recordedExchangeRate: order.exchangeRate,
                            recordedConvertedAmount: order.convertedAmount,
                            recordedReportingCurrency: order.reportingCurrency,
                            config: effectiveConfig,
                          })
                        : null;
                    return (
                      <tr
                        key={order.id}
                        onClick={() => onSelectOrder(order)}
                        className="group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 pe-3 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-500 transition-colors">
                          {order.orderNumber}
                        </td>
                        <td className="py-3 pe-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[160px]">
                            {order.customerName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                            {tChannel(order.channel)} ·{' '}
                            {t('itemsCountLabel', { count: order.itemCount })}
                          </div>
                        </td>
                        <td className="py-3 pe-3 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatDateShort(order.orderDate, language)}
                        </td>
                        <td className="py-3 pe-3">
                          <span className={`inline-flex items-center gap-1.5 font-medium ${statusMeta.textClass}`}>
                            {renderOrderStatusIcon(order.status)}
                            {tOrderStatus(order.status)}
                          </span>
                        </td>
                        <td className="py-3 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          <div>{formatCurrency(order.totalAmount, ordCurrency, 2, language)}</div>
                          {converted?.ok && (
                            <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                              {t('approxConverted', {
                                value: formatCurrency(converted.amount, reportingCurrency, 2, language),
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Products */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('topProductsTitle')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('topProductsSubtitle')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('manageCatalog')}
            </button>
          </div>

          {filteredTopProducts.length === 0 ? (
            <div className="flex-1 py-10 flex flex-col items-center justify-center text-center gap-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('noProductsYet')}
              </p>
              <button
                type="button"
                onClick={onOpenNewProduct}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
              >
                {t('addFirstProduct')}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60 flex-1">
              {filteredTopProducts.map((prod) => {
                const imgSrc = getProductImageSrc(prod.imageKey);
                return (
                  <div
                    key={prod.productId}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center shrink-0">
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {prod.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono tabular-nums">
                          {t('topProductStatLine', {
                            sold: prod.unitsSold,
                            margin: prod.marginPct,
                            stock: prod.stock,
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-xs font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(prod.revenue, reportingCurrency, 2, language)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-cyan-600 dark:text-cyan-400 mt-0.5">
                        +{formatCurrency(prod.grossProfit, reportingCurrency, 2, language)} {t('gpShort')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
