import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  CurrencyCode,
  CurrencyConfig,
  Customer,
  CustomerComputedMetrics,
  CustomerSegment,
  CustomerSegmentRules,
  Order,
} from '../types/zenorati';
import {
  assignCustomerSegment,
  buildCustomerMetricsList,
  computeCrmInsights,
  CUSTOMER_SEGMENT_META,
  DEFAULT_SEGMENT_RULES,
  findDuplicateCustomer,
  formatLocation,
  isDemoCustomer,
  loadCrmSegmentRules,
  parseCityCountry,
  saveCrmSegmentRules,
} from '../utils/customerHelpers';
import {
  createSafeId,
  formatCurrency,
  formatDateShort,
  formatNumber,
  ORDER_STATUS_META,
} from '../utils/formatters';
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
  isCloudMode?: boolean;
  userEmail?: string | null;
  onSignInGoogle?: () => Promise<void>;
  onSaveCustomer: (customer: Customer, isNew: boolean) => Promise<void>;
  onDeleteCustomer: (customer: Customer) => Promise<void>;
  onSyncFromOrders?: () => Promise<{ created: number; matched: number }>;
  syncingCustomers?: boolean;
  onOpenOrder: (order: Order) => void;
}

type PurchaseActivityFilter =
  | 'all'
  | 'has_orders'
  | 'repeat'
  | 'no_orders'
  | 'recent_30d';

const PAGE_SIZE = 10;

function isWithinLast30Days(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const parsed = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 29);
  return parsed >= cutoff;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  orders,
  ownerId,
  currency,
  currencyConfig,
  globalSearch,
  isCloudMode = false,
  userEmail = null,
  onSignInGoogle,
  onSaveCustomer,
  onDeleteCustomer,
  onSyncFromOrders,
  syncingCustomers = false,
  onOpenOrder,
}) => {
  const { language, t, tCustomerSegment, tOrderStatus } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;

  const [segmentRules, setSegmentRules] = useState<CustomerSegmentRules>(() =>
    loadCrmSegmentRules(ownerId)
  );
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState<CustomerSegmentRules>(segmentRules);

  useEffect(() => {
    const loaded = loadCrmSegmentRules(ownerId);
    setSegmentRules(loaded);
    setRulesDraft(loaded);
  }, [ownerId]);

  const [localSearch, setLocalSearch] = useState('');
  const [dataScope, setDataScope] = useState<'real' | 'demo' | 'all'>('real');
  const [segmentFilter, setSegmentFilter] = useState<'all' | CustomerSegment>('all');
  const [activityFilter, setActivityFilter] = useState<PurchaseActivityFilter>('all');
  const [page, setPage] = useState(1);

  // Selected customer profile drawer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [profileNoteDraft, setProfileNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteStatusMsg, setNoteStatusMsg] = useState<string | null>(null);

  // Delete confirmation (inline 2-step)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Add / Edit Customer modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [formState, setFormState] = useState({
    name: '',
    phone: '',
    email: '',
    shippingAddress: '',
    city: '',
    country: '',
    notes: '',
  });

  const metricsList = useMemo(
    () => buildCustomerMetricsList(customers, orders, segmentRules, effectiveConfig),
    [customers, orders, segmentRules, effectiveConfig]
  );

  const realMetricsList = useMemo(
    () => metricsList.filter((item) => !isDemoCustomer(item.customer)),
    [metricsList]
  );

  const demoMetricsList = useMemo(
    () => metricsList.filter((item) => isDemoCustomer(item.customer)),
    [metricsList]
  );

  const effectiveDataScope =
    demoMetricsList.length === 0 && dataScope === 'demo' ? 'real' : dataScope;

  const scopedMetricsList = useMemo(() => {
    if (effectiveDataScope === 'real') return realMetricsList;
    if (effectiveDataScope === 'demo') return demoMetricsList;
    return metricsList;
  }, [effectiveDataScope, realMetricsList, demoMetricsList, metricsList]);

  const insights = useMemo(() => computeCrmInsights(scopedMetricsList), [scopedMetricsList]);

  const selectedProfile = useMemo(
    () => metricsList.find((m) => m.customer.id === selectedCustomerId) ?? null,
    [metricsList, selectedCustomerId]
  );

  useEffect(() => {
    if (selectedProfile) {
      setProfileNoteDraft(selectedProfile.customer.notes || '');
      setNoteStatusMsg(null);
    }
  }, [selectedProfile?.customer.id, selectedProfile?.customer.notes]);

  const queryText = (localSearch || globalSearch).trim().toLowerCase();

  const filteredList = useMemo(() => {
    const filtered = scopedMetricsList.filter((item) => {
      if (segmentFilter !== 'all' && item.segment !== segmentFilter) return false;
      if (activityFilter === 'has_orders' && item.totalOrders < 1) return false;
      if (activityFilter === 'repeat' && item.totalOrders < 2) return false;
      if (activityFilter === 'no_orders' && item.totalOrders > 0) return false;
      if (activityFilter === 'recent_30d' && !isWithinLast30Days(item.lastOrderDate)) return false;

      if (!queryText) return true;
      const c = item.customer;
      const cleanDigits = queryText.replace(/\D/g, '');
      const phoneDigits = c.phone.replace(/\D/g, '');
      return (
        c.name.toLowerCase().includes(queryText) ||
        c.email.toLowerCase().includes(queryText) ||
        c.phone.toLowerCase().includes(queryText) ||
        (cleanDigits.length >= 3 && phoneDigits.includes(cleanDigits)) ||
        item.city.toLowerCase().includes(queryText) ||
        item.country.toLowerCase().includes(queryText) ||
        c.location.toLowerCase().includes(queryText)
      );
    });

    return [...filtered].sort(
      (a, b) =>
        b.totalSpent - a.totalSpent ||
        b.totalOrders - a.totalOrders ||
        a.customer.name.localeCompare(b.customer.name)
    );
  }, [scopedMetricsList, segmentFilter, activityFilter, queryText]);

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [queryText, segmentFilter, activityFilter, effectiveDataScope]);

  const paginatedList = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredList.slice(start, start + PAGE_SIZE);
  }, [filteredList, safePage]);

  const segmentCounts = useMemo(() => {
    const counts: Record<'all' | CustomerSegment, number> = {
      all: scopedMetricsList.length,
      new: 0,
      active: 0,
      vip: 0,
    };
    for (const item of scopedMetricsList) {
      counts[item.segment] += 1;
    }
    return counts;
  }, [scopedMetricsList]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFormState({
      name: '',
      phone: '',
      email: '',
      shippingAddress: '',
      city: '',
      country: '',
      notes: '',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (item: CustomerComputedMetrics) => {
    const c = item.customer;
    const loc = parseCityCountry(c.location, c.city, c.country);
    setEditingCustomer(c);
    setFormState({
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      shippingAddress: c.shippingAddress || item.shippingAddress || '',
      city: loc.city,
      country: loc.country,
      notes: c.notes || '',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveCustomerForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formState.name.trim();
    const phone = formState.phone.trim();
    const email = formState.email.trim();
    const shippingAddress = formState.shippingAddress.trim();
    const city = formState.city.trim();
    const country = formState.country.trim();
    const notes = formState.notes.trim();

    if (!name) {
      setFormError(
        language === 'ar' ? 'الاسم الكامل مطلوب.' : 'Full name is required.'
      );
      return;
    }
    if (email.length < 3 && phone.length < 3) {
      setFormError(
        language === 'ar'
          ? 'يرجى إدخال رقم هاتف أو بريد إلكتروني صالح على الأقل.'
          : 'Provide at least a valid phone number or email address.'
      );
      return;
    }

    const duplicate = findDuplicateCustomer(
      customers,
      { phone, email },
      editingCustomer?.id
    );
    if (duplicate) {
      setFormError(
        language === 'ar'
          ? `يوجد ملف عميل بالفعل بنفس بيانات الاتصال (${duplicate.name}${duplicate.phone ? ` · ${duplicate.phone}` : ''}${duplicate.email ? ` · ${duplicate.email}` : ''}).`
          : `A customer profile already exists with matching contact details (${duplicate.name}${duplicate.phone ? ` · ${duplicate.phone}` : ''}${duplicate.email ? ` · ${duplicate.email}` : ''}).`
      );
      return;
    }

    setSaving(true);
    setFormError(null);
    const nowIso = new Date().toISOString();
    try {
      const isNew = editingCustomer === null;
      const location = formatLocation(city, country, editingCustomer?.location);
      const payload: Customer = {
        id: isNew ? createSafeId('cust') : editingCustomer.id,
        ownerId,
        name: name.slice(0, 120),
        email: email.slice(0, 160),
        phone: phone.slice(0, 40),
        location: location.slice(0, 120),
        shippingAddress: shippingAddress.slice(0, 240),
        city: city.slice(0, 80),
        country: country.slice(0, 80),
        notes: notes.slice(0, 400),
        createdAt: editingCustomer?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      await onSaveCustomer(payload, isNew);
      setModalOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : language === 'ar'
          ? 'تعذر حفظ ملف العميل.'
          : 'Unable to save customer profile.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfileNotes = async () => {
    if (!selectedProfile) return;
    setSavingNote(true);
    setNoteStatusMsg(null);
    try {
      const c = selectedProfile.customer;
      const loc = parseCityCountry(c.location, c.city, c.country);
      await onSaveCustomer(
        {
          ...c,
          city: loc.city,
          country: loc.country,
          location: formatLocation(loc.city, loc.country, c.location),
          shippingAddress: c.shippingAddress || selectedProfile.shippingAddress || '',
          notes: profileNoteDraft.trim().slice(0, 400),
          updatedAt: new Date().toISOString(),
        },
        false
      );
      setNoteStatusMsg(t('notesSavedMsg'));
    } catch (err) {
      setNoteStatusMsg(
        err instanceof Error
          ? err.message
          : language === 'ar'
          ? 'فشل حفظ الملاحظات.'
          : 'Failed to save notes.'
      );
    } finally {
      setSavingNote(false);
    }
  };

  const handleConfirmDelete = async (customer: Customer) => {
    setDeletingId(customer.id);
    setActionError(null);
    try {
      await onDeleteCustomer(customer);
      setConfirmDeleteId(null);
      if (selectedCustomerId === customer.id) {
        setSelectedCustomerId(null);
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : language === 'ar'
          ? 'تعذر حذف العميل.'
          : 'Unable to delete customer.'
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveSegmentRules = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: CustomerSegmentRules = {
      vipMinSpend: Math.max(0, Number(rulesDraft.vipMinSpend) || 0),
      vipMinOrders: Math.max(1, Math.round(Number(rulesDraft.vipMinOrders) || 1)),
      activeMinOrders: Math.max(1, Math.round(Number(rulesDraft.activeMinOrders) || 1)),
    };
    setSegmentRules(cleaned);
    setRulesDraft(cleaned);
    saveCrmSegmentRules(ownerId, cleaned);
    setRulesModalOpen(false);
  };

  const handleManualSync = async () => {
    if (!onSyncFromOrders) return;
    setActionError(null);
    setSyncMessage(null);
    try {
      const res = await onSyncFromOrders();
      if (res.created === 0) {
        setSyncMessage(t('syncDoneNone'));
      } else {
        setSyncMessage(t('syncDoneCreated', { count: res.created }));
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : language === 'ar'
          ? 'تعذر مزامنة العملاء من الطلبات.'
          : 'Unable to sync customers from orders.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('crmTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('crmSubtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onSyncFromOrders && (
            <button
              type="button"
              disabled={syncingCustomers}
              onClick={() => void handleManualSync()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-700 dark:text-slate-200 hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncingCustomers ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {syncingCustomers ? t('syncingBtn') : t('syncFromOrders')}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setRulesDraft(segmentRules);
              setRulesModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-700 dark:text-slate-200 hover:border-cyan-500/40 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            {t('segmentRulesBtn')}
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('addCustomerBtn')}
          </button>
        </div>
      </div>

      {/* Data Source & Demo Separation Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-white">
            {isCloudMode
              ? t('firestoreStoreLabel', { name: userEmail || ownerId })
              : t('localSandboxLabel')}
          </span>
          <span className="text-slate-400" aria-hidden="true">·</span>
          <span>
            {t('realCustomersCount', { count: formatNumber(realMetricsList.length, language) })}
            {demoMetricsList.length > 0
              ? ` · ${t('demoSeparatedCount', {
                  count: formatNumber(demoMetricsList.length, language),
                })}`
              : ''}
          </span>
          {!isCloudMode && onSignInGoogle && (
            <button
              type="button"
              onClick={() => void onSignInGoogle()}
              className="text-blue-600 dark:text-cyan-400 font-semibold underline cursor-pointer"
            >
              {t('signInFirestoreLink')}
            </button>
          )}
        </div>

        {demoMetricsList.length > 0 && (
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 self-start md:self-auto"
            role="group"
            aria-label={t('crmTitle')}
          >
            {(
              [
                {
                  id: 'real',
                  label: t('tabRealCustomers', {
                    count: formatNumber(realMetricsList.length, language),
                  }),
                },
                {
                  id: 'demo',
                  label: t('tabSampleDemo', {
                    count: formatNumber(demoMetricsList.length, language),
                  }),
                },
                {
                  id: 'all',
                  label: t('tabAllCount', {
                    count: formatNumber(metricsList.length, language),
                  }),
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDataScope(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveDataScope === tab.id
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {syncMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
          <span>{syncMessage}</span>
          <button
            type="button"
            onClick={() => setSyncMessage(null)}
            className="font-semibold underline cursor-pointer"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between gap-3">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold underline cursor-pointer"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* CRM Dashboard Insights */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('totalCustomersCard')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatNumber(insights.totalCustomers, language)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {t('deduplicatedNote')}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('newThisMonthCard')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {formatNumber(insights.newCustomersThisMonth, language)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {t('addedCurrentMonthNote')}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('returningCustomersCard')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatNumber(insights.returningCustomers, language)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {t('repeatOrdersNote')}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('vipCustomersCard')}
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
            {formatNumber(insights.vipCustomers, language)}
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {t('vipThresholdNote', {
              amount: formatCurrency(segmentRules.vipMinSpend, reportingCurrency, 2, language),
              orders: segmentRules.vipMinOrders,
            })}
          </div>
        </div>
      </div>

      {/* Top Customers by Total Spending */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              {t('topCustomersTitle')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('topCustomersSubtitle')}
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {t('activeRuleNote', {
              active: segmentRules.activeMinOrders,
              vipSpend: formatCurrency(segmentRules.vipMinSpend, reportingCurrency, 2, language),
              vipOrders: segmentRules.vipMinOrders,
            })}
          </span>
        </div>

        {insights.topCustomers.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('noTopCustomers')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            {insights.topCustomers.map((item, index) => {
              const segMeta = CUSTOMER_SEGMENT_META[item.segment];
              return (
                <button
                  key={item.customer.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(item.customer.id)}
                  className="text-start rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-[#070D1D] p-3.5 hover:border-blue-500/40 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      #{index + 1}
                    </span>
                    <span className={`text-[11px] font-semibold ${segMeta.textClass}`}>
                      {tCustomerSegment(item.segment)}
                    </span>
                  </div>
                  <div className="mt-1.5 font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                    {item.customer.name}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                      {formatCurrency(item.totalSpent, reportingCurrency, 2, language)}
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {t('ordersCountText', {
                        count: formatNumber(item.totalOrders, language),
                      })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Search & Filters Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('searchCustomersPlaceholder')}
            className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 overflow-x-auto max-w-full"
            role="group"
            aria-label={t('colStatus')}
          >
            {(
              [
                { id: 'all', label: `${t('all')} (${formatNumber(segmentCounts.all, language)})` },
                {
                  id: 'new',
                  label: `${tCustomerSegment('new')} (${formatNumber(segmentCounts.new, language)})`,
                },
                {
                  id: 'active',
                  label: `${tCustomerSegment('active')} (${formatNumber(
                    segmentCounts.active,
                    language
                  )})`,
                },
                {
                  id: 'vip',
                  label: `${tCustomerSegment('vip')} (${formatNumber(segmentCounts.vip, language)})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSegmentFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  segmentFilter === tab.id
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value as PurchaseActivityFilter)}
            aria-label={t('actAll')}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-700 dark:text-slate-200"
          >
            <option value="all">{t('actAll')}</option>
            <option value="has_orders">{t('actHasOrders')}</option>
            <option value="repeat">{t('actRepeat')}</option>
            <option value="recent_30d">{t('actRecent30')}</option>
            <option value="no_orders">{t('actNoOrders')}</option>
          </select>
        </div>
      </div>

      {/* Customer Database Table (Desktop) + Cards (Mobile) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
        {filteredList.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <Users className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {effectiveDataScope === 'real' && realMetricsList.length === 0
                ? t('noRealCustomersTitle')
                : t('noCustomersMatchTitle')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {effectiveDataScope === 'real' &&
              realMetricsList.length === 0 &&
              demoMetricsList.length > 0
                ? t('noRealCustomersDemoHint', {
                    count: formatNumber(demoMetricsList.length, language),
                  })
                : t('noCustomersDefaultHint')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {onSyncFromOrders && (
                <button
                  type="button"
                  disabled={syncingCustomers}
                  onClick={() => void handleManualSync()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500/40 cursor-pointer"
                >
                  {syncingCustomers ? t('syncingBtn') : t('syncFromOrders')}
                </button>
              )}
              <button
                type="button"
                onClick={openCreateModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
              >
                {t('addCustomerBtn')}
              </button>
              {effectiveDataScope === 'real' && demoMetricsList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDataScope('demo')}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  {t('viewSampleDemo', {
                    count: formatNumber(demoMetricsList.length, language),
                  })}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile Responsive Card List */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/70">
              {paginatedList.map((item) => {
                const c = item.customer;
                const segMeta = CUSTOMER_SEGMENT_META[item.segment];
                const demoRecord = isDemoCustomer(c);
                return (
                  <div key={c.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerId(c.id)}
                        className="text-start min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="font-semibold text-sm text-slate-900 dark:text-white truncate flex items-center gap-2">
                          <span className="truncate">{c.name}</span>
                          {demoRecord && (
                            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                              {t('sampleSuffix')}
                            </span>
                          )}
                        </div>
                        <div className={`text-xs font-medium mt-0.5 ${segMeta.textClass}`}>
                          {tCustomerSegment(item.segment)}
                        </div>
                      </button>
                      <div className="text-end shrink-0">
                        <div className="text-sm font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                          {formatCurrency(item.totalSpent, reportingCurrency, 2, language)}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {t('ordersCountText', {
                            count: formatNumber(item.totalOrders, language),
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                      {c.phone && <div className="font-mono">{c.phone}</div>}
                      {c.email && <div className="truncate">{c.email}</div>}
                      {(item.city || item.country || c.location) && (
                        <div className="text-slate-500 dark:text-slate-400">
                          {formatLocation(item.city, item.country, c.location)}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerId(c.id)}
                        className="px-3 py-2 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer"
                      >
                        {t('viewProfile')}
                      </button>

                      {confirmDeleteId === c.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={deletingId === c.id}
                            onClick={() => handleConfirmDelete(c)}
                            className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                          >
                            {deletingId === c.id ? t('deleting') : t('confirmDelete')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          >
                            {t('cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            aria-label={`${t('edit')} ${c.name}`}
                            className="p-2.5 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(c.id)}
                            aria-label={`${t('delete')} ${c.name}`}
                            className="p-2.5 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-start border-collapse min-w-[820px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                    <th className="py-3 px-4">{t('colCustomer')}</th>
                    <th className="py-3 px-4">{t('colPhoneEmail')}</th>
                    <th className="py-3 px-4">{t('colCityCountry')}</th>
                    <th className="py-3 px-4">{t('colStatus')}</th>
                    <th className="py-3 px-4 text-end">{t('colOrders')}</th>
                    <th className="py-3 px-4 text-end">{t('colTotalSpending')}</th>
                    <th className="py-3 px-4 text-end">{t('colLastOrder')}</th>
                    <th className="py-3 px-4 text-end">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {paginatedList.map((item) => {
                    const c = item.customer;
                    const segMeta = CUSTOMER_SEGMENT_META[item.segment];
                    const demoRecord = isDemoCustomer(c);
                    return (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(c.id)}
                            className="text-start group cursor-pointer"
                          >
                            <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-cyan-400 transition-colors inline-flex items-center gap-1.5">
                              <span>{c.name}</span>
                              {demoRecord && (
                                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                  {t('sampleSuffix')}
                                </span>
                              )}
                              <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity rtl:scale-x-[-1]" aria-hidden="true" />
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                              {t('addedDateLabel', {
                                date: c.createdAt
                                  ? formatDateShort(c.createdAt.slice(0, 10), language)
                                  : t('recent'),
                              })}
                            </div>
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-slate-800 dark:text-slate-200">
                            {c.phone || '—'}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[210px]">
                            {c.email || '—'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                          {formatLocation(item.city, item.country, c.location) || '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-semibold ${segMeta.textClass}`}>
                            {tCustomerSegment(item.segment)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatNumber(item.totalOrders, language)}
                        </td>
                        <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                          {formatCurrency(item.totalSpent, reportingCurrency, 2, language)}
                        </td>
                        <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {item.lastOrderDate ? formatDateShort(item.lastOrderDate, language) : '—'}
                        </td>
                        <td className="py-3 px-4 text-end">
                          {confirmDeleteId === c.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={deletingId === c.id}
                                onClick={() => handleConfirmDelete(c)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                              >
                                {deletingId === c.id ? t('deleting') : t('confirm')}
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
                                onClick={() => setSelectedCustomerId(c.id)}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-blue-600 dark:text-cyan-400 hover:bg-blue-500/10 cursor-pointer"
                              >
                                {t('viewProfile')}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(item)}
                                aria-label={`${t('edit')} ${c.name}`}
                                className="p-2 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(c.id)}
                                aria-label={`${t('delete')} ${c.name}`}
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

            {/* Pagination Footer */}
            {filteredList.length > PAGE_SIZE && (
              <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3 text-xs">
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {t('showingRange', {
                    from: formatNumber((safePage - 1) * PAGE_SIZE + 1, language),
                    to: formatNumber(Math.min(safePage * PAGE_SIZE, filteredList.length), language),
                    total: formatNumber(filteredList.length, language),
                  })}
                </span>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
                  </button>
                  <span className="px-2 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    {t('pageOfTotal', {
                      page: formatNumber(safePage, language),
                      total: formatNumber(totalPages, language),
                    })}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Dedicated Customer Profile Drawer */}
      {selectedProfile && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl h-full bg-white dark:bg-[#0B1328] border-s border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden">
            {/* Profile Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${CUSTOMER_SEGMENT_META[selectedProfile.segment].textClass}`}>
                    {tCustomerSegment(selectedProfile.segment)}
                  </span>
                  <span className="text-slate-400" aria-hidden="true">·</span>
                  <span className="text-slate-500 dark:text-slate-400 font-mono">
                    {t('firstAddedLabel', {
                      date: selectedProfile.customer.createdAt
                        ? formatDateShort(selectedProfile.customer.createdAt.slice(0, 10), language)
                        : t('recent'),
                    })}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-1 truncate">
                  {selectedProfile.customer.name}
                </h2>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => openEditModal(selectedProfile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-500/40 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('edit')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(null)}
                  aria-label={t('close')}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Profile Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Lifetime Metrics Strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('kpiTotalOrders')}
                  </div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {formatNumber(selectedProfile.totalOrders, language)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('totalSpentLabel')}
                  </div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                    {formatCurrency(selectedProfile.totalSpent, reportingCurrency, 2, language)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('colLastOrder')}
                  </div>
                  <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
                    {selectedProfile.lastOrderDate
                      ? formatDateShort(selectedProfile.lastOrderDate, language)
                      : t('noOrdersLabel')}
                  </div>
                </div>
              </div>

              {/* Contact & Location Info */}
              <div className="space-y-3 border-b border-slate-200 dark:border-slate-800 pb-5 text-xs">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t('contactShippingTitle')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
                    <Phone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('phoneLabel')}
                      </div>
                      <div className="font-mono">
                        {selectedProfile.customer.phone || t('notProvided')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300">
                    <Mail className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('emailLabel')}
                      </div>
                      <div className="truncate">
                        {selectedProfile.customer.email || t('notProvided')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300 sm:col-span-2">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {t('shippingAddressLocation')}
                      </div>
                      <div>
                        {selectedProfile.shippingAddress || t('noStreetAddress')}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                        {t('cityCountryLine', {
                          city: selectedProfile.city || '—',
                          country: selectedProfile.country || '—',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Internal Notes */}
              <div className="space-y-2.5 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t('internalNotesTitle')}
                  </h3>
                  {noteStatusMsg && (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      {noteStatusMsg}
                    </span>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={profileNoteDraft}
                  onChange={(e) => setProfileNoteDraft(e.target.value)}
                  placeholder={t('notesPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 resize-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingNote}
                    onClick={handleSaveProfileNotes}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                  >
                    {savingNote ? t('saving') : t('saveNotesBtn')}
                  </button>
                </div>
              </div>

              {/* Order History from Live Orders */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {t('orderHistoryCount', {
                      count: formatNumber(selectedProfile.orders.length, language),
                    })}
                  </h3>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('orderHistoryRef')}
                  </span>
                </div>

                {selectedProfile.orders.length === 0 ? (
                  <div className="py-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    {t('noLinkedOrders')}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800/80 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {selectedProfile.orders.map((ord) => {
                      const stMeta = ORDER_STATUS_META[ord.status];
                      const ordCurrency = resolveTransactionCurrency(ord.currency, effectiveConfig);
                      const converted =
                        ordCurrency !== reportingCurrency
                          ? resolveReportingAmount({
                              amount: ord.totalAmount,
                              recordCurrency: ord.currency,
                              recordedExchangeRate: ord.exchangeRate,
                              recordedConvertedAmount: ord.convertedAmount,
                              recordedReportingCurrency: ord.reportingCurrency,
                              config: effectiveConfig,
                            })
                          : null;

                      return (
                        <div
                          key={ord.id}
                          className="p-4 bg-slate-50/40 dark:bg-[#070D1D] hover:bg-slate-100/60 dark:hover:bg-slate-800/30 transition-colors space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-mono font-bold text-slate-900 dark:text-white">
                                {ord.orderNumber}
                              </span>
                              <span className="text-slate-400" aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-mono text-slate-500 dark:text-slate-400">
                                <Calendar className="w-3 h-3" aria-hidden="true" />
                                {formatDateShort(ord.orderDate, language)}
                              </span>
                              <span className="text-slate-400" aria-hidden="true">·</span>
                              <span className={`font-semibold ${stMeta.textClass}`}>
                                {tOrderStatus(ord.status)}
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="text-end">
                                <span className="text-xs font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                                  {formatCurrency(ord.totalAmount, ordCurrency, 2, language)}
                                </span>
                                {converted && converted.ok && (
                                  <div className="text-[10px] font-mono text-slate-400">
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
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCustomerId(null);
                                  onOpenOrder(ord);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 cursor-pointer"
                              >
                                {t('openOrderBtn')}
                                <ExternalLink className="w-3 h-3 rtl:scale-x-[-1]" aria-hidden="true" />
                              </button>
                            </div>
                          </div>

                          {/* Product & Quantities List */}
                          {ord.items && ord.items.length > 0 ? (
                            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 ps-1">
                              {ord.items.map((it) => (
                                <li key={it.id} className="flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                      {it.quantity}×
                                    </span>{' '}
                                    {it.productName}
                                    {it.variant && it.variant !== 'Standard'
                                      ? ` (${it.variant})`
                                      : ''}
                                  </span>
                                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                                    {formatCurrency(it.lineTotal, ordCurrency, 2, language)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                              <ShoppingBag className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                              <span>{ord.itemsSummary}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Safe Profile Deletion Footer inside Drawer */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-sm">
                  {t('deleteCustomerHint')}
                </p>

                {confirmDeleteId === selectedProfile.customer.id ? (
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      disabled={deletingId === selectedProfile.customer.id}
                      onClick={() => handleConfirmDelete(selectedProfile.customer)}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                    >
                      {deletingId === selectedProfile.customer.id
                        ? t('deleting')
                        : t('confirmDeleteProfile')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selectedProfile.customer.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('deleteCustomerBtn')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {editingCustomer ? t('editCustomerProfile') : t('addNewCustomer')}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label={t('close')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomerForm} className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('fullNameLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  placeholder={t('customerNamePlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('phoneNumberLabel')}
                  </label>
                  <input
                    type="text"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    placeholder="+20 100 000 0000"
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('emailAddressLabel')}
                  </label>
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    placeholder={t('customerEmailPlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('shippingAddressLabel')}
                </label>
                <input
                  type="text"
                  value={formState.shippingAddress}
                  onChange={(e) => setFormState({ ...formState, shippingAddress: e.target.value })}
                  placeholder={t('shippingAddressPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('cityLabel')}
                  </label>
                  <input
                    type="text"
                    value={formState.city}
                    onChange={(e) => setFormState({ ...formState, city: e.target.value })}
                    placeholder={language === 'ar' ? 'القاهرة' : 'Cairo'}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('countryRegionLabel')}
                  </label>
                  <input
                    type="text"
                    value={formState.country}
                    onChange={(e) => setFormState({ ...formState, country: e.target.value })}
                    placeholder={language === 'ar' ? 'مصر' : 'Egypt'}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('internalNotesTitle')}
                </label>
                <textarea
                  rows={2}
                  value={formState.notes}
                  onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                  placeholder={t('notesPlaceholder')}
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? t('saving') : editingCustomer ? t('saveChanges') : t('saveCustomerBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Editable Segment Rules Modal */}
      {rulesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {t('segmentRulesTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setRulesModalOpen(false)}
                aria-label={t('close')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveSegmentRules} className="p-6 space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('segmentRulesDesc')}
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('vipMinSpendLabel', { curr: reportingCurrency })}
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={rulesDraft.vipMinSpend}
                  onChange={(e) =>
                    setRulesDraft({ ...rulesDraft, vipMinSpend: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('vipMinOrdersLabel')}
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={rulesDraft.vipMinOrders}
                  onChange={(e) =>
                    setRulesDraft({ ...rulesDraft, vipMinOrders: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('activeMinOrdersLabel')}
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={rulesDraft.activeMinOrders}
                  onChange={(e) =>
                    setRulesDraft({ ...rulesDraft, activeMinOrders: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] p-3 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                <div>
                  <span className="font-semibold text-purple-600 dark:text-cyan-400">
                    {tCustomerSegment('vip')}
                  </span>
                  : ≥{' '}
                  {formatCurrency(rulesDraft.vipMinSpend || 0, reportingCurrency, 2, language)} ·{' '}
                  {Math.max(1, rulesDraft.vipMinOrders || 1)}+
                </div>
                <div>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {tCustomerSegment('active')}
                  </span>
                  : {Math.max(1, rulesDraft.activeMinOrders || 1)}+
                </div>
                <div>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {tCustomerSegment('new')}
                  </span>
                  : &lt; {Math.max(1, rulesDraft.activeMinOrders || 1)} (
                  {tCustomerSegment(assignCustomerSegment(1, 0, rulesDraft))})
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRulesDraft(DEFAULT_SEGMENT_RULES)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline cursor-pointer"
                >
                  {t('resetDefaults')}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRulesModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
                  >
                    {t('applyRules')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
