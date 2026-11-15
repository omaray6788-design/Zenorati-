import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Archive,
  Boxes,
  CheckCircle2,
  Cloud,
  Database,
  FileWarning,
  HardDrive,
  Lightbulb,
  Package,
  RefreshCw,
  Settings,
  ShoppingBag,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  BusinessActivity,
  CurrencyCode,
  Customer,
  Expense,
  Order,
  Product,
  ProductIdea,
  TenantProfile,
} from '../types/zenorati';
import { buildCurrencyConfig } from '../utils/currency';
import { formatCurrency } from '../utils/formatters';
import { useI18n } from '../i18n/I18nContext';

const LOCAL_WORKSPACE_KEY = 'zenorati_local_workspace_v1';

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|auth|credential|firebase|invite|session|cookie|api_?key/i;

export interface LegacyPreferenceEntry {
  key: string;
  valuePreview: string;
}

export interface LegacyExtraSection {
  key: string;
  summary: string;
}

export interface LegacyIndexedDbEntry {
  name: string;
  version: number | null;
}

export interface LegacyArchiveSnapshot {
  origin: string;
  keyFound: boolean;
  rawByteSize: number;
  parseError: string | null;
  profile: Partial<TenantProfile> | null;
  products: Product[];
  orders: Order[];
  customers: Customer[];
  expenses: Expense[];
  activities: BusinessActivity[];
  researchIdeas: ProductIdea[];
  preferenceEntries: LegacyPreferenceEntry[];
  extraWorkspaceFields: LegacyExtraSection[];
  indexedDbNames: LegacyIndexedDbEntry[];
  discoveredOtherKeys: LegacyPreferenceEntry[];
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function optString(val: unknown): string | undefined {
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

function optNumber(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function sanitizePreferenceValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 260) {
    return `${trimmed.slice(0, 260)}… (${trimmed.length} chars)`;
  }
  return trimmed;
}

export function inspectLegacyBrowserArchive(): LegacyArchiveSnapshot {
  let origin = 'unavailable';
  try {
    origin = window.location.origin;
  } catch {
    origin = 'unavailable';
  }

  const preferenceEntries: LegacyPreferenceEntry[] = [];
  const discoveredOtherKeys: LegacyPreferenceEntry[] = [];

  try {
    const len = window.localStorage.length;
    for (let i = 0; i < len; i += 1) {
      const k = window.localStorage.key(i);
      if (!k || k === LOCAL_WORKSPACE_KEY) continue;
      if (SENSITIVE_KEY_PATTERN.test(k)) continue;

      const val = window.localStorage.getItem(k);
      if (val === null) continue;

      if (
        k === 'zenorati_theme' ||
        k === 'zenorati_lang' ||
        k.startsWith('zenorati_lang_') ||
        k.startsWith('zenorati_crm_rules_')
      ) {
        preferenceEntries.push({
          key: k,
          valuePreview: sanitizePreferenceValue(val),
        });
      } else if (k.startsWith('zenorati_')) {
        discoveredOtherKeys.push({
          key: k,
          valuePreview: sanitizePreferenceValue(val),
        });
      }
    }
  } catch {
    // Ignore restricted storage iteration errors
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LOCAL_WORKSPACE_KEY);
  } catch (err) {
    return {
      origin,
      keyFound: false,
      rawByteSize: 0,
      parseError: err instanceof Error ? err.message : 'Unable to read localStorage.',
      profile: null,
      products: [],
      orders: [],
      customers: [],
      expenses: [],
      activities: [],
      researchIdeas: [],
      preferenceEntries,
      extraWorkspaceFields: [],
      indexedDbNames: [],
      discoveredOtherKeys,
    };
  }

  if (raw === null) {
    return {
      origin,
      keyFound: false,
      rawByteSize: 0,
      parseError: null,
      profile: null,
      products: [],
      orders: [],
      customers: [],
      expenses: [],
      activities: [],
      researchIdeas: [],
      preferenceEntries,
      extraWorkspaceFields: [],
      indexedDbNames: [],
      discoveredOtherKeys,
    };
  }

  const rawByteSize = new Blob([raw]).size;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) {
      return {
        origin,
        keyFound: true,
        rawByteSize,
        parseError: 'Stored JSON root is not an object.',
        profile: null,
        products: [],
        orders: [],
        customers: [],
        expenses: [],
        activities: [],
        researchIdeas: [],
        preferenceEntries,
        extraWorkspaceFields: [],
        indexedDbNames: [],
        discoveredOtherKeys,
      };
    }

    const rawProfile = isPlainRecord(parsed.profile) ? parsed.profile : null;
    const profile: Partial<TenantProfile> | null = rawProfile
      ? {
          ownerId: optString(rawProfile.ownerId),
          businessName: optString(rawProfile.businessName),
          ownerEmail: optString(rawProfile.ownerEmail),
          fullName: optString(rawProfile.fullName),
          currency: optString(rawProfile.currency) as CurrencyCode | undefined,
          usdToEgpRate: optNumber(rawProfile.usdToEgpRate),
          legacyCurrency: optString(rawProfile.legacyCurrency) as CurrencyCode | undefined,
          language: optString(rawProfile.language) as 'en' | 'ar' | undefined,
          exchangeRateMode: optString(rawProfile.exchangeRateMode) as
            | 'cbe_official'
            | 'manual_override'
            | undefined,
          cbeBuyRate: optNumber(rawProfile.cbeBuyRate),
          cbeSellRate: optNumber(rawProfile.cbeSellRate),
          cbePublicationDate: optString(rawProfile.cbePublicationDate),
          cbeLastSyncedAt: optString(rawProfile.cbeLastSyncedAt),
          cbeSource: optString(rawProfile.cbeSource),
          taxRate: optNumber(rawProfile.taxRate),
          lowStockThreshold: optNumber(rawProfile.lowStockThreshold),
          createdAt: optString(rawProfile.createdAt),
          updatedAt: optString(rawProfile.updatedAt),
        }
      : null;

    const products = Array.isArray(parsed.products) ? (parsed.products as Product[]) : [];
    const orders = Array.isArray(parsed.orders) ? (parsed.orders as Order[]) : [];
    const customers = Array.isArray(parsed.customers) ? (parsed.customers as Customer[]) : [];
    const expenses = Array.isArray(parsed.expenses) ? (parsed.expenses as Expense[]) : [];
    const activities = Array.isArray(parsed.activities)
      ? (parsed.activities as BusinessActivity[])
      : [];
    const researchIdeas = Array.isArray(parsed.researchIdeas)
      ? (parsed.researchIdeas as ProductIdea[])
      : [];

    const knownKeys = new Set([
      'profile',
      'products',
      'orders',
      'customers',
      'expenses',
      'activities',
      'researchIdeas',
    ]);
    const extraWorkspaceFields: LegacyExtraSection[] = Object.keys(parsed)
      .filter((k) => !knownKeys.has(k) && !SENSITIVE_KEY_PATTERN.test(k))
      .map((k) => {
        const val = parsed[k];
        if (Array.isArray(val)) {
          return { key: k, summary: `Array (${val.length} item(s))` };
        }
        if (isPlainRecord(val)) {
          return { key: k, summary: `Object (${Object.keys(val).length} field(s))` };
        }
        return { key: k, summary: sanitizePreferenceValue(String(val ?? 'null')) };
      });

    return {
      origin,
      keyFound: true,
      rawByteSize,
      parseError: null,
      profile,
      products,
      orders,
      customers,
      expenses,
      activities,
      researchIdeas,
      preferenceEntries,
      extraWorkspaceFields,
      indexedDbNames: [],
      discoveredOtherKeys,
    };
  } catch (err) {
    return {
      origin,
      keyFound: true,
      rawByteSize,
      parseError: err instanceof Error ? err.message : 'Unable to parse stored JSON.',
      profile: null,
      products: [],
      orders: [],
      customers: [],
      expenses: [],
      activities: [],
      researchIdeas: [],
      preferenceEntries,
      extraWorkspaceFields: [],
      indexedDbNames: [],
      discoveredOtherKeys,
    };
  }
}

interface OldDataArchiveViewProps {
  cloudUid: string | null;
  cloudBusinessName: string;
  hasCloudTenantDoc: boolean;
  cloudCounts: {
    products: number;
    orders: number;
    customers: number;
    expenses: number;
  };
}

export const OldDataArchiveView: React.FC<OldDataArchiveViewProps> = ({
  cloudUid,
  cloudBusinessName,
  hasCloudTenantDoc,
  cloudCounts,
}) => {
  const { language, t } = useI18n();
  const [snapshot, setSnapshot] = useState<LegacyArchiveSnapshot>(() =>
    inspectLegacyBrowserArchive()
  );
  const [indexedDbNames, setIndexedDbNames] = useState<LegacyIndexedDbEntry[]>([]);

  const loadIndexedDbMeta = useCallback(async () => {
    try {
      const idb = window.indexedDB as IDBFactory & {
        databases?: () => Promise<Array<{ name?: string; version?: number }>>;
      };
      if (typeof idb?.databases === 'function') {
        const list = await idb.databases();
        setIndexedDbNames(
          list
            .filter((d) => typeof d.name === 'string' && d.name.length > 0)
            .map((d) => ({
              name: String(d.name),
              version: typeof d.version === 'number' ? d.version : null,
            }))
        );
      }
    } catch {
      setIndexedDbNames([]);
    }
  }, []);

  useEffect(() => {
    void loadIndexedDbMeta();
  }, [loadIndexedDbMeta]);

  const handleRefresh = useCallback(() => {
    setSnapshot(inspectLegacyBrowserArchive());
    void loadIndexedDbMeta();
  }, [loadIndexedDbMeta]);

  const archiveCurrency: CurrencyCode = snapshot.profile?.currency ?? 'USD';
  const archiveCurrencyCfg = buildCurrencyConfig({
    currency: archiveCurrency,
    usdToEgpRate: snapshot.profile?.usdToEgpRate,
    language,
  });

  const nonCancelledOrders = snapshot.orders.filter(
    (o) => o.status !== 'cancelled' && o.status !== 'returned'
  );
  const oldRevenue = nonCancelledOrders.reduce((sum, o) => sum + Number(o.totalAmount ?? 0), 0);
  const oldCogs = nonCancelledOrders.reduce((sum, o) => sum + Number(o.totalCost ?? 0), 0);
  const oldExpensesTotal = snapshot.expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const oldNetProfit = oldRevenue - oldCogs - oldExpensesTotal;
  const oldTotalStockUnits = snapshot.products.reduce((sum, p) => sum + Number(p.stock ?? 0), 0);

  const settingsEntries: Array<{ label: string; value: string }> = snapshot.profile
    ? [
        { label: 'Business Name', value: snapshot.profile.businessName ?? '—' },
        { label: 'Owner ID', value: snapshot.profile.ownerId ?? '—' },
        { label: 'Owner Email', value: snapshot.profile.ownerEmail ?? '—' },
        { label: 'Currency', value: snapshot.profile.currency ?? '—' },
        {
          label: 'USD → EGP Rate',
          value:
            snapshot.profile.usdToEgpRate !== undefined
              ? String(snapshot.profile.usdToEgpRate)
              : '—',
        },
        { label: 'Exchange Rate Mode', value: snapshot.profile.exchangeRateMode ?? '—' },
        {
          label: 'CBE Buy / Sell',
          value:
            snapshot.profile.cbeBuyRate !== undefined || snapshot.profile.cbeSellRate !== undefined
              ? `${snapshot.profile.cbeBuyRate ?? '—'} / ${snapshot.profile.cbeSellRate ?? '—'}`
              : '—',
        },
        { label: 'CBE Publication Date', value: snapshot.profile.cbePublicationDate ?? '—' },
        {
          label: 'Tax Rate (%)',
          value: snapshot.profile.taxRate !== undefined ? String(snapshot.profile.taxRate) : '—',
        },
        {
          label: 'Low Stock Threshold',
          value:
            snapshot.profile.lowStockThreshold !== undefined
              ? String(snapshot.profile.lowStockThreshold)
              : '—',
        },
        { label: 'Language', value: snapshot.profile.language ?? '—' },
        { label: 'Created At', value: snapshot.profile.createdAt ?? '—' },
        { label: 'Updated At', value: snapshot.profile.updatedAt ?? '—' },
      ]
    : [];

  const totalSettingsRecords = settingsEntries.length + snapshot.preferenceEntries.length;
  const totalOtherRecords =
    snapshot.activities.length +
    snapshot.researchIdeas.length +
    snapshot.extraWorkspaceFields.length +
    snapshot.discoveredOtherKeys.length +
    indexedDbNames.length;

  const SectionHeader: React.FC<{
    title: string;
    count: number;
    icon: React.ComponentType<{ className?: string }>;
  }> = ({ title, count, icon: Icon }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800/80">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          {t('oldDataSourceLocalBadge')}
        </span>
        <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
          {t('oldDataRecordsCount', { count })}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Archive Header */}
      <div className="rounded-2xl border border-amber-500/35 bg-white dark:bg-[#0B1328] p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <Archive className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('oldDataSidebarTag')}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t('oldDataTitle')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
              {t('oldDataSubtitle')}
            </p>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {t('diagRefreshBtn')}
          </button>
        </div>

        {/* Status: Found vs Not Found */}
        {snapshot.keyFound && !snapshot.parseError ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">{t('oldDataFoundTitle')}</div>
              <div className="opacity-90">
                {t('oldDataFoundDesc', { origin: snapshot.origin })} ({snapshot.rawByteSize} bytes)
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2.5">
            <FileWarning className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">
                {snapshot.parseError ? snapshot.parseError : t('oldDataNotFoundTitle')}
              </div>
              <div className="opacity-90">
                {t('oldDataNotFoundDesc', { origin: snapshot.origin })}
              </div>
            </div>
          </div>
        )}

        {/* Clear Separation: Old Local Storage vs Current Firebase Cloud Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
                {t('oldDataSourceLocalBadge')}
              </span>
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                {snapshot.keyFound ? t('diagExistsYes') : t('diagExistsNo')}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div>
                <div className="text-[11px] text-slate-500">{t('diagProductsLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {snapshot.products.length}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">{t('diagOrdersLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {snapshot.orders.length}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">{t('diagCustomersLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {snapshot.customers.length}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">{t('diagExpensesLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {snapshot.expenses.length}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-bold text-blue-700 dark:text-cyan-300">
                <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
                {t('oldDataSourceCloudBadge')}
              </span>
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                {hasCloudTenantDoc ? t('oldDataCloudActiveLabel') : t('oldDataCloudEmptyLabel')}
              </span>
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
              {cloudBusinessName} · <span className="font-mono">{cloudUid ?? '—'}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div>
                <div className="text-[11px] text-slate-500">{t('diagProductsLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {cloudCounts.products}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">{t('diagOrdersLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">{cloudCounts.orders}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">{t('diagCustomersLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {cloudCounts.customers}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">{t('diagExpensesLabel')}</div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {cloudCounts.expenses}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Old Dashboard & Business Profile */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection1')}
          count={snapshot.profile ? 1 : 0}
          icon={Database}
        />
        {!snapshot.profile ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataProfileMissing')}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500">{t('diagBusinessNameLabel')}</div>
                <div className="mt-1 font-bold text-slate-900 dark:text-white">
                  {snapshot.profile.businessName ?? '—'}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500">{t('diagOwnerIdLabel')}</div>
                <div dir="ltr" className="mt-1 font-mono text-[11px] text-slate-900 dark:text-white break-all">
                  {snapshot.profile.ownerId ?? '—'}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500">Revenue (Non-Cancelled Orders)</div>
                <div className="mt-1 font-bold text-blue-600 dark:text-cyan-400">
                  {formatCurrency(oldRevenue, archiveCurrencyCfg.reportingCurrency, 2, language)}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-3">
                <div className="text-[11px] text-slate-500">Net Profit (Revenue − COGS − Expenses)</div>
                <div className="mt-1 font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(oldNetProfit, archiveCurrencyCfg.reportingCurrency, 2, language)}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 2. All Old Products & Details */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection2')}
          count={snapshot.products.length}
          icon={Package}
        />
        {snapshot.products.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {snapshot.products.map((prod) => (
              <div
                key={prod.id}
                className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-slate-900 dark:text-white">{prod.name}</div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {prod.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  SKU: {prod.sku} · ID: {prod.id}
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-slate-700 dark:text-slate-300">
                  <span>Category: {prod.category}</span>
                  <span>
                    Price: {formatCurrency(prod.price, prod.currency ?? archiveCurrency, 2, language)}
                  </span>
                  <span>
                    Cost: {formatCurrency(prod.cost, prod.currency ?? archiveCurrency, 2, language)}
                  </span>
                  <span>Stock: {prod.stock}</span>
                </div>
                {prod.description && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{prod.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. All Old Orders & Complete Details */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection3')}
          count={snapshot.orders.length}
          icon={ShoppingBag}
        />
        {snapshot.orders.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="space-y-3 text-xs">
            {snapshot.orders.map((ord) => {
              const ordCur = ord.currency ?? archiveCurrency;
              return (
                <div
                  key={ord.id}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="ltr" className="font-mono font-bold text-blue-600 dark:text-cyan-400">
                        {ord.orderNumber || ord.id}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {ord.customerName}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {ord.status}
                      </span>
                      <span className="text-[11px] text-slate-500">{ord.channel}</span>
                    </div>
                    <div className="font-mono font-bold text-slate-900 dark:text-white">
                      {formatCurrency(ord.totalAmount, ordCur, 2, language)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <div>Date: {ord.orderDate || '—'}</div>
                    <div>Phone: {ord.customerPhone || '—'}</div>
                    <div>Email: {ord.customerEmail || '—'}</div>
                    <div>Address: {ord.shippingAddress || '—'}</div>
                    <div>
                      Subtotal / Tax / Ship / Disc:{' '}
                      {formatCurrency(ord.subtotal, ordCur, 2, language)} /{' '}
                      {formatCurrency(ord.taxAmount, ordCur, 2, language)} /{' '}
                      {formatCurrency(ord.shippingCost, ordCur, 2, language)} /{' '}
                      {formatCurrency(ord.discountAmount ?? 0, ordCur, 2, language)}
                    </div>
                    <div>
                      COGS: {formatCurrency(ord.totalCost, ordCur, 2, language)} · Stock Deducted:{' '}
                      {String(Boolean(ord.stockDeducted))}
                    </div>
                  </div>

                  {ord.itemsSummary && (
                    <div className="text-[11px] text-slate-600 dark:text-slate-400">
                      Summary: {ord.itemsSummary}
                    </div>
                  )}

                  {Array.isArray(ord.items) && ord.items.length > 0 && (
                    <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-[#0B1328] p-2.5 space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Line Items ({ord.items.length})
                      </div>
                      {ord.items.map((it) => (
                        <div
                          key={it.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="text-slate-800 dark:text-slate-200">
                            {it.quantity}× {it.productName} ({it.sku} · {it.variant})
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            {formatCurrency(it.lineTotal, ordCur, 2, language)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {Array.isArray(ord.history) && ord.history.length > 0 && (
                    <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-[#0B1328] p-2.5 space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Order History ({ord.history.length})
                      </div>
                      {ord.history.map((h) => (
                        <div key={h.id} className="text-[11px] text-slate-600 dark:text-slate-400">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            [{h.status}] {h.title}
                          </span>
                          {h.detail ? ` — ${h.detail}` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {ord.notes && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Notes: {ord.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. All Old Customers & Details */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection4')}
          count={snapshot.customers.length}
          icon={Users}
        />
        {snapshot.customers.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {snapshot.customers.map((cust) => (
              <div
                key={cust.id}
                className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5 space-y-1"
              >
                <div className="font-bold text-slate-900 dark:text-white">{cust.name}</div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  Phone: {cust.phone || '—'} · Email: {cust.email || '—'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Location: {cust.location || cust.city || cust.country || '—'}
                </div>
                {cust.shippingAddress && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Address: {cust.shippingAddress}
                  </div>
                )}
                {cust.notes && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Notes: {cust.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. All Old Expenses & Financial Records */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection5')}
          count={snapshot.expenses.length}
          icon={Wallet}
        />
        {snapshot.expenses.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Total Recovered Expenses:{' '}
              <span className="font-mono">
                {formatCurrency(oldExpensesTotal, archiveCurrency, 2, language)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {snapshot.expenses.map((exp) => (
                <div
                  key={exp.id}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5 space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-slate-900 dark:text-white">{exp.title}</div>
                    <div className="font-mono font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(exp.amount, exp.currency ?? archiveCurrency, 2, language)}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">
                    {exp.category} · {exp.vendor} · {exp.expenseDate} · {exp.status}
                  </div>
                  {exp.notes && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {exp.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 6. Old Inventory Records & Stock Quantities */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection6')}
          count={snapshot.products.length}
          icon={Boxes}
        />
        {snapshot.products.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Total Stock Units: <span className="font-mono font-bold">{oldTotalStockUnits}</span>
              {snapshot.profile?.lowStockThreshold !== undefined
                ? ` · Threshold: ${snapshot.profile.lowStockThreshold}`
                : ''}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                    <th className="py-2 pe-3">SKU</th>
                    <th className="py-2 pe-3">Product</th>
                    <th className="py-2 pe-3">Stock</th>
                    <th className="py-2 pe-3">Unit Cost</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {snapshot.products.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pe-3 font-mono text-[11px]">{p.sku}</td>
                      <td className="py-2 pe-3 font-medium text-slate-900 dark:text-white">
                        {p.name}
                      </td>
                      <td className="py-2 pe-3 font-mono font-bold">{p.stock}</td>
                      <td className="py-2 pe-3 font-mono">
                        {formatCurrency(p.cost, p.currency ?? archiveCurrency, 2, language)}
                      </td>
                      <td className="py-2">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 7. Old Store Settings & Preferences */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection7')}
          count={totalSettingsRecords}
          icon={Settings}
        />
        {totalSettingsRecords === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="space-y-4 text-xs">
            {settingsEntries.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {settingsEntries.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-2.5"
                  >
                    <div className="text-[11px] text-slate-500">{item.label}</div>
                    <div className="font-mono text-[11px] font-semibold text-slate-900 dark:text-white break-all mt-0.5">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {snapshot.preferenceEntries.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-500">
                  {t('oldDataOtherKeysNote')} ({snapshot.preferenceEntries.length})
                </div>
                <div className="space-y-1.5">
                  {snapshot.preferenceEntries.map((pref) => (
                    <div
                      key={pref.key}
                      className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-2.5"
                    >
                      <div className="font-mono text-[11px] font-bold text-blue-600 dark:text-cyan-400">
                        {pref.key}
                      </div>
                      <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all mt-0.5">
                        {pref.valuePreview}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 8. Any Other Legacy Business Records Discovered */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5 space-y-4">
        <SectionHeader
          title={t('oldDataSection8')}
          count={totalOtherRecords}
          icon={Activity}
        />
        {totalOtherRecords === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('oldDataEmptyCategory')}</p>
        ) : (
          <div className="space-y-4 text-xs">
            {snapshot.activities.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Old Business Activities ({snapshot.activities.length})
                </div>
                <div className="space-y-1.5">
                  {snapshot.activities.map((act) => (
                    <div
                      key={act.id}
                      className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-2.5 flex flex-wrap justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          [{act.type}] {act.title}
                        </span>
                        {act.detail ? ` — ${act.detail}` : ''}
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">{act.createdAt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {snapshot.researchIdeas.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                  <span>Old Product Research Ideas ({snapshot.researchIdeas.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {snapshot.researchIdeas.map((idea) => (
                    <div
                      key={idea.id}
                      className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-3 space-y-1"
                    >
                      <div className="font-bold text-slate-900 dark:text-white">{idea.name}</div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                        Target: {idea.targetPrice} · Cost: {idea.estimatedCost} · Ship:{' '}
                        {idea.shippingEstimate} · CPA: {idea.adCpaEstimate}
                      </div>
                      {idea.notes && (
                        <div className="text-[11px] text-slate-500">{idea.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {snapshot.extraWorkspaceFields.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Additional Legacy Fields ({snapshot.extraWorkspaceFields.length})
                </div>
                {snapshot.extraWorkspaceFields.map((f) => (
                  <div
                    key={f.key}
                    className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-2.5 font-mono text-[11px]"
                  >
                    {f.key}: {f.summary}
                  </div>
                ))}
              </div>
            )}

            {snapshot.discoveredOtherKeys.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Other Storage Keys ({snapshot.discoveredOtherKeys.length})
                </div>
                {snapshot.discoveredOtherKeys.map((k) => (
                  <div
                    key={k.key}
                    className="rounded-xl bg-slate-50 dark:bg-[#070D1D] border border-slate-200/70 dark:border-slate-800 p-2.5 font-mono text-[11px] break-all"
                  >
                    {k.key}: {k.valuePreview}
                  </div>
                ))}
              </div>
            )}

            {indexedDbNames.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  {t('oldDataIndexedDbNote')} ({indexedDbNames.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {indexedDbNames.map((dbEntry) => (
                    <span
                      key={dbEntry.name}
                      className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 font-mono text-[11px]"
                    >
                      {dbEntry.name}
                      {dbEntry.version !== null ? ` (v${dbEntry.version})` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
