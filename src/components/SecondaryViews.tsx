import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Calculator,
  CheckCircle2,
  Clock,
  Database,
  Download,
  ExternalLink,
  Lightbulb,
  LogIn,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sliders,
  Sun,
  Trash2,
  Wifi,
  Workflow,
  Megaphone,
  Store,
} from 'lucide-react';
import type {
  AppLanguage,
  CbeRateSyncStatus,
  CbeSyncState,
  CurrencyCode,
  CurrencyConfig,
  DashboardMetrics,
  ExchangeRateMode,
  Expense,
  Order,
  Product,
  ProductIdea,
  TenantProfile,
} from '../types/zenorati';
import { createSafeId, formatCurrency, formatDateShort, formatNumber } from '../utils/formatters';
import {
  buildCurrencyConfig,
  DEFAULT_USD_TO_EGP_RATE,
  getCurrencyLabel,
  getEffectiveUsdToEgpRate,
  isValidExchangeRate,
  OFFICIAL_CBE_SOURCE,
  resolveReportingAmount,
  resolveTransactionCurrency,
  SUPPORTED_CURRENCIES,
} from '../utils/currency';
import { useI18n } from '../i18n/I18nContext';

interface ProductResearchViewProps {
  ideas: ProductIdea[];
  ownerId: string;
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  onSaveIdea: (idea: ProductIdea, isNew: boolean) => Promise<void>;
  onDeleteIdea: (ideaId: string) => Promise<void>;
}

export const ProductResearchView: React.FC<ProductResearchViewProps> = ({
  ideas,
  ownerId,
  currency,
  currencyConfig,
  onSaveIdea,
  onDeleteIdea,
}) => {
  const { language, t } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;
  const defaultIdeaCurrency: CurrencyCode =
    reportingCurrency === 'EGP' || reportingCurrency === 'USD'
      ? reportingCurrency
      : 'USD';

  const [name, setName] = useState('');
  const [ideaCurrency, setIdeaCurrency] = useState<CurrencyCode>(defaultIdeaCurrency);
  const [targetPrice, setTargetPrice] = useState('120');
  const [estimatedCost, setEstimatedCost] = useState('35');
  const [shippingEstimate, setShippingEstimate] = useState('9');
  const [adCpaEstimate, setAdCpaEstimate] = useState('22');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const p = Number(targetPrice) || 0;
  const c = Number(estimatedCost) || 0;
  const s = Number(shippingEstimate) || 0;
  const a = Number(adCpaEstimate) || 0;
  const netUnitProfit = p - c - s - a;
  const marginPct = p > 0 ? (netUnitProfit / p) * 100 : 0;
  const breakEvenRoas = p - c - s > 0 ? p / (p - c - s) : 0;

  const handleAddIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSaveIdea(
        {
          id: createSafeId('idea'),
          ownerId,
          name: name.trim().slice(0, 120),
          currency: ideaCurrency,
          targetPrice: p,
          estimatedCost: c,
          shippingEstimate: s,
          adCpaEstimate: a,
          notes: notes.trim().slice(0, 500),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        true
      );
      setName('');
      setNotes('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('researchTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('researchSubtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <form
          onSubmit={handleAddIdea}
          className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Calculator className="w-4 h-4 text-blue-500" aria-hidden="true" />
              {t('simulatorTitle')}
            </div>
            <select
              aria-label={t('currency')}
              value={ideaCurrency}
              onChange={(e) => setIdeaCurrency(e.target.value as CurrencyCode)}
              className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('candidateNameLabel')}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('productNamePlaceholder')}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('targetPriceLabel', { curr: ideaCurrency })}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('landedCostLabel', { curr: ideaCurrency })}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('shippingPickPackLabel')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={shippingEstimate}
                onChange={(e) => setShippingEstimate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('estAdCpaLabel', { curr: ideaCurrency })}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={adCpaEstimate}
                onChange={(e) => setAdCpaEstimate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('sourcingNotesLabel')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 resize-none"
            />
          </div>

          <div className="rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 p-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">
                {t('netProfitUnitLabel')}
              </span>
              <span
                className={`font-mono tabular-nums font-semibold ${
                  netUnitProfit >= 0
                    ? 'text-cyan-600 dark:text-cyan-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatCurrency(netUnitProfit, ideaCurrency, 2, language)} ({marginPct.toFixed(1)}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">{t('breakEvenRoasLabel')}</span>
              <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                {breakEvenRoas > 0 ? `${breakEvenRoas.toFixed(2)}x` : 'N/A'}
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {saving ? t('saving') : t('saveCandidateSku')}
          </button>
        </form>

        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
            {t('savedCandidateProducts', { count: formatNumber(ideas.length, language) })}
          </h2>
          {ideas.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <Lightbulb className="w-7 h-7 mx-auto text-slate-400" aria-hidden="true" />
              <p>{t('researchEmptyHint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {ideas.map((idea) => {
                const itemCurrency = resolveTransactionCurrency(idea.currency, effectiveConfig);
                const net =
                  idea.targetPrice -
                  idea.estimatedCost -
                  idea.shippingEstimate -
                  idea.adCpaEstimate;
                const margin = idea.targetPrice > 0 ? (net / idea.targetPrice) * 100 : 0;
                return (
                  <div
                    key={idea.id}
                    className="py-3.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {idea.name}
                      </div>
                      <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                        {t('ideaLineSummary', {
                          price: formatCurrency(idea.targetPrice, itemCurrency, 2, language),
                          cost: formatCurrency(idea.estimatedCost, itemCurrency, 2, language),
                          ship: formatCurrency(idea.shippingEstimate, itemCurrency, 2, language),
                          cpa: formatCurrency(idea.adCpaEstimate, itemCurrency, 2, language),
                        })}
                      </div>
                      {idea.notes && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {idea.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-end">
                        <div
                          className={`text-xs font-mono tabular-nums font-semibold ${
                            net >= 0
                              ? 'text-cyan-600 dark:text-cyan-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatCurrency(net, itemCurrency, 2, language)}
                          {t('unitSuffix')}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {t('netPctSuffix', { pct: margin.toFixed(1) })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteIdea(idea.id)}
                        aria-label={`${t('delete')} ${idea.name}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
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

interface AiAssistantViewProps {
  profile: TenantProfile;
  metrics: DashboardMetrics;
  products: Product[];
}

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  profile,
  metrics,
  products,
}) => {
  const { language, t } = useI18n();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant' | 'error'; text: string }>>([]);
  const [loading, setLoading] = useState(false);

  const ask = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || loading) return;
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setQuestion('');
    setLoading(true);

    try {
      const lowStockProducts = products
        .filter((p) => p.stock <= profile.lowStockThreshold)
        .map((p) => ({ name: p.name, sku: p.sku, stock: p.stock }));

      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          businessName: profile.businessName,
          currency: profile.currency,
          language,
          metrics: {
            totalRevenue: metrics.totalRevenue,
            netProfit: metrics.netProfit,
            profitMarginPct: metrics.profitMarginPct,
            totalOrders: metrics.totalOrders,
            totalExpenses: metrics.totalExpenses,
            totalCogs: metrics.totalCogs,
            averageOrderValue: metrics.averageOrderValue,
          },
          topProducts: metrics.topProducts.slice(0, 6),
          lowStockProducts,
          expensesByCategory: metrics.expensesByCategory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', text: data.error || 'Unable to reach AI Analyst endpoint.' },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', text: data.answer }]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'error',
          text: err instanceof Error ? err.message : 'Network error calling AI Assistant.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [t('quickPrompt1'), t('quickPrompt2'), t('quickPrompt3')];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('assistantTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('assistantSubtitle', { name: profile.businessName })}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex flex-col min-h-[460px]">
        <div className="flex flex-wrap gap-2 pb-4 border-b border-slate-100 dark:border-slate-800/70">
          {quickPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => ask(p)}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex-1 py-4 space-y-4 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-2">
              <Bot className="w-8 h-8 text-blue-500" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {t('assistantEmptyTitle')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                {t('assistantEmptyDesc')}
              </p>
            </div>
          ) : (
            messages.map((m, idx) => (
              <div
                key={idx}
                className={`rounded-2xl p-4 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ms-auto max-w-xl bg-blue-600 text-white'
                    : m.role === 'error'
                    ? 'max-w-2xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'max-w-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-800 dark:text-slate-200'
                }`}
              >
                {m.text}
              </div>
            ))
          )}
          {loading && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t('assistantAnalyzing')}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="pt-3 border-t border-slate-100 dark:border-slate-800/70 flex items-center gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('assistantPlaceholder')}
            className="flex-1 px-4 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5 rtl:scale-x-[-1]" aria-hidden="true" />
            {t('analyzeBtn')}
          </button>
        </form>
      </div>
    </div>
  );
};

interface ReportsViewProps {
  metrics: DashboardMetrics;
  products: Product[];
  orders: Order[];
  expenses: Expense[];
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  metrics,
  products,
  orders,
  expenses,
  currency,
  currencyConfig,
}) => {
  const { language, t } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;

  const [exportError, setExportError] = useState<string | null>(null);

  const downloadCsv = async (type: 'orders' | 'products' | 'expenses' | 'pnl') => {
    setExportError(null);
    let rows: Array<Record<string, unknown>> = [];
    if (type === 'orders') {
      rows = orders.map((o) => {
        const origCurr = resolveTransactionCurrency(o.currency, effectiveConfig);
        const res = resolveReportingAmount({
          amount: o.totalAmount,
          recordCurrency: o.currency,
          recordedExchangeRate: o.exchangeRate,
          recordedConvertedAmount: o.convertedAmount,
          recordedReportingCurrency: o.reportingCurrency,
          config: effectiveConfig,
        });
        return {
          OrderNumber: o.orderNumber,
          Date: o.orderDate,
          Customer: o.customerName,
          Email: o.customerEmail,
          Phone: o.customerPhone || '',
          Channel: o.channel,
          Status: o.status,
          OriginalCurrency: origCurr,
          Subtotal: o.subtotal,
          Discount: o.discountAmount || 0,
          Tax: o.taxAmount,
          Shipping: o.shippingCost,
          TotalRevenue: o.totalAmount,
          COGS: o.totalCost,
          ExchangeRate:
            o.exchangeRate !== undefined ? o.exchangeRate : res.ok ? res.multiplier : '',
          ConvertedAmount: res.ok ? res.amount.toFixed(2) : '',
          ReportingCurrency: o.reportingCurrency || reportingCurrency,
          Items: o.itemsSummary,
        };
      });
    } else if (type === 'products') {
      rows = products.map((p) => ({
        SKU: p.sku,
        Name: p.name,
        Category: p.category,
        Status: p.status,
        Currency: resolveTransactionCurrency(p.currency, effectiveConfig),
        Price: p.price,
        Cost: p.cost,
        Stock: p.stock,
      }));
    } else if (type === 'expenses') {
      rows = expenses.map((e) => {
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
          Title: e.title,
          Category: e.category,
          Vendor: e.vendor,
          Status: e.status,
          OriginalAmount: e.amount,
          OriginalCurrency: origCurr,
          ExchangeRate:
            e.exchangeRate !== undefined ? e.exchangeRate : res.ok ? res.multiplier : '',
          ConvertedAmount: res.ok ? res.amount.toFixed(2) : '',
          ReportingCurrency: e.reportingCurrency || reportingCurrency,
        };
      });
    } else {
      rows = [
        { Metric: 'Total Revenue', Value: metrics.totalRevenue.toFixed(2), Currency: reportingCurrency },
        { Metric: 'Total COGS', Value: metrics.totalCogs.toFixed(2), Currency: reportingCurrency },
        {
          Metric: 'Operating Expenses',
          Value: metrics.totalExpenses.toFixed(2),
          Currency: reportingCurrency,
        },
        { Metric: 'Net Profit', Value: metrics.netProfit.toFixed(2), Currency: reportingCurrency },
        { Metric: 'Profit Margin %', Value: metrics.profitMarginPct.toFixed(2), Currency: '%' },
        { Metric: 'Total Active Orders', Value: metrics.totalOrders, Currency: 'count' },
        {
          Metric: 'Average Order Value',
          Value: metrics.averageOrderValue.toFixed(2),
          Currency: reportingCurrency,
        },
      ];
    }

    if (rows.length === 0) {
      setExportError(
        language === 'ar'
          ? 'لا توجد سجلات متاحة للتصدير حتى الآن.'
          : `No ${type} records available to export yet.`
      );
      return;
    }

    try {
      const res = await fetch('/api/reports/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, rows }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'CSV export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zenorati-${type}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const exports = [
    {
      id: 'pnl' as const,
      title: t('repPnlTitle'),
      desc: t('repPnlDesc'),
      count: t('repPnlCount'),
    },
    {
      id: 'orders' as const,
      title: t('repOrdersTitle'),
      desc: t('repOrdersDesc'),
      count: t('repOrdersCount', { count: formatNumber(orders.length, language) }),
    },
    {
      id: 'products' as const,
      title: t('repProductsTitle'),
      desc: t('repProductsDesc'),
      count: t('repProductsCount', { count: formatNumber(products.length, language) }),
    },
    {
      id: 'expenses' as const,
      title: t('repExpensesTitle'),
      desc: t('repExpensesDesc'),
      count: t('repExpensesCount', { count: formatNumber(expenses.length, language) }),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('reportsTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('reportsSubtitle')}
        </p>
      </div>

      {exportError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-400">
          {exportError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exports.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 flex items-center justify-between gap-4"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.desc}</p>
              <div className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400 mt-2">
                {item.count}
              </div>
            </div>
            <button
              type="button"
              onClick={() => downloadCsv(item.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {t('downloadCsvBtn')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

interface UnconnectedModuleViewProps {
  module: 'marketing' | 'automations' | 'integrations';
}

export const UnconnectedModuleView: React.FC<UnconnectedModuleViewProps> = ({ module }) => {
  const { t } = useI18n();

  const config = {
    marketing: {
      title: t('marketingTitle'),
      subtitle: t('marketingSubtitle'),
      icon: Megaphone,
      summary: t('marketingSummary'),
      detail: t('marketingDetail'),
    },
    automations: {
      title: t('automationsTitle'),
      subtitle: t('automationsSubtitle'),
      icon: Workflow,
      summary: t('automationsSummary'),
      detail: t('automationsDetail'),
    },
    integrations: {
      title: t('integrationsTitle'),
      subtitle: t('integrationsSubtitle'),
      icon: Store,
      summary: t('integrationsSummary'),
      detail: t('integrationsDetail'),
    },
  }[module];

  const Icon = config.icon;

  const plannedConnectors =
    module === 'integrations'
      ? [
          { name: 'Shopify Admin API', scope: 'Orders, Products & Inventory Sync', state: t('notConnected') },
          { name: 'Stripe Payments', scope: 'Payouts & Fee Reconciliation', state: t('notConnected') },
          { name: 'WooCommerce REST', scope: 'Storefront Catalog Sync', state: t('notConnected') },
          { name: 'ShipStation 3PL', scope: 'Tracking & Fulfillment Labels', state: t('notConnected') },
        ]
      : module === 'marketing'
      ? [
          { name: 'Meta Ads Manager', scope: 'Ad Spend & Attribution Sync', state: t('notConnected') },
          { name: 'Google Ads', scope: 'Search & Shopping Campaigns', state: t('notConnected') },
          { name: 'Klaviyo', scope: 'Email Revenue Attribution', state: t('notConnected') },
        ]
      : [
          { name: 'Low-Stock Webhook', scope: 'Trigger supplier PO draft on threshold', state: t('inactive') },
          { name: 'Order Fulfillment Sync', scope: 'Dispatch tracking emails on Shipped', state: t('inactive') },
          { name: 'Weekly P&L Digest', scope: 'Email revenue & profit report', state: t('inactive') },
        ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {config.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{config.subtitle}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-blue-500 shrink-0">
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{config.summary}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
              {config.detail}
            </p>
          </div>
        </div>

        <div className="pt-2 divide-y divide-slate-100 dark:divide-slate-800/70">
          {plannedConnectors.map((item) => (
            <div key={item.name} className="py-3.5 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {item.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {item.scope}
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-500 dark:text-slate-400">
                <ExternalLink className="w-3.5 h-3.5 rtl:scale-x-[-1]" aria-hidden="true" />
                {item.state}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const CBE_OFFICIAL_RATES_PAGE_URL =
  'https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates';

function formatExactSyncTimestamp(iso: string | null | undefined, language: AppLanguage): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed);
}

interface SettingsViewProps {
  profile: TenantProfile;
  isCloudMode: boolean;
  userEmail: string | null;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSaveProfile: (next: TenantProfile) => Promise<void>;
  onSignInGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onResetSandbox: () => void;
  onSeedCloudSample: () => Promise<void>;
  cbeSyncState?: CbeSyncState | null;
  onRefreshCbeRate?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  isCloudMode,
  userEmail,
  theme,
  onToggleTheme,
  onSaveProfile,
  onSignInGoogle,
  onSignOut,
  onResetSandbox,
  onSeedCloudSample,
  cbeSyncState,
  onRefreshCbeRate,
}) => {
  const { language, setLanguage, t } = useI18n();
  const [businessName, setBusinessName] = useState(profile.businessName);
  const [currency, setCurrency] = useState<CurrencyCode>(profile.currency);
  const [exchangeRateMode, setExchangeRateMode] = useState<ExchangeRateMode>(
    profile.exchangeRateMode ?? 'cbe_official'
  );
  const [manualOverrideRate, setManualOverrideRate] = useState(
    String(getEffectiveUsdToEgpRate(profile.usdToEgpRate))
  );
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(
    profile.language ?? language
  );
  const [taxRate, setTaxRate] = useState(String(profile.taxRate));
  const [lowStockThreshold, setLowStockThreshold] = useState(String(profile.lowStockThreshold));
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [refreshingCbe, setRefreshingCbe] = useState(false);
  const [cbeActionError, setCbeActionError] = useState<string | null>(null);

  React.useEffect(() => {
    setBusinessName(profile.businessName);
    setCurrency(profile.currency);
    setExchangeRateMode(profile.exchangeRateMode ?? 'cbe_official');
    setManualOverrideRate(String(getEffectiveUsdToEgpRate(profile.usdToEgpRate)));
    setSelectedLanguage(profile.language ?? language);
    setTaxRate(String(profile.taxRate));
    setLowStockThreshold(String(profile.lowStockThreshold));
  }, [profile, language]);

  const officialBuy = cbeSyncState?.officialRate?.buyRate ?? profile.cbeBuyRate;
  const officialSell = cbeSyncState?.officialRate?.sellRate ?? profile.cbeSellRate;
  const officialPubDate =
    cbeSyncState?.officialRate?.publicationDate ?? profile.cbePublicationDate;
  const officialLastSyncedAt =
    cbeSyncState?.officialRate?.lastSyncedAt ?? profile.cbeLastSyncedAt;
  const officialSourceUrl =
    cbeSyncState?.officialRate?.sourceUrl ?? CBE_OFFICIAL_RATES_PAGE_URL;

  const parsedManualRate = Number(manualOverrideRate);
  const isManualRateValid = isValidExchangeRate(parsedManualRate);

  const activeEffectiveRate =
    exchangeRateMode === 'cbe_official'
      ? isValidExchangeRate(officialSell)
        ? officialSell
        : getEffectiveUsdToEgpRate(profile.usdToEgpRate)
      : isManualRateValid
      ? parsedManualRate
      : getEffectiveUsdToEgpRate(profile.usdToEgpRate);

  const isRateValid =
    exchangeRateMode === 'cbe_official'
      ? isValidExchangeRate(activeEffectiveRate)
      : isManualRateValid;

  const reverseRatePreview = isValidExchangeRate(activeEffectiveRate)
    ? (1 / activeEffectiveRate).toFixed(4)
    : '—';

  const effectiveCbeStatus: CbeRateSyncStatus = useMemo(() => {
    if (refreshingCbe || cbeSyncState?.status === 'checking') return 'checking';
    if (cbeSyncState?.status) return cbeSyncState.status;
    return isValidExchangeRate(officialSell) ? 'synced' : 'outdated';
  }, [refreshingCbe, cbeSyncState?.status, officialSell]);

  const statusMeta = useMemo(() => {
    switch (effectiveCbeStatus) {
      case 'synced':
        return {
          label: t('cbeStatusSynced'),
          classes:
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          icon: <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'checking':
        return {
          label: t('cbeStatusChecking'),
          classes: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
          icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />,
        };
      case 'no_change':
        return {
          label: t('cbeStatusNoChange'),
          classes: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
          icon: <Clock className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'unavailable':
        return {
          label: t('cbeStatusUnavailable'),
          classes: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'outdated':
      default:
        return {
          label: t('cbeStatusOutdated'),
          classes: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
          icon: <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />,
        };
    }
  }, [effectiveCbeStatus, t]);

  const currencyOptions: CurrencyCode[] = SUPPORTED_CURRENCIES.includes(currency)
    ? SUPPORTED_CURRENCIES
    : [...SUPPORTED_CURRENCIES, currency];

  const handleManualRefreshCbe = async () => {
    if (!onRefreshCbeRate || refreshingCbe) return;
    setCbeActionError(null);
    setRefreshingCbe(true);
    try {
      await onRefreshCbeRate();
    } catch (err) {
      setCbeActionError(
        err instanceof Error ? err.message : t('cbeStatusUnavailable')
      );
    } finally {
      setRefreshingCbe(false);
    }
  };

  const handleToggleManualOverride = () => {
    setFormError(null);
    setCbeActionError(null);
    if (exchangeRateMode === 'cbe_official') {
      if (!isManualRateValid) {
        setManualOverrideRate(
          String(
            isValidExchangeRate(officialSell)
              ? officialSell
              : getEffectiveUsdToEgpRate(profile.usdToEgpRate)
          )
        );
      }
      setExchangeRateMode('manual_override');
    } else {
      setExchangeRateMode('cbe_official');
    }
  };

  const handleRestoreOfficialRate = async () => {
    setFormError(null);
    setCbeActionError(null);
    setExchangeRateMode('cbe_official');

    const restoredRate = isValidExchangeRate(officialSell)
      ? officialSell
      : getEffectiveUsdToEgpRate(profile.usdToEgpRate);

    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveProfile({
        ...profile,
        exchangeRateMode: 'cbe_official',
        usdToEgpRate: Number(restoredRate.toFixed(4)) || DEFAULT_USD_TO_EGP_RATE,
        ...(isValidExchangeRate(officialBuy) ? { cbeBuyRate: officialBuy } : {}),
        ...(isValidExchangeRate(officialSell) ? { cbeSellRate: officialSell } : {}),
        ...(officialPubDate ? { cbePublicationDate: officialPubDate } : {}),
        ...(officialLastSyncedAt ? { cbeLastSyncedAt: officialLastSyncedAt } : {}),
        cbeSource: OFFICIAL_CBE_SOURCE,
        updatedAt: new Date().toISOString(),
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (err) {
      setCbeActionError(
        err instanceof Error ? err.message : t('exchangeRateError')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!isRateValid) {
      setFormError(t('exchangeRateError'));
      return;
    }

    setSaving(true);
    setSavedNotice(false);
    try {
      const currencyChanged = currency !== profile.currency;
      const nextLegacyCurrency = currencyChanged
        ? profile.legacyCurrency ?? profile.currency
        : profile.legacyCurrency;

      const rateToPersist =
        exchangeRateMode === 'cbe_official'
          ? isValidExchangeRate(officialSell)
            ? officialSell
            : getEffectiveUsdToEgpRate(profile.usdToEgpRate)
          : parsedManualRate;

      await onSaveProfile({
        ...profile,
        businessName: businessName.trim() || 'ZENORATI Store',
        currency,
        exchangeRateMode,
        usdToEgpRate: Number(rateToPersist.toFixed(4)) || DEFAULT_USD_TO_EGP_RATE,
        ...(isValidExchangeRate(officialBuy) ? { cbeBuyRate: officialBuy } : {}),
        ...(isValidExchangeRate(officialSell) ? { cbeSellRate: officialSell } : {}),
        ...(officialPubDate ? { cbePublicationDate: officialPubDate } : {}),
        ...(officialLastSyncedAt ? { cbeLastSyncedAt: officialLastSyncedAt } : {}),
        ...(isValidExchangeRate(officialSell) ? { cbeSource: OFFICIAL_CBE_SOURCE } : {}),
        ...(nextLegacyCurrency ? { legacyCurrency: nextLegacyCurrency } : {}),
        language: selectedLanguage,
        taxRate: Math.max(0, Math.min(100, Number(taxRate) || 0)),
        lowStockThreshold: Math.max(0, Math.min(1000, Math.round(Number(lowStockThreshold) || 0))),
        updatedAt: new Date().toISOString(),
      });
      setLanguage(selectedLanguage);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('exchangeRateError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('settingsTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('settingsSubtitle')}
        </p>
      </div>

      {/* Multi-tenant Cloud Auth Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {isCloudMode
                  ? t('cloudTenantActive', { email: userEmail || profile.ownerId })
                  : t('localSandboxActive')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {isCloudMode
                  ? t('cloudTenantDesc', { uid: profile.ownerId })
                  : t('localSandboxDesc')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {isCloudMode ? (
              <>
                <button
                  type="button"
                  onClick={onSeedCloudSample}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('loadSampleShort')}
                </button>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('signOut')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onResetSandbox}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t('resetLocalDemo')}
                </button>
                <button
                  type="button"
                  onClick={onSignInGoogle}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('signInGoogle')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Official CBE USD/EGP Exchange Rate Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('cbeSectionTitle')}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium ${statusMeta.classes}`}
              >
                {statusMeta.icon}
                {statusMeta.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('cbeSectionSubtitle')}
            </p>
          </div>

          <button
            type="button"
            onClick={handleManualRefreshCbe}
            disabled={!onRefreshCbeRate || refreshingCbe}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 disabled:opacity-60 cursor-pointer shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshingCbe ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {refreshingCbe ? t('cbeRefreshingBtn') : t('cbeRefreshBtn')}
          </button>
        </div>

        {(cbeSyncState?.status === 'unavailable' || cbeActionError) && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {t('cbeUnavailableWarning', {
                error: cbeActionError || cbeSyncState?.lastError || 'CBE source unavailable',
              })}
            </span>
          </div>
        )}

        {/* BUY / SELL / Active Conversion Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070D1D] p-4">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('cbeOfficialBuyRate')}
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
              {isValidExchangeRate(officialBuy)
                ? `${officialBuy.toFixed(4)} EGP`
                : t('cbeNoRateYet')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {t('cbeSourceValue')}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#070D1D] p-4">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('cbeOfficialSellRate')}
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
              {isValidExchangeRate(officialSell)
                ? `${officialSell.toFixed(4)} EGP`
                : t('cbeNoRateYet')}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {t('cbeDefaultSellBadge')}
            </p>
          </div>

          <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('cbeDefaultConversionRate')}
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
              1 USD = {activeEffectiveRate.toFixed(4)} EGP
            </p>
            <p
              className={`text-[11px] font-medium mt-1 ${
                exchangeRateMode === 'manual_override'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-blue-600 dark:text-blue-400'
              }`}
            >
              {exchangeRateMode === 'manual_override'
                ? t('cbeManualOverrideBadge')
                : t('cbeDefaultSellBadge')}
            </p>
          </div>
        </div>

        {/* Attribution & Sync Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs rounded-xl border border-slate-200/80 dark:border-slate-800/70 bg-slate-50/70 dark:bg-[#070D1D]/70 p-3.5">
          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {t('cbeRateSourceLabel')}
            </span>
            <a
              href={officialSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline mt-0.5"
            >
              {t('cbeSourceValue')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {t('cbePublicationDateLabel')}
            </span>
            <span className="block font-medium font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {officialPubDate ? formatDateShort(officialPubDate, language) : '—'}
            </span>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {t('cbeLastSyncedLabel')}
            </span>
            <span className="block font-medium tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {formatExactSyncTimestamp(officialLastSyncedAt, language)}
            </span>
          </div>

          <div>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {t('cbeMonitoringStatusLabel')}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100 mt-0.5">
              <Wifi className="w-3 h-3 text-emerald-500 shrink-0" aria-hidden="true" />
              {t('cbeMonitoringActiveServer')}
            </span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('cbeMonitoringIdleNote')}
            </span>
          </div>
        </div>

        {/* Optional Manual Override & Restore Official CBE Rate */}
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Sliders className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {t('cbeManualOverrideToggle')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('cbeManualOverrideDesc')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {exchangeRateMode === 'manual_override' && (
                <button
                  type="button"
                  onClick={handleRestoreOfficialRate}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-60 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('cbeRestoreOfficialBtn')}
                </button>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={exchangeRateMode === 'manual_override'}
                onClick={handleToggleManualOverride}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  exchangeRateMode === 'manual_override'
                    ? 'bg-amber-500'
                    : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    exchangeRateMode === 'manual_override'
                      ? 'translate-x-6 rtl:-translate-x-6'
                      : 'translate-x-1 rtl:-translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {exchangeRateMode === 'manual_override' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('cbeManualRateInputLabel')}
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.01"
                  max="10000"
                  value={manualOverrideRate}
                  onChange={(e) => setManualOverrideRate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-amber-500/40 bg-white dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-col justify-end text-[11px] text-slate-600 dark:text-slate-300">
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {t('cbeManualOverrideBadge')}
                </span>
                <span className="mt-1">
                  {t('exchangeRateHint', { inv: reverseRatePreview })}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Store Settings Form */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('storeConfigTitle')}
          </h2>
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                {t('switchLightTheme')}
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />
                {t('switchNavyTheme')}
              </>
            )}
          </button>
        </div>

        {formError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('businessNameLabel')}
            </label>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('storeLanguageLabel')}
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as AppLanguage)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              <option value="en">{t('languageOptEn')}</option>
              <option value="ar">{t('languageOptAr')}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('defaultCurrencyLabel')}
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            >
              {currencyOptions.map((code) => (
                <option key={code} value={code}>
                  {getCurrencyLabel(code, language)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('exchangeRateLabel')}
            </label>
            <div className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#070D1D]/90 text-slate-900 dark:text-slate-100 flex items-center justify-between gap-2">
              <span>{activeEffectiveRate.toFixed(4)} EGP</span>
              <span
                className={`text-[10px] font-sans font-medium ${
                  exchangeRateMode === 'manual_override'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {exchangeRateMode === 'manual_override'
                  ? t('cbeManualOverrideBadge')
                  : t('cbeDefaultSellBadge')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {t('exchangeRateHint', { inv: reverseRatePreview })}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('defaultTaxRateLabel')}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('lowStockThresholdLabel')}
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="1000"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            {savedNotice ? t('settingsSavedNotice') : ''}
          </span>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
          >
            {saving ? t('saving') : t('savePreferencesBtn')}
          </button>
        </div>
      </form>
    </div>
  );
};
