import React, { useCallback, useState } from 'react';
import { Database, RefreshCw, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

const LOCAL_WORKSPACE_KEY = 'zenorati_local_workspace_v1';

export interface LocalOrderPreview {
  orderNumber: string;
  customerName: string;
}

export interface LocalStorageDiagnosticReport {
  origin: string;
  exists: boolean;
  parseError: string | null;
  businessName: string | null;
  ownerId: string | null;
  productsCount: number;
  ordersCount: number;
  customersCount: number;
  expensesCount: number;
  orders: LocalOrderPreview[];
}

export function inspectLocalWorkspaceStorage(): LocalStorageDiagnosticReport {
  let origin = 'unavailable';
  try {
    origin = window.location.origin;
  } catch {
    origin = 'unavailable';
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LOCAL_WORKSPACE_KEY);
  } catch (err) {
    return {
      origin,
      exists: false,
      parseError: err instanceof Error ? err.message : 'Unable to access localStorage.',
      businessName: null,
      ownerId: null,
      productsCount: 0,
      ordersCount: 0,
      customersCount: 0,
      expensesCount: 0,
      orders: [],
    };
  }

  if (raw === null) {
    return {
      origin,
      exists: false,
      parseError: null,
      businessName: null,
      ownerId: null,
      productsCount: 0,
      ordersCount: 0,
      customersCount: 0,
      expensesCount: 0,
      orders: [],
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profile =
      parsed && typeof parsed.profile === 'object' && parsed.profile !== null
        ? (parsed.profile as Record<string, unknown>)
        : null;
    const products = Array.isArray(parsed?.products) ? parsed.products : [];
    const rawOrders = Array.isArray(parsed?.orders) ? parsed.orders : [];
    const customers = Array.isArray(parsed?.customers) ? parsed.customers : [];
    const expenses = Array.isArray(parsed?.expenses) ? parsed.expenses : [];

    const orders: LocalOrderPreview[] = rawOrders.map((entry, idx) => {
      const rec =
        entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const orderNumRaw = rec.orderNumber ?? rec.id ?? `#${idx + 1}`;
      const customerRaw = rec.customerName ?? rec.name ?? '—';
      return {
        orderNumber: String(orderNumRaw || `#${idx + 1}`),
        customerName: String(customerRaw || '—'),
      };
    });

    return {
      origin,
      exists: true,
      parseError: null,
      businessName:
        profile && typeof profile.businessName === 'string' && profile.businessName.trim()
          ? profile.businessName
          : null,
      ownerId:
        profile && typeof profile.ownerId === 'string' && profile.ownerId.trim()
          ? profile.ownerId
          : null,
      productsCount: products.length,
      ordersCount: rawOrders.length,
      customersCount: customers.length,
      expensesCount: expenses.length,
      orders,
    };
  } catch (err) {
    return {
      origin,
      exists: true,
      parseError: err instanceof Error ? err.message : 'Invalid JSON in localStorage.',
      businessName: null,
      ownerId: null,
      productsCount: 0,
      ordersCount: 0,
      customersCount: 0,
      expensesCount: 0,
      orders: [],
    };
  }
}

export const LocalStorageDiagnosticPanel: React.FC = () => {
  const { t } = useI18n();
  const [report, setReport] = useState<LocalStorageDiagnosticReport>(() =>
    inspectLocalWorkspaceStorage()
  );

  const handleRefresh = useCallback(() => {
    setReport(inspectLocalWorkspaceStorage());
  }, []);

  return (
    <section
      aria-label={t('diagLocalTitle')}
      className="mb-5 rounded-2xl border border-cyan-500/35 bg-white dark:bg-[#0B1328] p-4 sm:p-5 shadow-sm space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5">
            <Database className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {t('diagLocalTitle')}
              </h2>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {t('diagReadOnlyBadge')}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('diagLocalSubtitle')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          {t('diagRefreshBtn')}
        </button>
      </div>

      {report.parseError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('diagParseErrorMsg', { error: report.parseError })}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagExistsLabel')}
          </div>
          <div
            className={`mt-1 font-bold ${
              report.exists
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {report.exists ? t('diagExistsYes') : t('diagExistsNo')}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagBusinessNameLabel')}
          </div>
          <div className="mt-1 font-semibold text-slate-900 dark:text-white break-words">
            {report.businessName ?? '—'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagOwnerIdLabel')}
          </div>
          <div
            dir="ltr"
            className="mt-1 font-mono text-[11px] font-semibold text-slate-900 dark:text-white break-all"
          >
            {report.ownerId ?? '—'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagOriginLabel')}
          </div>
          <div
            dir="ltr"
            className="mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all"
          >
            {report.origin}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagProductsLabel')}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {report.productsCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagOrdersLabel')}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {report.ordersCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagCustomersLabel')}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {report.customersCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('diagExpensesLabel')}
          </div>
          <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {report.expensesCount}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5 space-y-2">
        <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {t('diagOrdersListLabel')} ({report.orders.length})
        </div>
        {report.orders.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400">{t('diagNoOrdersMsg')}</div>
        ) : (
          <ul className="max-h-56 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800/80 text-xs">
            {report.orders.map((ord, index) => (
              <li
                key={`${ord.orderNumber}-${index}`}
                className="py-1.5 flex items-center justify-between gap-3"
              >
                <span
                  dir="ltr"
                  className="font-mono font-semibold text-blue-600 dark:text-cyan-400 shrink-0"
                >
                  {ord.orderNumber}
                </span>
                <span className="text-slate-800 dark:text-slate-200 truncate text-end">
                  {ord.customerName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
