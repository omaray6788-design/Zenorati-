import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { CurrencyCode, CurrencyConfig, Customer, Order, Product } from '../types/zenorati';
import { createSafeId, formatCurrency, formatNumber, getProductImageSrc } from '../utils/formatters';
import {
  buildCurrencyConfig,
  resolveReportingAmount,
  resolveTransactionCurrency,
} from '../utils/currency';
import { useI18n } from '../i18n/I18nContext';

interface CustomersViewProps {
  customers: Customer[];
  orders: Order[];
  ownerId: string;
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  globalSearch: string;
  onSaveCustomer: (customer: Customer, isNew: boolean) => Promise<void>;
  onDeleteCustomer: (customer: Customer) => Promise<void>;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  orders,
  ownerId,
  currency,
  currencyConfig,
  globalSearch,
  onSaveCustomer,
  onDeleteCustomer,
}) => {
  const { language, t } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;

  const [localSearch, setLocalSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);

  const [formState, setFormState] = useState({
    name: '',
    email: '',
    phone: '',
    location: '',
    notes: '',
  });

  const customerStats = useMemo(() => {
    const map = new Map<string, { orderCount: number; lifetimeSpend: number }>();
    for (const o of orders) {
      if (o.status === 'cancelled' || o.status === 'returned') continue;
      const key = o.customerEmail.toLowerCase();
      const prev = map.get(key) ?? { orderCount: 0, lifetimeSpend: 0 };
      const res = resolveReportingAmount({
        amount: o.totalAmount,
        recordCurrency: o.currency,
        recordedExchangeRate: o.exchangeRate,
        recordedConvertedAmount: o.convertedAmount,
        recordedReportingCurrency: o.reportingCurrency,
        config: effectiveConfig,
      });
      prev.orderCount += 1;
      if (res.ok) prev.lifetimeSpend += res.amount;
      map.set(key, prev);
    }
    return map;
  }, [orders, effectiveConfig]);

  const queryText = (localSearch || globalSearch).trim().toLowerCase();

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (!queryText) return true;
      return (
        c.name.toLowerCase().includes(queryText) ||
        c.email.toLowerCase().includes(queryText) ||
        c.location.toLowerCase().includes(queryText)
      );
    });
  }, [customers, queryText]);

  const openCreate = () => {
    setEditing(null);
    setFormState({ name: '', email: '', phone: '', location: '', notes: '' });
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setFormState({
      name: c.name,
      email: c.email,
      phone: c.phone,
      location: c.location,
      notes: c.notes,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.name.trim() || !formState.email.trim()) return;
    setSaving(true);
    try {
      const isNew = editing === null;
      await onSaveCustomer(
        {
          id: isNew ? createSafeId('cust') : editing.id,
          ownerId,
          name: formState.name.trim().slice(0, 120),
          email: formState.email.trim().slice(0, 160),
          phone: formState.phone.trim().slice(0, 40),
          location: formState.location.trim().slice(0, 120),
          notes: formState.notes.trim().slice(0, 400),
          createdAt: editing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        isNew
      );
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('crmTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('crmSubtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          {t('addCustomerBtn')}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
        <div className="relative max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('searchCustomersPlaceholder')}
            className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <Users className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t('noCustomersMatchTitle')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                  <th className="py-3 px-4">{t('colCustomer')}</th>
                  <th className="py-3 px-4">{t('colPhoneEmail')}</th>
                  <th className="py-3 px-4">{t('colCityCountry')}</th>
                  <th className="py-3 px-4 text-end">{t('colOrders')}</th>
                  <th className="py-3 px-4 text-end">{t('colTotalSpending')}</th>
                  <th className="py-3 px-4 text-end">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {filtered.map((c) => {
                  const stats = customerStats.get(c.email.toLowerCase()) ?? {
                    orderCount: 0,
                    lifetimeSpend: 0,
                  };
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                          {c.notes || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-700 dark:text-slate-300">{c.email}</div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {c.phone || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {c.location || '—'}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatNumber(stats.orderCount, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                        {formatCurrency(stats.lifetimeSpend, reportingCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            aria-label={`${t('edit')} ${c.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCustomer(c)}
                            aria-label={`${t('delete')} ${c.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {editing ? t('editCustomerProfile') : t('addNewCustomer')}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label={t('close')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('fullNameLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('emailAddressLabel')}
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('phoneNumberLabel')}
                  </label>
                  <input
                    type="text"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('cityLabel')}
                  </label>
                  <input
                    type="text"
                    value={formState.location}
                    onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('notes')}
                </label>
                <textarea
                  rows={2}
                  value={formState.notes}
                  onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
                >
                  {saving ? t('saving') : t('saveCustomerBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface InventoryViewProps {
  products: Product[];
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  lowStockThreshold: number;
  globalSearch: string;
  onAdjustStock: (product: Product, nextStock: number) => Promise<void>;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  currency,
  currencyConfig,
  lowStockThreshold,
  globalSearch,
  onAdjustStock,
}) => {
  const { language, t } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;

  const [filterMode, setFilterMode] = useState<'all' | 'low' | 'out'>('all');
  const [localSearch, setLocalSearch] = useState('');

  const queryText = (localSearch || globalSearch).trim().toLowerCase();

  const { totalUnits, retailValuation, costValuation, unconvertedCount, lowCount, outCount } =
    useMemo(() => {
      let units = 0;
      let retail = 0;
      let cost = 0;
      let unconverted = 0;
      let low = 0;
      let out = 0;

      for (const p of products) {
        units += p.stock;
        if (p.stock === 0) out += 1;
        else if (p.stock <= lowStockThreshold) low += 1;

        const retailRes = resolveReportingAmount({
          amount: p.stock * p.price,
          recordCurrency: p.currency,
          config: effectiveConfig,
        });
        if (retailRes.ok) {
          retail += retailRes.amount;
          cost += Number((p.stock * p.cost * retailRes.multiplier).toFixed(2));
        } else {
          unconverted += 1;
        }
      }

      return {
        totalUnits: units,
        retailValuation: Number(retail.toFixed(2)),
        costValuation: Number(cost.toFixed(2)),
        unconvertedCount: unconverted,
        lowCount: low,
        outCount: out,
      };
    }, [products, lowStockThreshold, effectiveConfig]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (filterMode === 'low' && !(p.stock > 0 && p.stock <= lowStockThreshold)) return false;
      if (filterMode === 'out' && p.stock !== 0) return false;
      if (!queryText) return true;
      return (
        p.name.toLowerCase().includes(queryText) ||
        p.sku.toLowerCase().includes(queryText)
      );
    });
  }, [products, filterMode, lowStockThreshold, queryText]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {t('inventoryTitle')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('inventorySubtitle', { threshold: formatNumber(lowStockThreshold, language) })}
        </p>
      </div>

      {unconvertedCount > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          {t('unconvertedBanner', { count: unconvertedCount })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t('totalUnitsOnHand')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatNumber(totalUnits, language)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t('retailInventoryValue')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {formatCurrency(retailValuation, reportingCurrency, 2, language)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {t('costValuationCogs')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
            {formatCurrency(costValuation, reportingCurrency, 2, language)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t('alertsLabel')}</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {t('lowOutShort', {
              low: formatNumber(lowCount, language),
              out: formatNumber(outCount, language),
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('searchInventoryPlaceholder')}
            className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800">
          {(
            [
              { id: 'all', label: t('allSkusTab') },
              { id: 'low', label: t('lowStockTab') },
              { id: 'out', label: t('outOfStockTab') },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterMode(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filterMode === f.id
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                <th className="py-3 px-4">{t('colProduct')}</th>
                <th className="py-3 px-4">{t('colSku')}</th>
                <th className="py-3 px-4">{t('colHealth')}</th>
                <th className="py-3 px-4 text-end">{t('colStockValue')}</th>
                <th className="py-3 px-4 text-end">{t('colAvailable')}</th>
                <th className="py-3 px-4 text-end">{t('colQuickAdjust')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
              {filtered.map((p) => {
                const imgSrc = getProductImageSrc(p.imageKey);
                const isOut = p.stock === 0;
                const isLow = p.stock > 0 && p.stock <= lowStockThreshold;
                const prodCurrency = resolveTransactionCurrency(p.currency, effectiveConfig);
                const stockCostVal = p.stock * p.cost;
                const converted =
                  prodCurrency !== reportingCurrency
                    ? resolveReportingAmount({
                        amount: stockCostVal,
                        recordCurrency: p.currency,
                        config: effectiveConfig,
                      })
                    : null;

                return (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={p.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
                          )}
                        </div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {p.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">{p.sku}</td>
                    <td className="py-3 px-4">
                      {isOut ? (
                        <span className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
                          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                          {t('healthOut')}
                        </span>
                      ) : isLow ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                          {t('healthLow')}
                        </span>
                      ) : (
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {t('healthHealthy')}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      <div>{formatCurrency(stockCostVal, prodCurrency, 2, language)}</div>
                      {converted && converted.ok && (
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">
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
                    <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatNumber(p.stock, language)}
                    </td>
                    <td className="py-3 px-4 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onAdjustStock(p, Math.max(0, p.stock - 1))}
                          aria-label={`Decrease stock for ${p.name}`}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdjustStock(p, p.stock + 1)}
                          aria-label={`Increase stock for ${p.name}`}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onAdjustStock(p, p.stock + 10)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 cursor-pointer"
                        >
                          +10
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
