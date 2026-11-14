import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CurrencyCode,
  CurrencyConfig,
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  FinancialGranularity,
  FinancialOrderScope,
  Order,
  Product,
} from '../types/zenorati';
import { computeFinanceAnalytics } from '../utils/analytics';
import {
  createSafeId,
  formatCurrency,
  formatDateShort,
  formatNumber,
  getProductImageSrc,
  getTodayIsoDate,
} from '../utils/formatters';
import {
  buildCurrencyConfig,
  convertCurrencyAmount,
  formatConversionDirection,
  getCurrencyLabel,
  resolveReportingAmount,
  resolveTransactionCurrency,
  SUPPORTED_CURRENCIES,
} from '../utils/currency';
import { useI18n } from '../i18n/I18nContext';
import { SalesAnalyticsChart } from './SalesAnalyticsChart';

interface FinanceViewProps {
  orders: Order[];
  products: Product[];
  expenses: Expense[];
  ownerId: string;
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  globalSearch: string;
  onSaveExpense: (expense: Expense, isNew: boolean) => Promise<void>;
  onDeleteExpense: (expense: Expense) => Promise<void>;
  isCreateModalOpen: boolean;
  onOpenCreateModal: () => void;
  onCloseCreateModal: () => void;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Marketing',
  'Shipping',
  'Packaging',
  'Software',
  'Operations',
  'Other',
  'Inventory',
  'Payroll',
];

function escapeCsvCell(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerClientCsvFallback(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const FinanceView: React.FC<FinanceViewProps> = ({
  orders,
  products,
  expenses,
  ownerId,
  currency,
  currencyConfig,
  globalSearch,
  onSaveExpense,
  onDeleteExpense,
  isCreateModalOpen,
  onOpenCreateModal,
  onCloseCreateModal,
}) => {
  const { language, t, tExpenseCategory, tExpenseStatus } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;
  const defaultExpenseCurrency: CurrencyCode =
    reportingCurrency === 'EGP' || reportingCurrency === 'USD'
      ? reportingCurrency
      : 'USD';

  const [orderScope, setOrderScope] = useState<FinancialOrderScope>('all_active');
  const [granularity, setGranularity] = useState<FinancialGranularity>('monthly');

  const [localSearch, setLocalSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseStatus>('all');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [formState, setFormState] = useState<{
    title: string;
    category: ExpenseCategory;
    vendor: string;
    amount: string;
    currency: CurrencyCode;
    expenseDate: string;
    status: ExpenseStatus;
    notes: string;
  }>({
    title: '',
    category: 'Marketing',
    vendor: '',
    amount: '',
    currency: defaultExpenseCurrency,
    expenseDate: getTodayIsoDate(),
    status: 'paid',
    notes: '',
  });

  const financeData = useMemo(
    () =>
      computeFinanceAnalytics(
        orders,
        products,
        expenses,
        granularity,
        orderScope,
        effectiveConfig
      ),
    [orders, products, expenses, granularity, orderScope, effectiveConfig]
  );

  React.useEffect(() => {
    if (isCreateModalOpen && !editingExpense) {
      setFormState({
        title: '',
        category: 'Marketing',
        vendor: '',
        amount: '',
        currency: defaultExpenseCurrency,
        expenseDate: getTodayIsoDate(),
        status: 'paid',
        notes: '',
      });
      setFormError(null);
    }
  }, [isCreateModalOpen, editingExpense, defaultExpenseCurrency]);

  const openForEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setFormState({
      title: exp.title,
      category: exp.category,
      vendor: exp.vendor === 'General' ? '' : exp.vendor,
      amount: String(exp.amount),
      currency: resolveTransactionCurrency(exp.currency, effectiveConfig),
      expenseDate: exp.expenseDate,
      status: exp.status,
      notes: exp.notes,
    });
    setFormError(null);
  };

  const closeModal = () => {
    setEditingExpense(null);
    setFormError(null);
    onCloseCreateModal();
  };

  const modalVisible = isCreateModalOpen || editingExpense !== null;

  const queryText = (localSearch || globalSearch).trim().toLowerCase();

  const filteredExpenses = useMemo(() => {
    return expenses
      .filter((exp) => {
        if (categoryFilter !== 'all' && exp.category !== categoryFilter) return false;
        if (statusFilter !== 'all' && exp.status !== statusFilter) return false;
        if (!queryText) return true;
        return (
          exp.title.toLowerCase().includes(queryText) ||
          exp.vendor.toLowerCase().includes(queryText) ||
          exp.category.toLowerCase().includes(queryText) ||
          exp.notes.toLowerCase().includes(queryText)
        );
      })
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  }, [expenses, categoryFilter, statusFilter, queryText]);

  const { filteredExpenseTotal, expenseUnconvertedCount } = useMemo(() => {
    let total = 0;
    let unconverted = 0;
    for (const e of filteredExpenses) {
      const res = resolveReportingAmount({
        amount: Math.max(0, Number(e.amount) || 0),
        recordCurrency: e.currency,
        recordedExchangeRate: e.exchangeRate,
        recordedConvertedAmount: e.convertedAmount,
        recordedReportingCurrency: e.reportingCurrency,
        config: effectiveConfig,
      });
      if (res.ok) {
        total += res.amount;
      } else {
        unconverted += 1;
      }
    }
    return {
      filteredExpenseTotal: Number(total.toFixed(2)),
      expenseUnconvertedCount: unconverted,
    };
  }, [filteredExpenses, effectiveConfig]);

  const totalUnconvertedCount = Math.max(
    financeData.unconvertedCount ?? 0,
    expenseUnconvertedCount
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = formState.title.trim();
    const vendor = formState.vendor.trim() || 'General';
    const amount = Number(formState.amount);

    if (!title) {
      setFormError(t('errExpenseNameReq'));
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setFormError(t('errExpenseAmountMin'));
      return;
    }

    const cleanAmount = Number(amount.toFixed(2));
    const conv = convertCurrencyAmount(
      cleanAmount,
      formState.currency,
      reportingCurrency,
      effectiveConfig.usdToEgpRate
    );

    if (!conv.ok) {
      setFormError(t('exchangeRateError'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const nowIso = new Date().toISOString();
      const isNew = editingExpense === null;
      const payload: Expense = {
        id: isNew ? createSafeId('exp') : editingExpense.id,
        ownerId,
        title: title.slice(0, 120),
        category: formState.category,
        vendor: vendor.slice(0, 100),
        amount: cleanAmount,
        currency: formState.currency,
        exchangeRate: conv.exchangeRate,
        convertedAmount: conv.amount,
        reportingCurrency,
        conversionDirection: formatConversionDirection(formState.currency, reportingCurrency),
        rateTimestamp: nowIso,
        ...(effectiveConfig.rateSource ? { rateSource: effectiveConfig.rateSource } : {}),
        ...(effectiveConfig.cbePublicationDate
          ? { ratePublicationDate: effectiveConfig.cbePublicationDate }
          : {}),
        expenseDate: formState.expenseDate || getTodayIsoDate(),
        status: formState.status,
        notes: formState.notes.trim().slice(0, 400),
        createdAt: editingExpense?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      await onSaveExpense(payload, isNew);
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('errExpenseNameReq'));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async (exp: Expense) => {
    setDeletingId(exp.id);
    try {
      await onDeleteExpense(exp);
      setConfirmDeleteId(null);
    } catch (err) {
      setExportFeedback(err instanceof Error ? err.message : 'Unable to delete expense.');
    } finally {
      setDeletingId(null);
    }
  };

  const exportCsvReport = async (mode: 'summary' | 'expenses') => {
    setExportFeedback(null);

    const rows: Array<Record<string, unknown>> =
      mode === 'summary'
        ? financeData.periodSummaries.map((p) => ({
            Period: p.label,
            PeriodKey: p.periodKey,
            Granularity: granularity,
            OrderScope: orderScope === 'delivered' ? 'Delivered Only' : 'All Active Orders',
            Orders: p.ordersCount,
            Revenue: p.revenue.toFixed(2),
            ProductCosts: p.productCosts.toFixed(2),
            OrderShippingCosts: p.shippingCosts.toFixed(2),
            AdditionalExpenses: p.additionalExpenses.toFixed(2),
            NetProfit: p.netProfit.toFixed(2),
            MarginPct: p.marginPct.toFixed(1),
            Currency: reportingCurrency,
          }))
        : filteredExpenses.map((e) => {
            const origCurr = resolveTransactionCurrency(e.currency, effectiveConfig);
            const res = resolveReportingAmount({
              amount: e.amount,
              recordCurrency: e.currency,
              recordedExchangeRate: e.exchangeRate,
              recordedConvertedAmount: e.convertedAmount,
              recordedReportingCurrency: e.reportingCurrency,
              config: effectiveConfig,
            });
            return {
              Date: e.expenseDate,
              Name: e.title,
              Category: e.category,
              Vendor: e.vendor,
              Status: e.status,
              OriginalAmount: e.amount.toFixed(2),
              OriginalCurrency: origCurr,
              ExchangeRate:
                e.exchangeRate !== undefined
                  ? e.exchangeRate
                  : res.ok
                  ? res.multiplier
                  : '',
              ConvertedAmount: res.ok ? res.amount.toFixed(2) : '',
              ReportingCurrency: e.reportingCurrency || reportingCurrency,
              Notes: e.notes,
            };
          });

    if (rows.length === 0) {
      setExportFeedback(
        mode === 'summary' ? t('errNoPeriodsExport') : t('errNoExpensesExport')
      );
      return;
    }

    const filename =
      mode === 'summary'
        ? `zenorati-finance-${granularity}-${orderScope}.csv`
        : 'zenorati-expenses-ledger.csv';

    setExporting(true);
    try {
      const res = await fetch('/api/reports/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: mode === 'summary' ? `finance-${granularity}` : 'expenses',
          rows,
        }),
      });
      if (!res.ok) {
        triggerClientCsvFallback(filename, rows);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      triggerClientCsvFallback(filename, rows);
    } finally {
      setExporting(false);
    }
  };

  const expenseCurrencyOptions: CurrencyCode[] = SUPPORTED_CURRENCIES.includes(formState.currency)
    ? SUPPORTED_CURRENCIES
    : [...SUPPORTED_CURRENCIES, formState.currency];

  const granularityLabel = (g: FinancialGranularity) =>
    g === 'daily'
      ? t('granularityDaily')
      : g === 'weekly'
      ? t('granularityWeekly')
      : t('granularityMonthly');

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('financeTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('financeSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Order Scope Selector */}
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#0B1328] border border-slate-200 dark:border-slate-800"
            role="group"
            aria-label={t('allActiveOrdersScope')}
          >
            <button
              type="button"
              onClick={() => setOrderScope('all_active')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                orderScope === 'all_active'
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t('allActiveOrdersScope')}
            </button>
            <button
              type="button"
              onClick={() => setOrderScope('delivered')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                orderScope === 'delivered'
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t('deliveredOnlyScope', {
                count: formatNumber(financeData.deliveredOrderCount, language),
              })}
            </button>
          </div>

          {/* Period Granularity Switcher */}
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#0B1328] border border-slate-200 dark:border-slate-800"
            role="group"
            aria-label={t('granularityMonthly')}
          >
            {(['daily', 'weekly', 'monthly'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  granularity === g
                    ? 'bg-white dark:bg-cyan-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {granularityLabel(g)}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={exporting}
            onClick={() => exportCsvReport('summary')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-700 dark:text-slate-200 hover:border-cyan-500/40 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {t('exportCsv')}
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingExpense(null);
              onOpenCreateModal();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('logExpense')}
          </button>
        </div>
      </div>

      {totalUnconvertedCount > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          {t('unconvertedBanner', { count: totalUnconvertedCount })}
        </div>
      )}

      {exportFeedback && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
          <span>{exportFeedback}</span>
          <button
            type="button"
            onClick={() => setExportFeedback(null)}
            className="font-semibold underline cursor-pointer"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Finance Dashboard: 7 Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('kpiTotalRevenue')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {formatCurrency(financeData.totalRevenue, reportingCurrency, 2, language)}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {orderScope === 'delivered'
              ? t('deliveredOrdersOnlyNote')
              : t('excludesCancelledReturnedNote')}
            {financeData.excludedOrderCount > 0 && (
              <span className="font-mono tabular-nums">
                {' '}
                {t('excludedCountNote', { count: financeData.excludedOrderCount })}
              </span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('kpiNetProfit')}
          </div>
          <div
            className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
              financeData.netProfit >= 0
                ? 'text-cyan-600 dark:text-cyan-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {formatCurrency(financeData.netProfit, reportingCurrency, 2, language)}
          </div>
          <div className="mt-1.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {t('netMarginPctNote', { pct: financeData.profitMarginPct.toFixed(1) })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('productCostsCogs')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatCurrency(financeData.productCosts, reportingCurrency, 2, language)}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {t('grossProfitLabel')}{' '}
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {formatCurrency(financeData.grossProfit, reportingCurrency, 2, language)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('additionalExpenses')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-purple-600 dark:text-purple-400">
            {formatCurrency(financeData.additionalExpenses, reportingCurrency, 2, language)}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {t('acrossLedgerEntries', { count: formatNumber(expenses.length, language) })}
          </div>
        </div>
      </div>

      {/* Secondary Finance Metrics: Shipping, Order Count, Average Order Value */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('orderShippingCosts')}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('billedOnOrdersCarrier')}{' '}
              <span className="font-mono tabular-nums">
                {formatCurrency(
                  financeData.shippingExpensesInLedger,
                  reportingCurrency,
                  2,
                  language
                )}
              </span>
            </div>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white shrink-0">
            {formatCurrency(financeData.orderShippingCosts, reportingCurrency, 2, language)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('ordersCounted')}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('deliveredTotalNote', {
                count: formatNumber(financeData.deliveredOrderCount, language),
              })}
            </div>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white shrink-0">
            {formatNumber(financeData.orderCount, language)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('kpiAov')}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('ordersCounted')}
            </div>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400 shrink-0">
            {formatCurrency(financeData.averageOrderValue, reportingCurrency, 2, language)}
          </div>
        </div>
      </div>

      {/* Revenue vs Expenses & Net Profit Chart + P&L Statement */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex flex-col">
          <SalesAnalyticsChart data={financeData.chartSeries} currency={reportingCurrency} />
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t('pnlBreakdownTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('pnlBreakdownSubtitle')}
            </p>
          </div>

          <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">
                {t('netMerchandiseSubtotal')}
              </span>
              <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {formatCurrency(financeData.orderSubtotalNet, reportingCurrency, 2, language)}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">
                {t('orderShippingPlusTax')}
              </span>
              <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {formatCurrency(
                  financeData.orderShippingCosts + financeData.orderTaxTotal,
                  reportingCurrency,
                  2,
                  language
                )}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between font-semibold">
              <span className="text-slate-900 dark:text-slate-100">{t('totalOrderRevenue')}</span>
              <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                {formatCurrency(financeData.totalRevenue, reportingCurrency, 2, language)}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">{t('productCostsCogs')}</span>
              <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                −{formatCurrency(financeData.productCosts, reportingCurrency, 2, language)}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between font-medium">
              <span className="text-slate-900 dark:text-slate-100">{t('grossProfitLabel')}</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(financeData.grossProfit, reportingCurrency, 2, language)}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">{t('additionalExpenses')}</span>
              <span className="font-mono tabular-nums text-purple-600 dark:text-purple-400">
                −{formatCurrency(financeData.additionalExpenses, reportingCurrency, 2, language)}
              </span>
            </div>
            <div className="pt-3 flex items-center justify-between text-sm font-bold">
              <span className="text-slate-900 dark:text-white">
                {t('kpiNetProfit')} ({financeData.profitMarginPct.toFixed(1)}%)
              </span>
              <span
                className={`font-mono tabular-nums ${
                  financeData.netProfit >= 0
                    ? 'text-cyan-600 dark:text-cyan-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatCurrency(financeData.netProfit, reportingCurrency, 2, language)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Category Spend + Financial Period Summary Report */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t('expenseAllocationTitle')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-4">
            {t('operatingSpendByCategory')}
          </p>

          {financeData.expensesByCategory.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              {t('noAdditionalExpenses')}
            </div>
          ) : (
            <div className="space-y-3.5">
              {financeData.expensesByCategory.map((row) => (
                <div key={row.category} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {tExpenseCategory(row.category)}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatCurrency(row.amount, reportingCurrency, 2, language)} ·{' '}
                      {row.sharePct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(4, row.sharePct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Daily / Weekly / Monthly Financial Summary Table */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {granularity === 'daily'
                  ? t('dailySummaryTitle')
                  : granularity === 'weekly'
                  ? t('weeklySummaryTitle')
                  : t('monthlySummaryTitle')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('periodSummarySubtitle')}
              </p>
            </div>
            <button
              type="button"
              disabled={exporting}
              onClick={() => exportCsvReport('summary')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-blue-500/40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {t('summaryCsvBtn')}
            </button>
          </div>

          {financeData.periodSummaries.length === 0 ? (
            <div className="py-12 px-5 text-center text-xs text-slate-500 dark:text-slate-400">
              {t('noPeriodSummaryData')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start border-collapse min-w-[680px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                    <th className="py-3 px-4">{t('colPeriod')}</th>
                    <th className="py-3 px-4 text-end">{t('colOrders')}</th>
                    <th className="py-3 px-4 text-end">{t('colRevenue')}</th>
                    <th className="py-3 px-4 text-end">{t('colCogs')}</th>
                    <th className="py-3 px-4 text-end">{t('colOrderShip')}</th>
                    <th className="py-3 px-4 text-end">{t('colExpenses')}</th>
                    <th className="py-3 px-4 text-end">{t('colNetProfit')}</th>
                    <th className="py-3 px-4 text-end">{t('colMargin')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {financeData.periodSummaries.map((row) => (
                    <tr
                      key={row.periodKey}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {row.label}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatNumber(row.ordersCount, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                        {formatCurrency(row.revenue, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrency(row.productCosts, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatCurrency(row.shippingCosts, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-purple-600 dark:text-purple-400">
                        {formatCurrency(row.additionalExpenses, reportingCurrency, 2, language)}
                      </td>
                      <td
                        className={`py-3 px-4 text-end font-mono tabular-nums font-semibold ${
                          row.netProfit >= 0
                            ? 'text-cyan-600 dark:text-cyan-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(row.netProfit, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {row.marginPct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Best-Selling Products Financial Report */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t('bestSellingTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('bestSellingSubtitle')}
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {t('activeSkusSold', {
              count: formatNumber(financeData.bestSellingProducts.length, language),
            })}
          </span>
        </div>

        {financeData.bestSellingProducts.length === 0 ? (
          <div className="py-10 px-5 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('noProductSalesScope')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse min-w-[620px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                  <th className="py-3 px-4">{t('colProduct')}</th>
                  <th className="py-3 px-4">{t('colSku')}</th>
                  <th className="py-3 px-4 text-end">{t('colUnitsSold')}</th>
                  <th className="py-3 px-4 text-end">{t('colProductRevenue')}</th>
                  <th className="py-3 px-4 text-end">{t('colGrossProfit')}</th>
                  <th className="py-3 px-4 text-end">{t('colGrossMargin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {financeData.bestSellingProducts.map((item) => {
                  const imgSrc = getProductImageSrc(item.imageKey);
                  return (
                    <tr
                      key={item.productId}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={item.name}
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-800 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[240px]">
                              {item.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {item.category}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {item.sku}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {formatNumber(item.unitsSold, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                        {formatCurrency(item.revenue, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                        {formatCurrency(item.grossProfit, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {item.marginPct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expense Filter Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('searchExpensesPlaceholder')}
            className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800">
            {(['all', 'paid', 'pending'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {st === 'all' ? t('all') : tExpenseStatus(st)}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | ExpenseCategory)}
            aria-label={t('categoryLabel')}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-700 dark:text-slate-200"
          >
            <option value="all">{t('allCategories')}</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tExpenseCategory(c)}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={exporting || filteredExpenses.length === 0}
            onClick={() => exportCsvReport('expenses')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-purple-500/40 disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {t('ledgerCsvBtn')}
          </button>
        </div>
      </div>

      {/* Expense Ledger Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('expenseLedgerTitle')}
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {t('shownCountLabel', { count: formatNumber(filteredExpenses.length, language) })} ·{' '}
            <span className="text-purple-600 dark:text-purple-400 font-semibold">
              {formatCurrency(filteredExpenseTotal, reportingCurrency, 2, language)}
            </span>
          </span>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <Receipt className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t('noExpensesMatch')}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingExpense(null);
                onOpenCreateModal();
              }}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
            >
              {t('logExpense')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse min-w-[740px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                  <th className="py-3 px-4">{t('colExpense')}</th>
                  <th className="py-3 px-4">{t('colVendor')}</th>
                  <th className="py-3 px-4">{t('colCategory')}</th>
                  <th className="py-3 px-4">{t('colDate')}</th>
                  <th className="py-3 px-4">{t('colStatus')}</th>
                  <th className="py-3 px-4 text-end">{t('colAmount')}</th>
                  <th className="py-3 px-4 text-end">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {filteredExpenses.map((exp) => {
                  const expCurrency = resolveTransactionCurrency(exp.currency, effectiveConfig);
                  const converted =
                    expCurrency !== reportingCurrency
                      ? resolveReportingAmount({
                          amount: exp.amount,
                          recordCurrency: exp.currency,
                          recordedExchangeRate: exp.exchangeRate,
                          recordedConvertedAmount: exp.convertedAmount,
                          recordedReportingCurrency: exp.reportingCurrency,
                          config: effectiveConfig,
                        })
                      : null;

                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {exp.title}
                        </div>
                        {exp.notes && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                            {exp.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        {exp.vendor}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {tExpenseCategory(exp.category)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatDateShort(exp.expenseDate, language)}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() =>
                            onSaveExpense(
                              {
                                ...exp,
                                status: exp.status === 'paid' ? 'pending' : 'paid',
                                updatedAt: new Date().toISOString(),
                              },
                              false
                            )
                          }
                          className={`inline-flex items-center gap-1.5 font-medium cursor-pointer ${
                            exp.status === 'paid'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {exp.status === 'paid' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>{tExpenseStatus(exp.status)}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-purple-600 dark:text-purple-400">
                        <div>{formatCurrency(exp.amount, expCurrency, 2, language)}</div>
                        {converted && converted.ok && (
                          <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                            {t('approxConverted', {
                              value: formatCurrency(
                                converted.amount,
                                reportingCurrency,
                                2,
                                language
                              ),
                            })}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-end">
                        {confirmDeleteId === exp.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={deletingId === exp.id}
                              onClick={() => handleConfirmDelete(exp)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                            >
                              {deletingId === exp.id ? t('deleting') : t('confirm')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openForEdit(exp)}
                              aria-label={`${t('edit')} ${exp.title}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(exp.id)}
                              aria-label={`${t('delete')} ${exp.title}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
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

      {/* Add / Edit Expense Modal */}
      {modalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {editingExpense ? t('editExpenseTitle') : t('logExpenseTitle')}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label={t('close')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('expenseNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.title}
                    onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                    placeholder={t('expenseNamePlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('categoryLabel')}
                  </label>
                  <select
                    value={formState.category}
                    onChange={(e) =>
                      setFormState({ ...formState, category: e.target.value as ExpenseCategory })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {tExpenseCategory(c)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('vendorOptionalLabel')}
                  </label>
                  <input
                    type="text"
                    value={formState.vendor}
                    onChange={(e) => setFormState({ ...formState, vendor: e.target.value })}
                    placeholder={t('vendorPlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('expenseCurrencyLabel')}
                  </label>
                  <select
                    value={formState.currency}
                    onChange={(e) =>
                      setFormState({ ...formState, currency: e.target.value as CurrencyCode })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  >
                    {expenseCurrencyOptions.map((code) => (
                      <option key={code} value={code}>
                        {getCurrencyLabel(code, language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('expenseAmountLabel', { curr: formState.currency })}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={formState.amount}
                    onChange={(e) => setFormState({ ...formState, amount: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('expenseDateLabel')}
                  </label>
                  <input
                    type="date"
                    required
                    value={formState.expenseDate}
                    onChange={(e) => setFormState({ ...formState, expenseDate: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('paymentStatusLabel')}
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as ExpenseStatus })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  >
                    <option value="paid">{tExpenseStatus('paid')}</option>
                    <option value="pending">{tExpenseStatus('pending')}</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('notesOptionalLabel')}
                  </label>
                  <textarea
                    rows={2}
                    value={formState.notes}
                    onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                    placeholder={t('notesExpensePlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                >
                  {saving
                    ? t('saving')
                    : editingExpense
                    ? t('saveChanges')
                    : t('saveExpenseBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
