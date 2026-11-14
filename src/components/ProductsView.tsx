import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Copy,
  Eye,
  LayoutGrid,
  LayoutList,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CurrencyCode,
  CurrencyConfig,
  Product,
  ProductImageKey,
  ProductStatus,
} from '../types/zenorati';
import { createSafeId, formatCurrency, formatNumber, getProductImageSrc } from '../utils/formatters';
import {
  buildCurrencyConfig,
  getCurrencyLabel,
  resolveReportingAmount,
  resolveTransactionCurrency,
  SUPPORTED_CURRENCIES,
} from '../utils/currency';
import { useI18n } from '../i18n/I18nContext';

interface ProductsViewProps {
  products: Product[];
  ownerId: string;
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  lowStockThreshold: number;
  globalSearch: string;
  onSaveProduct: (product: Product, isNew: boolean) => Promise<void>;
  onDeleteProduct: (product: Product) => Promise<void>;
  isCreateModalOpen: boolean;
  onCloseCreateModal: () => void;
  onOpenCreateModal: () => void;
}

type SortField = 'updated' | 'name' | 'price' | 'margin' | 'stock';
type StockFilter = 'all' | 'in' | 'low' | 'out';

export const ProductsView: React.FC<ProductsViewProps> = ({
  products,
  ownerId,
  currency,
  currencyConfig,
  lowStockThreshold,
  globalSearch,
  onSaveProduct,
  onDeleteProduct,
  isCreateModalOpen,
  onCloseCreateModal,
  onOpenCreateModal,
}) => {
  const { language, t, tProductStatus } = useI18n();
  const effectiveConfig =
    currencyConfig ?? buildCurrencyConfig({ currency, language });
  const reportingCurrency = effectiveConfig.reportingCurrency;
  const defaultProductCurrency: CurrencyCode =
    reportingCurrency === 'EGP' || reportingCurrency === 'USD'
      ? reportingCurrency
      : 'USD';

  const imageOptions: Array<{ key: ProductImageKey; label: string }> = [
    { key: 'none', label: t('imgPresetNone') },
    { key: 'headphones', label: t('imgPresetHeadphones') },
    { key: 'keyboard', label: t('imgPresetKeyboard') },
    { key: 'kettle', label: t('imgPresetKettle') },
    { key: 'folio', label: t('imgPresetFolio') },
  ];

  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProductStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('updated');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  const [inspectingProduct, setInspectingProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [products]);

  const catalogSummary = useMemo(() => {
    const activeCount = products.filter((p) => p.status === 'active').length;
    const draftCount = products.filter((p) => p.status === 'draft').length;
    const lowCount = products.filter((p) => p.stock > 0 && p.stock <= lowStockThreshold).length;
    const outCount = products.filter((p) => p.stock === 0).length;

    let retailValue = 0;
    let costValue = 0;
    let unconvertedCount = 0;

    for (const p of products) {
      const retailRes = resolveReportingAmount({
        amount: p.price * p.stock,
        recordCurrency: p.currency,
        config: effectiveConfig,
      });
      if (retailRes.ok) {
        retailValue += retailRes.amount;
        costValue += Number((p.cost * p.stock * retailRes.multiplier).toFixed(2));
      } else {
        unconvertedCount += 1;
      }
    }

    const avgMargin =
      products.length > 0
        ? products.reduce((sum, p) => {
            const m = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
            return sum + m;
          }, 0) / products.length
        : 0;
    return {
      activeCount,
      draftCount,
      lowCount,
      outCount,
      retailValue: Number(retailValue.toFixed(2)),
      costValue: Number(costValue.toFixed(2)),
      unconvertedCount,
      avgMargin,
    };
  }, [products, lowStockThreshold, effectiveConfig]);

  const queryText = (localSearch || globalSearch).trim().toLowerCase();

  const hasActiveFilters =
    localSearch.trim() !== '' ||
    globalSearch.trim() !== '' ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    stockFilter !== 'all';

  const clearAllFilters = () => {
    setLocalSearch('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setStockFilter('all');
  };

  const filteredProducts = useMemo(() => {
    const list = products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (stockFilter === 'in' && p.stock <= lowStockThreshold) return false;
      if (stockFilter === 'low' && !(p.stock > 0 && p.stock <= lowStockThreshold)) return false;
      if (stockFilter === 'out' && p.stock !== 0) return false;
      if (!queryText) return true;
      return (
        p.name.toLowerCase().includes(queryText) ||
        p.sku.toLowerCase().includes(queryText) ||
        p.category.toLowerCase().includes(queryText) ||
        p.description.toLowerCase().includes(queryText)
      );
    });

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'price') {
        const resA = resolveReportingAmount({
          amount: a.price,
          recordCurrency: a.currency,
          config: effectiveConfig,
        });
        const resB = resolveReportingAmount({
          amount: b.price,
          recordCurrency: b.currency,
          config: effectiveConfig,
        });
        cmp = (resA.ok ? resA.amount : a.price) - (resB.ok ? resB.amount : b.price);
      } else if (sortBy === 'margin') {
        const mA = a.price > 0 ? (a.price - a.cost) / a.price : 0;
        const mB = b.price > 0 ? (b.price - b.cost) / b.price : 0;
        cmp = mA - mB;
      } else if (sortBy === 'stock') {
        cmp = a.stock - b.stock;
      } else {
        cmp = (a.updatedAt || '').localeCompare(b.updatedAt || '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [
    products,
    statusFilter,
    categoryFilter,
    stockFilter,
    lowStockThreshold,
    queryText,
    sortBy,
    sortDir,
    effectiveConfig,
  ]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  // Modal Form State
  const [formState, setFormState] = useState<{
    name: string;
    sku: string;
    category: string;
    currency: CurrencyCode;
    price: string;
    cost: string;
    stock: string;
    status: ProductStatus;
    imageKey: ProductImageKey;
    description: string;
  }>({
    name: '',
    sku: '',
    category: 'Audio Gear',
    currency: defaultProductCurrency,
    price: '0',
    cost: '0',
    stock: '0',
    status: 'active',
    imageKey: 'none',
    description: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const skipNextResetRef = useRef(false);
  const prevModalOpenRef = useRef(false);

  const openForCreate = () => {
    setEditingProduct(null);
    skipNextResetRef.current = true;
    setFormState({
      name: '',
      sku: `ZNR-${Math.floor(100 + Math.random() * 899)}`,
      category: categories[0] || 'General Goods',
      currency: defaultProductCurrency,
      price: '',
      cost: '',
      stock: '25',
      status: 'active',
      imageKey: 'none',
      description: '',
    });
    setFormError(null);
    onOpenCreateModal();
  };

  const openForDuplicate = (prod: Product) => {
    setInspectingProduct(null);
    setEditingProduct(null);
    skipNextResetRef.current = true;
    setFormState({
      name: `${prod.name} (Copy)`.slice(0, 120),
      sku: `${prod.sku}-${Math.floor(10 + Math.random() * 89)}`.slice(0, 40),
      category: prod.category,
      currency: resolveTransactionCurrency(prod.currency, effectiveConfig),
      price: String(prod.price),
      cost: String(prod.cost),
      stock: String(prod.stock),
      status: 'draft',
      imageKey: prod.imageKey,
      description: prod.description,
    });
    setFormError(null);
    onOpenCreateModal();
  };

  const openForEdit = (prod: Product) => {
    setInspectingProduct(null);
    setEditingProduct(prod);
    setFormState({
      name: prod.name,
      sku: prod.sku,
      category: prod.category,
      currency: resolveTransactionCurrency(prod.currency, effectiveConfig),
      price: String(prod.price),
      cost: String(prod.cost),
      stock: String(prod.stock),
      status: prod.status,
      imageKey: prod.imageKey,
      description: prod.description,
    });
    setFormError(null);
  };

  const modalVisible = isCreateModalOpen || editingProduct !== null;

  const closeModal = () => {
    setEditingProduct(null);
    setFormError(null);
    onCloseCreateModal();
  };

  // Reset form cleanly when Create modal is triggered externally (e.g. from Dashboard)
  useEffect(() => {
    const justOpened = isCreateModalOpen && !prevModalOpenRef.current;
    prevModalOpenRef.current = isCreateModalOpen;

    if (justOpened && !editingProduct) {
      if (skipNextResetRef.current) {
        skipNextResetRef.current = false;
        return;
      }
      setFormState({
        name: '',
        sku: `ZNR-${Math.floor(100 + Math.random() * 899)}`,
        category: categories[0] || 'General Goods',
        currency: defaultProductCurrency,
        price: '',
        cost: '',
        stock: '25',
        status: 'active',
        imageKey: 'none',
        description: '',
      });
      setFormError(null);
    }
  }, [isCreateModalOpen, editingProduct, categories, defaultProductCurrency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formState.name.trim();
    const sku = formState.sku.trim();
    const category = formState.category.trim() || 'General';
    const price = Number(formState.price);
    const cost = Number(formState.cost || 0);
    const stock = Math.max(0, Math.round(Number(formState.stock || 0)));

    if (!name || name.length > 120) {
      setFormError(t('productErrNameLen'));
      return;
    }
    if (!sku || sku.length > 40) {
      setFormError(t('productErrSkuLen'));
      return;
    }
    const duplicateSku = products.some(
      (p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== editingProduct?.id
    );
    if (duplicateSku) {
      setFormError(t('productErrSkuDup', { sku }));
      return;
    }
    if (!Number.isFinite(price) || price < 0 || price > 10000000) {
      setFormError(t('productErrPriceRange'));
      return;
    }
    if (!Number.isFinite(cost) || cost < 0 || cost > 10000000) {
      setFormError(t('productErrCostRange'));
      return;
    }
    if (!Number.isFinite(stock) || stock < 0 || stock > 10000000) {
      setFormError(t('productErrStockRange'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const isNew = editingProduct === null;
      const payload: Product = {
        id: isNew ? createSafeId('prod') : editingProduct.id,
        ownerId,
        name: name.slice(0, 120),
        sku: sku.slice(0, 40),
        category: category.slice(0, 60),
        currency: formState.currency,
        price: Number(price.toFixed(2)),
        cost: Number(cost.toFixed(2)),
        stock,
        status: formState.status,
        imageKey: formState.imageKey,
        description: formState.description.trim().slice(0, 500),
        createdAt: editingProduct?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await onSaveProduct(payload, isNew);
      closeModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save product.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (prod: Product, nextStatus: ProductStatus) => {
    if (prod.status === nextStatus) return;
    const updated: Product = {
      ...prod,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };
    await onSaveProduct(updated, false);
    if (inspectingProduct?.id === prod.id) {
      setInspectingProduct(updated);
    }
  };

  const previewPrice = Number(formState.price) || 0;
  const previewCost = Number(formState.cost) || 0;
  const previewProfit = previewPrice - previewCost;
  const previewMargin = previewPrice > 0 ? (previewProfit / previewPrice) * 100 : 0;
  const previewImgSrc = getProductImageSrc(formState.imageKey);

  const modalCurrencyOptions: CurrencyCode[] = SUPPORTED_CURRENCIES.includes(formState.currency)
    ? SUPPORTED_CURRENCIES
    : [...SUPPORTED_CURRENCIES, formState.currency];

  const renderApproxPrice = (amount: number, recordCurrency?: CurrencyCode) => {
    const srcCurr = resolveTransactionCurrency(recordCurrency, effectiveConfig);
    if (srcCurr === reportingCurrency) return null;
    const conv = resolveReportingAmount({
      amount,
      recordCurrency,
      config: effectiveConfig,
    });
    if (!conv.ok) return null;
    return (
      <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
        {t('approxConverted', {
          value: formatCurrency(conv.amount, reportingCurrency, 2, language),
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('productsCatalogTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('productsCatalogSubtitle', { count: formatNumber(products.length, language) })}
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#0B1328] border border-slate-200 dark:border-slate-800/80"
            role="group"
            aria-label="Catalog view mode"
          >
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Table view"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <LayoutList className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={openForCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('addProduct')}
          </button>
        </div>
      </div>

      {catalogSummary.unconvertedCount > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          {t('unconvertedBanner', { count: catalogSummary.unconvertedCount })}
        </div>
      )}

      {/* Catalog Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('totalCatalogSkus')}
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatNumber(products.length, language)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('activeDraftCount', {
              active: catalogSummary.activeCount,
              draft: catalogSummary.draftCount,
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('avgGrossMargin')}
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
            {catalogSummary.avgMargin.toFixed(1)}%
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('acrossCategories', { count: categories.length })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('catalogRetailValue')}
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {formatCurrency(catalogSummary.retailValue, reportingCurrency, 2, language)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {t('costBasisValue', {
              value: formatCurrency(catalogSummary.costValue, reportingCurrency, 2, language),
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setStockFilter((prev) => (prev === 'low' ? 'all' : 'low'))
          }
          className="text-start rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 hover:border-amber-500/40 transition-colors cursor-pointer"
        >
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('stockHealthAlerts')}
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {t('skusCount', { count: catalogSummary.lowCount + catalogSummary.outCount })}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('lowOutCount', {
              low: catalogSummary.lowCount,
              out: catalogSummary.outCount,
            })}
          </div>
        </button>
      </div>

      {/* Filters Bar */}
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
            placeholder={t('searchProductsPlaceholder')}
            className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800">
            {(['all', 'active', 'draft', 'archived'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === status
                    ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {status === 'all' ? t('all') : tProductStatus(status)}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label={t('allCategories')}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="all">{t('allCategories')}</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as StockFilter)}
            aria-label={t('allStockLevels')}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="all">{t('allStockLevels')}</option>
            <option value="in">{t('healthyStock')}</option>
            <option value="low">{t('lowStockFilter', { threshold: lowStockThreshold })}</option>
            <option value="out">{t('outOfStock')}</option>
          </select>

          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split(':') as [SortField, 'asc' | 'desc'];
              setSortBy(field);
              setSortDir(dir);
            }}
            aria-label={t('sortRecentlyUpdated')}
            className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option value="updated:desc">{t('sortRecentlyUpdated')}</option>
            <option value="name:asc">{t('sortNameAz')}</option>
            <option value="price:desc">{t('sortPriceHighLow')}</option>
            <option value="price:asc">{t('sortPriceLowHigh')}</option>
            <option value="margin:desc">{t('sortMarginHigh')}</option>
            <option value="stock:asc">{t('sortStockLowFirst')}</option>
          </select>
        </div>
      </div>

      {/* Product Catalog Content (Table or Grid) */}
      {filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] py-16 px-6 text-center space-y-3">
          <Package className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {products.length === 0 ? t('catalogEmptyTitle') : t('catalogNoMatchTitle')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {products.length === 0 ? t('catalogEmptyDesc') : t('catalogNoMatchDesc')}
          </p>
          <div className="flex items-center justify-center gap-2.5 pt-1">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {t('resetFilters')}
              </button>
            )}
            <button
              type="button"
              onClick={openForCreate}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
            >
              {t('addProduct')}
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.map((prod) => {
            const imgSrc = getProductImageSrc(prod.imageKey);
            const marginPct = prod.price > 0 ? ((prod.price - prod.cost) / prod.price) * 100 : 0;
            const isOut = prod.stock === 0;
            const isLow = prod.stock > 0 && prod.stock <= lowStockThreshold;
            const prodCurrency = resolveTransactionCurrency(prod.currency, effectiveConfig);
            return (
              <div
                key={prod.id}
                onClick={() => setInspectingProduct(prod)}
                className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden hover:border-blue-500/40 transition-colors flex flex-col cursor-pointer"
              >
                <div className="aspect-[4/3] bg-slate-100 dark:bg-[#070D1D] flex items-center justify-center overflow-hidden border-b border-slate-100 dark:border-slate-800/80">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={prod.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="w-10 h-10 text-slate-400" aria-hidden="true" />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{prod.sku}</span>
                      <span
                        className={`font-medium ${
                          prod.status === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : prod.status === 'draft'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {tProductStatus(prod.status)}
                      </span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {prod.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {prod.category}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/70 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {formatCurrency(prod.price, prodCurrency, 2, language)}
                      </div>
                      {renderApproxPrice(prod.price, prod.currency)}
                      <div className="text-[11px] font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                        {t('marginLabel', { pct: marginPct.toFixed(1) })} ·{' '}
                        <span
                          className={
                            isOut
                              ? 'text-rose-600 dark:text-rose-400'
                              : isLow
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          {t('inStockLabel', { count: formatNumber(prod.stock, language) })}
                        </span>
                      </div>
                    </div>

                    <div
                      className="inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => openForEdit(prod)}
                        aria-label={`${t('edit')} ${prod.name}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingProduct(prod)}
                        aria-label={`${t('delete')} ${prod.name}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      {t('colProduct')}
                      <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="py-3 px-4">{t('colSku')}</th>
                  <th className="py-3 px-4">{t('colCategory')}</th>
                  <th className="py-3 px-4">{t('colStatus')}</th>
                  <th className="py-3 px-4 text-end">
                    <button
                      type="button"
                      onClick={() => toggleSort('price')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      {t('colPrice')}
                      <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-end">{t('colCost')}</th>
                  <th className="py-3 px-4 text-end">
                    <button
                      type="button"
                      onClick={() => toggleSort('margin')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      {t('colMargin')}
                      <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-end">
                    <button
                      type="button"
                      onClick={() => toggleSort('stock')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      {t('colStock')}
                      <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-end">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {filteredProducts.map((prod) => {
                  const imgSrc = getProductImageSrc(prod.imageKey);
                  const marginPct = prod.price > 0 ? ((prod.price - prod.cost) / prod.price) * 100 : 0;
                  const isOut = prod.stock === 0;
                  const isLow = prod.stock > 0 && prod.stock <= lowStockThreshold;
                  const prodCurrency = resolveTransactionCurrency(prod.currency, effectiveConfig);
                  return (
                    <tr
                      key={prod.id}
                      onClick={() => setInspectingProduct(prod)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
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
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[220px]">
                              {prod.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                              {prod.description || t('noDescription')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {prod.sku}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{prod.category}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-medium ${
                            prod.status === 'active'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : prod.status === 'draft'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {tProductStatus(prod.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        <div>{formatCurrency(prod.price, prodCurrency, 2, language)}</div>
                        {renderApproxPrice(prod.price, prod.currency)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatCurrency(prod.cost, prodCurrency, 2, language)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-medium text-cyan-600 dark:text-cyan-400">
                        {marginPct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums">
                        <span
                          className={
                            isOut
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : isLow
                              ? 'text-amber-600 dark:text-amber-400 font-semibold'
                              : 'text-slate-900 dark:text-slate-100'
                          }
                        >
                          {formatNumber(prod.stock, language)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectingProduct(prod)}
                            aria-label={`${prod.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-cyan-600 dark:text-slate-400 dark:hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForDuplicate(prod)}
                            aria-label={`${t('duplicate')} ${prod.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-purple-600 dark:text-slate-400 dark:hover:text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openForEdit(prod)}
                            aria-label={`${t('edit')} ${prod.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingProduct(prod)}
                            aria-label={`${t('delete')} ${prod.name}`}
                            className="p-2 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
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
        </div>
      )}

      {/* Inspect Product Modal */}
      {inspectingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            {(() => {
              const inspCurr = resolveTransactionCurrency(
                inspectingProduct.currency,
                effectiveConfig
              );
              return (
                <>
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                        {inspectingProduct.name}
                      </h2>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {inspectingProduct.sku} · {inspectingProduct.category} · {inspCurr}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectingProduct(null)}
                      aria-label={t('close')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
                    <div className="flex flex-col sm:flex-row gap-4 items-start">
                      <div className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#070D1D] flex items-center justify-center shrink-0">
                        {getProductImageSrc(inspectingProduct.imageKey) ? (
                          <img
                            src={getProductImageSrc(inspectingProduct.imageKey)!}
                            alt={inspectingProduct.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-8 h-8 text-slate-400" aria-hidden="true" />
                        )}
                      </div>
                      <div className="space-y-2 flex-1 text-xs">
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          {inspectingProduct.description || t('noProductDesc')}
                        </p>
                        {inspectingProduct.stock <= lowStockThreshold && (
                          <div className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                            {inspectingProduct.stock === 0
                              ? t('outOfStock')
                              : t('lowStockRem', { count: inspectingProduct.stock })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">{t('sellingPriceLabel')}</span>
                        <div className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(inspectingProduct.price, inspCurr, 2, language)}
                        </div>
                        {renderApproxPrice(inspectingProduct.price, inspectingProduct.currency)}
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">{t('unitCostLabel')}</span>
                        <div className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                          {formatCurrency(inspectingProduct.cost, inspCurr, 2, language)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">{t('unitGrossProfit')}</span>
                        <div className="mt-0.5 font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                          {formatCurrency(
                            inspectingProduct.price - inspectingProduct.cost,
                            inspCurr,
                            2,
                            language
                          )}{' '}
                          (
                          {(inspectingProduct.price > 0
                            ? ((inspectingProduct.price - inspectingProduct.cost) /
                                inspectingProduct.price) *
                              100
                            : 0
                          ).toFixed(1)}
                          %)
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">{t('stockOnHandValue')}</span>
                        <div className="mt-0.5 font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                          {formatCurrency(
                            inspectingProduct.stock * inspectingProduct.price,
                            inspCurr,
                            2,
                            language
                          )}{' '}
                          ({t('unitsCountText', { count: formatNumber(inspectingProduct.stock, language) })})
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {t('catalogStatusLabel')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['active', 'draft', 'archived'] as ProductStatus[]).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => handleQuickStatusChange(inspectingProduct, st)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                              inspectingProduct.status === st
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/40'
                            }`}
                          >
                            {tProductStatus(st)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => openForDuplicate(inspectingProduct)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('duplicate')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openForEdit(inspectingProduct)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('editProduct')}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {editingProduct ? t('editProduct') : t('addNewProduct')}
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

            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              {formError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('productNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={formState.name}
                    onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    placeholder={t('productNamePlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('colSku')}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={formState.sku}
                    onChange={(e) => setFormState({ ...formState, sku: e.target.value })}
                    placeholder="ZNR-001"
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('colCategory')}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                    placeholder="Audio Gear"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('productCurrencyLabel')}
                  </label>
                  <select
                    value={formState.currency}
                    onChange={(e) =>
                      setFormState({ ...formState, currency: e.target.value as CurrencyCode })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    {modalCurrencyOptions.map((c) => (
                      <option key={c} value={c}>
                        {getCurrencyLabel(c, language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('colStatus')}
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as ProductStatus })
                    }
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    <option value="active">{tProductStatus('active')}</option>
                    <option value="draft">{tProductStatus('draft')}</option>
                    <option value="archived">{tProductStatus('archived')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('sellingPriceLabel')} ({formState.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="10000000"
                    required
                    value={formState.price}
                    onChange={(e) => setFormState({ ...formState, price: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('unitCostLabel')} ({formState.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="10000000"
                    required
                    value={formState.cost}
                    onChange={(e) => setFormState({ ...formState, cost: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('stockUnitsLabel')}
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="10000000"
                    required
                    value={formState.stock}
                    onChange={(e) => setFormState({ ...formState, stock: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('productThumbnailLabel')}
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#070D1D] flex items-center justify-center shrink-0">
                      {previewImgSrc ? (
                        <img
                          src={previewImgSrc}
                          alt="Selected preset preview"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      )}
                    </div>
                    <select
                      value={formState.imageKey}
                      onChange={(e) =>
                        setFormState({ ...formState, imageKey: e.target.value as ProductImageKey })
                      }
                      className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      {imageOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('descriptionLabel')}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={formState.description}
                    onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                    placeholder={t('descriptionPlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
                  />
                </div>
              </div>

              {/* Live unit margin summary */}
              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 text-xs">
                <span className="text-slate-600 dark:text-slate-400">{t('unitGrossProfit')}</span>
                <span className="font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                  {formatCurrency(previewProfit, formState.currency, 2, language)} (
                  {previewMargin.toFixed(1)}%)
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {saving ? t('saving') : editingProduct ? t('saveChanges') : t('createProduct')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {t('deleteProductTitle')}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t('deleteProductPrompt', {
                name: deletingProduct.name,
                sku: deletingProduct.sku,
              })}
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = deletingProduct;
                  setDeletingProduct(null);
                  if (inspectingProduct?.id === target.id) {
                    setInspectingProduct(null);
                  }
                  await onDeleteProduct(target);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
