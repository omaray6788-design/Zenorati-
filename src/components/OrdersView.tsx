import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  History,
  Loader2,
  Mail,
  MapPin,
  Minus,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import type {
  CurrencyCode,
  CurrencyConfig,
  Customer,
  Order,
  OrderChannel,
  OrderHistoryEntry,
  OrderStatus,
  Product,
} from '../types/zenorati';
import {
  createSafeId,
  formatCurrency,
  formatDateShort,
  formatNumber,
  formatRelativeTime,
  getTodayIsoDate,
  ORDER_STATUS_META,
} from '../utils/formatters';
import {
  buildCurrencyConfig,
  convertCurrencyAmount,
  formatConversionDirection,
  getCurrencyLabel,
  getCurrencySymbol,
  resolveReportingAmount,
  resolveTransactionCurrency,
  SUPPORTED_CURRENCIES,
} from '../utils/currency';
import {
  buildHistoryEntry,
  calculateOrderFinancials,
  computeOrderStockPlan,
  generateUniqueOrderNumber,
  getVariantOptionsForProduct,
  inferStockDeducted,
  isConfirmedStatus,
  isRestoredStatus,
  ORDER_CHANNEL_LIST,
  ORDER_STATUS_LIST,
  type DiscountMode,
  type LineItemDraft,
} from '../utils/orderHelpers';
import { isDemoCustomer } from '../utils/customerHelpers';
import { useI18n } from '../i18n/I18nContext';

interface OrdersViewProps {
  orders: Order[];
  products: Product[];
  customers: Customer[];
  ownerId: string;
  currency: CurrencyCode;
  currencyConfig?: CurrencyConfig;
  defaultTaxRate: number;
  globalSearch: string;
  onCreateOrder: (
    order: Order,
    stockUpdates: Array<{ product: Product; nextStock: number }>
  ) => Promise<void>;
  onUpdateOrder: (
    previousOrder: Order,
    updatedOrder: Order,
    stockUpdates: Array<{ product: Product; nextStock: number }>,
    historyEntry: OrderHistoryEntry
  ) => Promise<void>;
  onUpdateOrderStatus: (order: Order, nextStatus: OrderStatus) => Promise<Order>;
  onDeleteOrder: (order: Order) => Promise<void>;
  isCreateModalOpen: boolean;
  onOpenCreateModal: () => void;
  onCloseCreateModal: () => void;
  selectedOrder: Order | null;
  onSelectOrder: (order: Order | null) => void;
}

type OrderSortOption = 'newest' | 'oldest' | 'highest' | 'lowest';

function renderStatusIcon(status: OrderStatus) {
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

export const OrdersView: React.FC<OrdersViewProps> = ({
  orders,
  products,
  customers,
  ownerId,
  currency,
  currencyConfig,
  defaultTaxRate,
  globalSearch,
  onCreateOrder,
  onUpdateOrder,
  onUpdateOrderStatus,
  onDeleteOrder,
  isCreateModalOpen,
  onOpenCreateModal,
  onCloseCreateModal,
  selectedOrder,
  onSelectOrder,
}) => {
  const { language, t, tOrderStatus, tChannel } = useI18n();
  const effectiveConfig = useMemo(
    () => currencyConfig ?? buildCurrencyConfig({ currency, language }),
    [currencyConfig, currency, language]
  );
  const reportingCurrency = effectiveConfig.reportingCurrency;
  const defaultOrderCurrency: CurrencyCode =
    reportingCurrency === 'EGP' || reportingCurrency === 'USD'
      ? reportingCurrency
      : 'USD';

  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | OrderChannel>('all');
  const [sortBy, setSortBy] = useState<OrderSortOption>('newest');

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  // Form modal state (shared for Create and Edit)
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [orderNumberPreview, setOrderNumberPreview] = useState('');
  const [customerId, setCustomerId] = useState<string>('custom');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [channel, setChannel] = useState<OrderChannel>('Direct Store');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('pending');
  const [orderCurrency, setOrderCurrency] = useState<CurrencyCode>(defaultOrderCurrency);
  const [orderDate, setOrderDate] = useState(getTodayIsoDate());
  const [shippingCost, setShippingCost] = useState('12');
  const [discountMode, setDiscountMode] = useState<DiscountMode>('fixed');
  const [discountValue, setDiscountValue] = useState('0');
  const [applyTax, setApplyTax] = useState(true);
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  const [customVariantRows, setCustomVariantRows] = useState<Record<number, boolean>>({});

  const isFormOpen = isCreateModalOpen || editingOrder !== null;

  const initCreateForm = React.useCallback(() => {
    setFormError(null);
    setOrderNumberPreview(generateUniqueOrderNumber(orders));
    setOrderDate(getTodayIsoDate());
    setChannel('Direct Store');
    setOrderStatus('pending');
    setOrderCurrency(defaultOrderCurrency);
    setShippingCost(defaultOrderCurrency === 'EGP' ? '60' : '12');
    setDiscountMode('fixed');
    setDiscountValue('0');
    setApplyTax(true);
    setNotes('');
    setCustomVariantRows({});

    setCustomerId('custom');
    setCustomerName('');
    setCustomerEmail('');
    setCustomerPhone('');
    setShippingAddress('');

    if (products.length > 0) {
      const firstProd = products.find((p) => p.stock > 0) ?? products[0];
      const presets = getVariantOptionsForProduct(firstProd);
      setLineItems([
        {
          productId: firstProd.id,
          variant: presets[0] ?? 'Standard',
          quantity: 1,
        },
      ]);
    } else {
      setLineItems([]);
    }
  }, [orders, products, defaultOrderCurrency]);

  React.useEffect(() => {
    if (isCreateModalOpen && !editingOrder) {
      initCreateForm();
    }
  }, [isCreateModalOpen, editingOrder, initCreateForm]);

  const openEditModal = (order: Order) => {
    if (order.status === 'cancelled' || order.status === 'returned') return;
    setFormError(null);
    setEditingOrder(order);
    setOrderNumberPreview(order.orderNumber);
    const matchingCustomer = customers.find((c) => c.id === order.customerId);
    setCustomerId(matchingCustomer ? matchingCustomer.id : 'custom');
    setCustomerName(order.customerName);
    setCustomerEmail(order.customerEmail);
    setCustomerPhone(order.customerPhone || '');
    setShippingAddress(order.shippingAddress || '');
    setChannel(order.channel);
    setOrderStatus(order.status);
    setOrderCurrency(resolveTransactionCurrency(order.currency, effectiveConfig));
    setOrderDate(order.orderDate);
    setShippingCost(String(order.shippingCost));
    setDiscountMode('fixed');
    setDiscountValue(String(order.discountAmount ?? 0));
    setApplyTax(order.taxAmount > 0);
    setNotes(order.notes || '');

    const customFlags: Record<number, boolean> = {};
    const draftLines: LineItemDraft[] = (order.items ?? []).map((it, idx) => {
      const prod = products.find((p) => p.id === it.productId);
      const presets = getVariantOptionsForProduct(prod);
      const variant = it.variant || 'Standard';
      if (!presets.includes(variant)) {
        customFlags[idx] = true;
      }
      return {
        id: it.id,
        productId: it.productId,
        variant,
        quantity: it.quantity,
      };
    });
    setCustomVariantRows(customFlags);
    setLineItems(
      draftLines.length > 0
        ? draftLines
        : products.length > 0
        ? [
            {
              productId: products[0].id,
              variant: getVariantOptionsForProduct(products[0])[0] ?? 'Standard',
              quantity: 1,
            },
          ]
        : []
    );
  };

  const closeFormModal = () => {
    setEditingOrder(null);
    setFormError(null);
    onCloseCreateModal();
  };

  const handleCustomerSelect = (val: string) => {
    setCustomerId(val);
    if (val === 'custom') {
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setShippingAddress('');
      return;
    }
    const found = customers.find((c) => c.id === val);
    if (found) {
      setCustomerName(found.name);
      setCustomerEmail(found.email);
      setCustomerPhone(found.phone || '');
      setShippingAddress(found.location || '');
    }
  };

  const calculatedOrder = useMemo(
    () =>
      calculateOrderFinancials({
        lineItems,
        products,
        ownerId,
        discountMode,
        discountValue: Number(discountValue) || 0,
        shippingCost: Number(shippingCost) || 0,
        applyTax,
        taxRate: defaultTaxRate,
        orderCurrency,
        currencyContext: effectiveConfig,
        usdToEgpRate: effectiveConfig.usdToEgpRate,
      }),
    [
      lineItems,
      products,
      ownerId,
      discountMode,
      discountValue,
      shippingCost,
      applyTax,
      defaultTaxRate,
      orderCurrency,
      effectiveConfig,
    ]
  );

  // Stock preview inside modal so merchant knows remaining / max allowed per product
  const modalStockPlan = useMemo(
    () =>
      computeOrderStockPlan({
        products,
        previousOrder: editingOrder,
        nextItems: calculatedOrder.items,
        nextStatus: orderStatus,
      }),
    [products, editingOrder, calculatedOrder.items, orderStatus]
  );

  // Keep selectedOrder synchronized with latest state from orders prop
  const activeSelectedOrder = useMemo(() => {
    if (!selectedOrder) return null;
    return orders.find((o) => o.id === selectedOrder.id) ?? selectedOrder;
  }, [selectedOrder, orders]);

  // Summary KPIs using safe reporting-currency resolution (never mixes incompatible currencies raw)
  const orderSummary = useMemo(() => {
    let activeCount = 0;
    let pendingCount = 0;
    let processingCount = 0;
    let shippedCount = 0;
    let deliveredCount = 0;
    let cancelledCount = 0;
    let returnedCount = 0;
    let activeRevenue = 0;
    let totalDiscounts = 0;
    let unconvertedCount = 0;

    for (const o of orders) {
      if (o.status === 'pending') pendingCount += 1;
      if (o.status === 'processing') processingCount += 1;
      if (o.status === 'shipped') shippedCount += 1;
      if (o.status === 'delivered') deliveredCount += 1;
      if (o.status === 'cancelled') cancelledCount += 1;
      if (o.status === 'returned') returnedCount += 1;

      if (!isRestoredStatus(o.status)) {
        activeCount += 1;
        const revRes = resolveReportingAmount({
          amount: Math.max(0, Number(o.totalAmount) || 0),
          recordCurrency: o.currency,
          recordedExchangeRate: o.exchangeRate,
          recordedConvertedAmount: o.convertedAmount,
          recordedReportingCurrency: o.reportingCurrency,
          config: effectiveConfig,
        });
        if (revRes.ok) {
          activeRevenue += revRes.amount;
          totalDiscounts += (o.discountAmount ?? 0) * revRes.multiplier;
        } else {
          unconvertedCount += 1;
        }
      }
    }

    return {
      activeCount,
      pendingCount,
      processingCount,
      shippedCount,
      deliveredCount,
      cancelledCount,
      returnedCount,
      activeRevenue: Number(activeRevenue.toFixed(2)),
      totalDiscounts: Number(totalDiscounts.toFixed(2)),
      unconvertedCount,
    };
  }, [orders, effectiveConfig]);

  const statusCounts = useMemo(() => {
    const counts: Record<'all' | OrderStatus, number> = {
      all: orders.length,
      pending: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      returned: 0,
    };
    for (const o of orders) {
      counts[o.status] += 1;
    }
    return counts;
  }, [orders]);

  const queryText = (localSearch || globalSearch).trim().toLowerCase();

  const filteredOrders = useMemo(() => {
    const filtered = orders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (channelFilter !== 'all' && o.channel !== channelFilter) return false;
      if (!queryText) return true;
      const itemMatch = (o.items ?? []).some(
        (it) =>
          it.sku.toLowerCase().includes(queryText) ||
          it.productName.toLowerCase().includes(queryText) ||
          (it.variant || '').toLowerCase().includes(queryText)
      );
      return (
        itemMatch ||
        o.orderNumber.toLowerCase().includes(queryText) ||
        o.customerName.toLowerCase().includes(queryText) ||
        o.customerEmail.toLowerCase().includes(queryText) ||
        (o.customerPhone || '').toLowerCase().includes(queryText) ||
        (o.shippingAddress || '').toLowerCase().includes(queryText) ||
        o.itemsSummary.toLowerCase().includes(queryText)
      );
    });

    const getComparableTotal = (o: Order) => {
      const res = resolveReportingAmount({
        amount: o.totalAmount,
        recordCurrency: o.currency,
        recordedExchangeRate: o.exchangeRate,
        recordedConvertedAmount: o.convertedAmount,
        recordedReportingCurrency: o.reportingCurrency,
        config: effectiveConfig,
      });
      return res.ok ? res.amount : o.totalAmount;
    };

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === 'oldest') {
        return a.orderDate.localeCompare(b.orderDate) || a.orderNumber.localeCompare(b.orderNumber);
      }
      if (sortBy === 'highest') {
        return getComparableTotal(b) - getComparableTotal(a);
      }
      if (sortBy === 'lowest') {
        return getComparableTotal(a) - getComparableTotal(b);
      }
      return b.orderDate.localeCompare(a.orderDate) || b.orderNumber.localeCompare(a.orderNumber);
    });
    return sorted;
  }, [orders, statusFilter, channelFilter, queryText, sortBy, effectiveConfig]);

  const hasActiveFilters =
    localSearch.trim() !== '' ||
    statusFilter !== 'all' ||
    channelFilter !== 'all' ||
    sortBy !== 'newest';

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerEmail.trim()) {
      setFormError(t('errCustomerReq'));
      return;
    }
    if (calculatedOrder.conversionError) {
      setFormError(calculatedOrder.conversionError);
      return;
    }
    if (calculatedOrder.items.length === 0) {
      setFormError(t('errLineItemReq'));
      return;
    }

    if (!modalStockPlan.ok) {
      setFormError(modalStockPlan.error);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    const nowIso = new Date().toISOString();

    const reportingConv = convertCurrencyAmount(
      calculatedOrder.totalAmount,
      orderCurrency,
      reportingCurrency,
      effectiveConfig.usdToEgpRate
    );

    try {
      if (editingOrder) {
        const prevDeducted = inferStockDeducted(editingOrder);
        let histTitle = 'Order details updated';
        if (!prevDeducted && modalStockPlan.nextStockDeducted) {
          histTitle = `Order confirmed (${orderStatus}) & stock deducted`;
        } else if (prevDeducted && !modalStockPlan.nextStockDeducted) {
          histTitle = `Order ${orderStatus} & stock restored`;
        } else if (modalStockPlan.stockUpdates.length > 0) {
          histTitle = 'Order edited & stock adjusted';
        }
        const historyEntry = buildHistoryEntry(
          ownerId,
          orderStatus,
          histTitle,
          `${calculatedOrder.itemCount} item(s) · Total ${formatCurrency(
            calculatedOrder.totalAmount,
            orderCurrency,
            2,
            language
          )}`
        );

        const {
          exchangeRate: _oldRate,
          convertedAmount: _oldConverted,
          rateSource: _oldSource,
          conversionDirection: _oldDir,
          ratePublicationDate: _oldPubDate,
          rateTimestamp: _oldTs,
          ...baseEditingOrder
        } = editingOrder;

        const updatedOrder: Order = {
          ...baseEditingOrder,
          customerId:
            customerId === 'custom' ? editingOrder.customerId || createSafeId('cust') : customerId,
          customerName: customerName.trim().slice(0, 120),
          customerEmail: customerEmail.trim().slice(0, 160),
          customerPhone: customerPhone.trim().slice(0, 40),
          shippingAddress: shippingAddress.trim().slice(0, 240),
          status: orderStatus,
          channel,
          currency: orderCurrency,
          reportingCurrency,
          ...(reportingConv.ok
            ? {
                exchangeRate: reportingConv.exchangeRate,
                convertedAmount: reportingConv.amount,
                conversionDirection: formatConversionDirection(orderCurrency, reportingCurrency),
                rateTimestamp: nowIso,
                ...(effectiveConfig.rateSource ? { rateSource: effectiveConfig.rateSource } : {}),
                ...(effectiveConfig.cbePublicationDate
                  ? { ratePublicationDate: effectiveConfig.cbePublicationDate }
                  : {}),
              }
            : {}),
          subtotal: calculatedOrder.subtotal,
          discountAmount: calculatedOrder.discountAmount,
          taxAmount: calculatedOrder.taxAmount,
          shippingCost: calculatedOrder.shippingCost,
          totalAmount: calculatedOrder.totalAmount,
          totalCost: calculatedOrder.totalCost,
          itemCount: calculatedOrder.itemCount,
          itemsSummary: calculatedOrder.itemsSummary,
          orderDate,
          notes: notes.trim().slice(0, 500),
          stockDeducted: modalStockPlan.nextStockDeducted,
          items: calculatedOrder.items,
          updatedAt: nowIso,
        };

        await onUpdateOrder(
          editingOrder,
          updatedOrder,
          modalStockPlan.stockUpdates,
          historyEntry
        );
      } else {
        const orderNumber = generateUniqueOrderNumber(orders);
        const initialHistory = buildHistoryEntry(
          ownerId,
          orderStatus,
          modalStockPlan.nextStockDeducted
            ? `Order created (${orderStatus}) & stock deducted`
            : 'Order created (Pending confirmation)',
          `${calculatedOrder.itemCount} item(s) · Total ${formatCurrency(
            calculatedOrder.totalAmount,
            orderCurrency,
            2,
            language
          )}`
        );

        const newOrder: Order = {
          id: createSafeId('ord'),
          ownerId,
          orderNumber,
          customerId: customerId === 'custom' ? createSafeId('cust') : customerId,
          customerName: customerName.trim().slice(0, 120),
          customerEmail: customerEmail.trim().slice(0, 160),
          customerPhone: customerPhone.trim().slice(0, 40),
          shippingAddress: shippingAddress.trim().slice(0, 240),
          status: orderStatus,
          channel,
          currency: orderCurrency,
          reportingCurrency,
          ...(reportingConv.ok
            ? {
                exchangeRate: reportingConv.exchangeRate,
                convertedAmount: reportingConv.amount,
                conversionDirection: formatConversionDirection(orderCurrency, reportingCurrency),
                rateTimestamp: nowIso,
                ...(effectiveConfig.rateSource ? { rateSource: effectiveConfig.rateSource } : {}),
                ...(effectiveConfig.cbePublicationDate
                  ? { ratePublicationDate: effectiveConfig.cbePublicationDate }
                  : {}),
              }
            : {}),
          subtotal: calculatedOrder.subtotal,
          discountAmount: calculatedOrder.discountAmount,
          taxAmount: calculatedOrder.taxAmount,
          shippingCost: calculatedOrder.shippingCost,
          totalAmount: calculatedOrder.totalAmount,
          totalCost: calculatedOrder.totalCost,
          itemCount: calculatedOrder.itemCount,
          itemsSummary: calculatedOrder.itemsSummary,
          orderDate,
          notes: notes.trim().slice(0, 500),
          stockDeducted: modalStockPlan.nextStockDeducted,
          items: calculatedOrder.items,
          history: [initialHistory],
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        await onCreateOrder(newOrder, modalStockPlan.stockUpdates);
      }
      closeFormModal();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('errOrderSave'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (order: Order, nextStatus: OrderStatus, inModal = false) => {
    if (order.status === nextStatus) return;
    setActionError(null);
    setDetailError(null);
    setStatusUpdatingId(order.id);
    try {
      const updated = await onUpdateOrderStatus(order, nextStatus);
      if (activeSelectedOrder?.id === order.id) {
        onSelectOrder(updated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errOrderSave');
      if (inModal) {
        setDetailError(message);
      } else {
        setActionError(message);
      }
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleDeleteConfirmed = async (order: Order) => {
    setActionError(null);
    setDetailError(null);
    try {
      await onDeleteOrder(order);
      setConfirmDeleteId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errOrderSave');
      setActionError(message);
    }
  };

  const currencySelectOptions: CurrencyCode[] = SUPPORTED_CURRENCIES.includes(orderCurrency)
    ? SUPPORTED_CURRENCIES
    : [...SUPPORTED_CURRENCIES, orderCurrency];

  const selectedOrderCurrency = activeSelectedOrder
    ? resolveTransactionCurrency(activeSelectedOrder.currency, effectiveConfig)
    : reportingCurrency;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('ordersTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('ordersSubtitle', { count: formatNumber(orders.length, language) })}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          {t('newOrderBtn')}
        </button>
      </div>

      {/* Incompatible currency warning banner */}
      {orderSummary.unconvertedCount > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          {t('unconvertedBanner', { count: orderSummary.unconvertedCount })}
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('activeOrdersCard')}
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {formatNumber(orderSummary.activeCount, language)}
          </div>
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 font-mono tabular-nums">
            {t('awaitingConfirmation', { count: formatNumber(orderSummary.pendingCount, language) })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('activeOrderRevenueCard')}
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {formatCurrency(orderSummary.activeRevenue, reportingCurrency, 2, language)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {t('discountsGiven', {
              amount: formatCurrency(orderSummary.totalDiscounts, reportingCurrency, 2, language),
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('fulfillmentPipelineCard')}
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
            {t('deliveredCountText', { count: formatNumber(orderSummary.deliveredCount, language) })}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {t('processingShippedCount', {
              processing: formatNumber(orderSummary.processingCount, language),
              shipped: formatNumber(orderSummary.shippedCount, language),
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('cancelledReturnedCard')}
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
            {formatNumber(orderSummary.cancelledCount + orderSummary.returnedCount, language)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {t('cancelledReturnedCount', {
              cancelled: formatNumber(orderSummary.cancelledCount, language),
              returned: formatNumber(orderSummary.returnedCount, language),
            })}
          </div>
        </div>
      </div>

      {/* Inline Action Error Banner */}
      {actionError && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold underline shrink-0 cursor-pointer"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Search & Filters Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder={t('searchOrdersPlaceholder')}
              className="w-full ps-9 pe-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t('allChannels')}
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as 'all' | OrderChannel)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-800 dark:text-slate-200"
            >
              <option value="all">{t('allChannels')}</option>
              {ORDER_CHANNEL_LIST.map((ch) => (
                <option key={ch} value={ch}>
                  {tChannel(ch)}
                </option>
              ))}
            </select>

            <select
              aria-label={t('sortNewest')}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as OrderSortOption)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-800 dark:text-slate-200"
            >
              <option value="newest">{t('sortNewest')}</option>
              <option value="oldest">{t('sortOldest')}</option>
              <option value="highest">{t('sortHighest')}</option>
              <option value="lowest">{t('sortLowest')}</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setLocalSearch('');
                  setStatusFilter('all');
                  setChannelFilter('all');
                  setSortBy('newest');
                }}
                className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                {t('reset')}
              </button>
            )}
          </div>
        </div>

        <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 overflow-x-auto max-w-full">
          {(['all', ...ORDER_STATUS_LIST] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                statusFilter === st
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>{st === 'all' ? t('all') : tOrderStatus(st)}</span>
              <span
                className={`font-mono tabular-nums text-[11px] ${
                  statusFilter === st ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {formatNumber(statusCounts[st], language)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B1328] overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <ShoppingBag className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t('noOrdersMatch')}
            </p>
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors cursor-pointer"
            >
              {t('createOrder')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse min-w-[880px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#080F22]">
                  <th className="py-3 px-4">{t('colOrderNum')}</th>
                  <th className="py-3 px-4">{t('colCustomerContact')}</th>
                  <th className="py-3 px-4">{t('colItemsVariants')}</th>
                  <th className="py-3 px-4">{t('colDate')}</th>
                  <th className="py-3 px-4">{t('colStatus')}</th>
                  <th className="py-3 px-4 text-end">{t('colTotal')}</th>
                  <th className="py-3 px-4 text-end">{t('colEstProfit')}</th>
                  <th className="py-3 px-4 text-end">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {filteredOrders.map((order) => {
                  const statusMeta = ORDER_STATUS_META[order.status];
                  const isExcluded = isRestoredStatus(order.status);
                  const ordCurrency = resolveTransactionCurrency(order.currency, effectiveConfig);
                  const grossProfit = order.totalAmount - order.totalCost;
                  const stockAllocated = inferStockDeducted(order);
                  const isConfirmingDelete = confirmDeleteId === order.id;
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
                      onClick={() => {
                        setDetailError(null);
                        onSelectOrder(order);
                      }}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <div>{order.orderNumber}</div>
                        <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                          {ordCurrency}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {order.customerName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                          {tChannel(order.channel)} · {order.customerPhone || order.customerEmail}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-[260px]">
                        <div className="truncate">{order.itemsSummary}</div>
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                          {formatNumber(order.itemCount, language)}{' '}
                          {order.itemCount === 1 ? t('unitSingle') : t('unitPlural')}
                          {order.discountAmount > 0
                            ? ` · ${t('discShort')} -${formatCurrency(
                                order.discountAmount,
                                ordCurrency,
                                2,
                                language
                              )}`
                            : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatDateShort(order.orderDate, language)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className={`inline-flex items-center gap-1.5 font-medium ${statusMeta.textClass}`}>
                          {renderStatusIcon(order.status)}
                          {tOrderStatus(order.status)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                          {stockAllocated
                            ? t('stockDeducted')
                            : isExcluded
                            ? t('stockRestored')
                            : t('awaitingConfirm')}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <div>{formatCurrency(order.totalAmount, ordCurrency, 2, language)}</div>
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
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-cyan-600 dark:text-cyan-400 whitespace-nowrap">
                        {isExcluded
                          ? '—'
                          : formatCurrency(grossProfit, ordCurrency, 2, language)}
                      </td>
                      <td
                        className="py-3 px-4 text-end whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isConfirmingDelete ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDeleteConfirmed(order)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-600 text-white hover:bg-rose-500 cursor-pointer"
                            >
                              {t('confirm')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-lg text-[11px] font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              {t('keep')}
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {order.status === 'pending' && (
                              <button
                                type="button"
                                disabled={statusUpdatingId === order.id}
                                onClick={() => handleStatusChange(order, 'processing', false)}
                                title={t('confirmDeductStockBtn')}
                                aria-label={`${t('confirmBtn')} ${order.orderNumber}`}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {statusUpdatingId === order.id ? '...' : t('confirmBtn')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setDetailError(null);
                                onSelectOrder(order);
                              }}
                              aria-label={`${t('orderDetailsTitle', { num: order.orderNumber })}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {!isExcluded && (
                              <button
                                type="button"
                                onClick={() => openEditModal(order)}
                                aria-label={`${t('editOrderTitle', { num: order.orderNumber })}`}
                                className="p-2 rounded-lg text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(order.id)}
                              aria-label={`${t('delete')} ${order.orderNumber}`}
                              className="p-2 rounded-lg text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
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

      {/* Create / Edit Order Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {editingOrder
                    ? t('editOrderTitle', { num: editingOrder.orderNumber })
                    : t('createNewOrderTitle')}
                </h2>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('orderIdLabel', { num: orderNumberPreview })}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFormModal}
                aria-label={t('close')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-6 space-y-5 max-h-[84vh] overflow-y-auto">
              {(formError || calculatedOrder.conversionError) && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{formError || calculatedOrder.conversionError}</span>
                </div>
              )}

              {/* Order Meta & Customer Directory Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('customerDirectoryLabel')}
                  </label>
                  <select
                    value={customerId}
                    onChange={(e) => handleCustomerSelect(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    <option value="custom">{t('enterNewCustomerOpt')}</option>
                    {[...customers]
                      .sort(
                        (a, b) =>
                          Number(isDemoCustomer(a)) - Number(isDemoCustomer(b)) ||
                          a.name.localeCompare(b.name)
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email || c.phone || t('noContact')})
                          {isDemoCustomer(c) ? ` ${t('sampleSuffix')}` : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('salesChannelLabel')}
                  </label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as OrderChannel)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    {ORDER_CHANNEL_LIST.map((ch) => (
                      <option key={ch} value={ch}>
                        {tChannel(ch)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('orderStatusLabel')}
                  </label>
                  <select
                    value={orderStatus}
                    onChange={(e) => setOrderStatus(e.target.value as OrderStatus)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    <option value="pending">{t('optPendingDesc')}</option>
                    <option value="processing">{t('optProcessingDesc')}</option>
                    <option value="shipped">{t('optShippedDesc')}</option>
                    <option value="delivered">{t('optDeliveredDesc')}</option>
                    {editingOrder && (
                      <>
                        <option value="cancelled">{t('optCancelledDesc')}</option>
                        <option value="returned">{t('optReturnedDesc')}</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('orderCurrencyLabel')}
                  </label>
                  <select
                    value={orderCurrency}
                    onChange={(e) => setOrderCurrency(e.target.value as CurrencyCode)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    {currencySelectOptions.map((code) => (
                      <option key={code} value={code}>
                        {getCurrencyLabel(code, language)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Customer Contact Information */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('customerNameReq')}
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setCustomerName(nextVal);
                      if (customerId !== 'custom') {
                        const sel = customers.find((c) => c.id === customerId);
                        if (sel && sel.name.trim().toLowerCase() !== nextVal.trim().toLowerCase()) {
                          setCustomerId('custom');
                        }
                      }
                    }}
                    placeholder={t('customerNamePlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('customerEmailReq')}
                  </label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setCustomerEmail(nextVal);
                      if (customerId !== 'custom') {
                        const sel = customers.find((c) => c.id === customerId);
                        if (sel && sel.email.trim().toLowerCase() !== nextVal.trim().toLowerCase()) {
                          setCustomerId('custom');
                        }
                      }
                    }}
                    placeholder={t('customerEmailPlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('contactPhoneLabel')}
                  </label>
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setCustomerPhone(nextVal);
                      if (customerId !== 'custom') {
                        const sel = customers.find((c) => c.id === customerId);
                        if (sel && (sel.phone || '').trim() !== nextVal.trim()) {
                          setCustomerId('custom');
                        }
                      }
                    }}
                    placeholder="+20 100 000 0000"
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('shippingAddressLabel')}
                  </label>
                  <input
                    type="text"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder={t('shippingAddressPlaceholder')}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>

              {/* Line Items with Variant & Quantity */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {t('orderProductsHeader')}
                  </span>
                  {products.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const defaultProd = products.find((p) => p.stock > 0) ?? products[0];
                        const presets = getVariantOptionsForProduct(defaultProd);
                        setLineItems((prev) => [
                          ...prev,
                          {
                            productId: defaultProd.id,
                            variant: presets[0] ?? 'Standard',
                            quantity: 1,
                          },
                        ]);
                      }}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {t('addLineItem')}
                    </button>
                  )}
                </div>

                {products.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t('addProductBeforeOrder')}
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {lineItems.map((line, index) => {
                      const prod = products.find((p) => p.id === line.productId);
                      const variantPresets = getVariantOptionsForProduct(prod);
                      const isCustomVar = Boolean(customVariantRows[index]);
                      const prodCurrency = resolveTransactionCurrency(prod?.currency, effectiveConfig);
                      const unitConv = prod
                        ? convertCurrencyAmount(
                            prod.price,
                            prodCurrency,
                            orderCurrency,
                            effectiveConfig.usdToEgpRate
                          )
                        : null;
                      const unitPriceInOrderCurr =
                        unitConv && unitConv.ok ? unitConv.amount : prod?.price ?? 0;
                      const lineTotal = unitPriceInOrderCurr * Math.max(1, line.quantity);
                      const prevQtyForProd =
                        editingOrder && inferStockDeducted(editingOrder)
                          ? (editingOrder.items ?? [])
                              .filter((it) => it.productId === line.productId)
                              .reduce((s, it) => s + it.quantity, 0)
                          : 0;
                      const effectiveAvail = (prod?.stock ?? 0) + prevQtyForProd;

                      return (
                        <div
                          key={index}
                          className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#070D1D] p-3 space-y-2"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                            <div className="sm:col-span-5">
                              <select
                                aria-label={`Product line ${index + 1}`}
                                value={line.productId}
                                onChange={(e) => {
                                  const nextProd = products.find((p) => p.id === e.target.value);
                                  const nextPresets = getVariantOptionsForProduct(nextProd);
                                  setCustomVariantRows((prev) => ({ ...prev, [index]: false }));
                                  setLineItems((prev) =>
                                    prev.map((item, i) =>
                                      i === index
                                        ? {
                                            ...item,
                                            productId: e.target.value,
                                            variant: nextPresets[0] ?? 'Standard',
                                          }
                                        : item
                                    )
                                  );
                                }}
                                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-900 dark:text-slate-100"
                              >
                                {products.map((p) => {
                                  const pCurr = resolveTransactionCurrency(p.currency, effectiveConfig);
                                  return (
                                    <option key={p.id} value={p.id}>
                                      {p.name} ({p.sku}) —{' '}
                                      {formatCurrency(p.price, pCurr, 2, language)} · {p.stock}{' '}
                                      {t('availShort')}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            <div className="sm:col-span-4">
                              {isCustomVar ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={line.variant}
                                    onChange={(e) =>
                                      setLineItems((prev) =>
                                        prev.map((item, i) =>
                                          i === index ? { ...item, variant: e.target.value } : item
                                        )
                                      )
                                    }
                                    placeholder={t('customVariantPlaceholder')}
                                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-900 dark:text-slate-100"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCustomVariantRows((prev) => ({ ...prev, [index]: false }));
                                      setLineItems((prev) =>
                                        prev.map((item, i) =>
                                          i === index
                                            ? { ...item, variant: variantPresets[0] ?? 'Standard' }
                                            : item
                                        )
                                      );
                                    }}
                                    className="px-2 py-2 text-[11px] rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                                  >
                                    {t('listBtn')}
                                  </button>
                                </div>
                              ) : (
                                <select
                                  aria-label={`Variant line ${index + 1}`}
                                  value={
                                    variantPresets.includes(line.variant)
                                      ? line.variant
                                      : '__custom__'
                                  }
                                  onChange={(e) => {
                                    if (e.target.value === '__custom__') {
                                      setCustomVariantRows((prev) => ({ ...prev, [index]: true }));
                                      setLineItems((prev) =>
                                        prev.map((item, i) =>
                                          i === index ? { ...item, variant: '' } : item
                                        )
                                      );
                                    } else {
                                      setLineItems((prev) =>
                                        prev.map((item, i) =>
                                          i === index ? { ...item, variant: e.target.value } : item
                                        )
                                      );
                                    }
                                  }}
                                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-900 dark:text-slate-100"
                                >
                                  {variantPresets.map((v) => (
                                    <option key={v} value={v}>
                                      {v}
                                    </option>
                                  ))}
                                  <option value="__custom__">{t('customVariantOpt')}</option>
                                </select>
                              )}
                            </div>

                            <div className="sm:col-span-2 flex items-center gap-1">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                onClick={() =>
                                  setLineItems((prev) =>
                                    prev.map((item, i) =>
                                      i === index
                                        ? { ...item, quantity: Math.max(1, item.quantity - 1) }
                                        : item
                                    )
                                  )
                                }
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <Minus className="w-3 h-3" aria-hidden="true" />
                              </button>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                aria-label={`Quantity line ${index + 1}`}
                                value={line.quantity}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((item, i) =>
                                      i === index
                                        ? {
                                            ...item,
                                            quantity: Math.max(1, Number(e.target.value) || 1),
                                          }
                                        : item
                                    )
                                  )
                                }
                                className="w-full min-w-[44px] px-2 py-1.5 text-center text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-900 dark:text-slate-100"
                              />
                              <button
                                type="button"
                                aria-label="Increase quantity"
                                onClick={() =>
                                  setLineItems((prev) =>
                                    prev.map((item, i) =>
                                      i === index ? { ...item, quantity: item.quantity + 1 } : item
                                    )
                                  )
                                }
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" aria-hidden="true" />
                              </button>
                            </div>

                            <div className="sm:col-span-1 flex items-center justify-end gap-1">
                              {lineItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLineItems((prev) => prev.filter((_, i) => i !== index))
                                  }
                                  aria-label={t('delete')}
                                  className="p-2 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 px-1">
                            <span>
                              {t('unitLabel', {
                                price: formatCurrency(
                                  unitPriceInOrderCurr,
                                  orderCurrency,
                                  2,
                                  language
                                ),
                              })}{' '}
                              ·{' '}
                              {isConfirmedStatus(orderStatus) && line.quantity > effectiveAvail ? (
                                <span className="text-rose-500 font-semibold">
                                  {t('exceedsStock', { avail: effectiveAvail })}
                                </span>
                              ) : (
                                <span>{t('maxAvail', { avail: effectiveAvail })}</span>
                              )}
                            </span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {t('lineTotalLabel', {
                                total: formatCurrency(lineTotal, orderCurrency, 2, language),
                              })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Date, Discount, Shipping, Tax */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('orderDateLabel')}
                  </label>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t('discountLabel', {
                        unit: discountMode === 'fixed' ? orderCurrency : '%',
                      })}
                    </label>
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden text-[10px]">
                      <button
                        type="button"
                        onClick={() => setDiscountMode('fixed')}
                        className={`px-2 py-0.5 font-mono cursor-pointer ${
                          discountMode === 'fixed'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-50 dark:bg-[#070D1D] text-slate-500'
                        }`}
                      >
                        {getCurrencySymbol(orderCurrency, language)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountMode('percent')}
                        className={`px-2 py-0.5 font-mono cursor-pointer ${
                          discountMode === 'percent'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-50 dark:bg-[#070D1D] text-slate-500'
                        }`}
                      >
                        %
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={discountMode === 'percent' ? 100 : undefined}
                    step="0.01"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t('shippingLabel', { curr: orderCurrency })}
                    </label>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-blue-600 dark:text-blue-400">
                      <button
                        type="button"
                        onClick={() => setShippingCost('0')}
                        className="hover:underline cursor-pointer"
                      >
                        {t('shipFree')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setShippingCost(orderCurrency === 'EGP' ? '60' : '12')
                        }
                        className="hover:underline cursor-pointer"
                      >
                        {t('shipStd')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setShippingCost(orderCurrency === 'EGP' ? '150' : '25')
                        }
                        className="hover:underline cursor-pointer"
                      >
                        {t('shipExp')}
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={shippingCost}
                    onChange={(e) => setShippingCost(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyTax}
                      onChange={(e) => setApplyTax(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {t('applyTaxLabel', { rate: defaultTaxRate })}
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t('orderNotesLabel')}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('orderNotesPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D1D] text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Financial Summary */}
              <div className="rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 p-4 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>
                    {t('subtotalUnits', {
                      count: formatNumber(calculatedOrder.itemCount, language),
                      unit: calculatedOrder.itemCount === 1 ? t('unitSingle') : t('unitPlural'),
                    })}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(calculatedOrder.subtotal, orderCurrency, 2, language)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{t('discountWord')}</span>
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    -{formatCurrency(calculatedOrder.discountAmount, orderCurrency, 2, language)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>
                    {t('taxWord')} ({applyTax ? `${defaultTaxRate}%` : '0%'})
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(calculatedOrder.taxAmount, orderCurrency, 2, language)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{t('shippingWord')}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(calculatedOrder.shippingCost, orderCurrency, 2, language)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-800 font-semibold text-slate-900 dark:text-white gap-2">
                  <span>
                    {t('finalOrderTotal')} (
                    {t('cogsGpInline', {
                      cogs: formatCurrency(calculatedOrder.totalCost, orderCurrency, 2, language),
                      gp: formatCurrency(
                        calculatedOrder.totalAmount - calculatedOrder.totalCost,
                        orderCurrency,
                        2,
                        language
                      ),
                    })}
                    )
                  </span>
                  <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                    {formatCurrency(calculatedOrder.totalAmount, orderCurrency, 2, language)}
                  </span>
                </div>
                <div className="pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {!modalStockPlan.ok ? (
                    <span className="text-rose-500">{modalStockPlan.error}</span>
                  ) : modalStockPlan.nextStockDeducted ? (
                    t('inventoryImpactDeduct', {
                      count: formatNumber(calculatedOrder.itemCount, language),
                      status: tOrderStatus(orderStatus),
                    })
                  ) : (
                    t('inventoryImpactPending')
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={closeFormModal}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    products.length === 0 ||
                    !modalStockPlan.ok ||
                    Boolean(calculatedOrder.conversionError)
                  }
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                >
                  {submitting
                    ? editingOrder
                      ? t('savingChanges')
                      : t('creatingOrder')
                    : editingOrder
                    ? t('saveChanges')
                    : t('createOrder')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Order Detail & History Modal */}
      {activeSelectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1328] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white font-mono">
                    {t('orderDetailsTitle', { num: activeSelectedOrder.orderNumber })}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                      ORDER_STATUS_META[activeSelectedOrder.status].textClass
                    }`}
                  >
                    {renderStatusIcon(activeSelectedOrder.status)}
                    {tOrderStatus(activeSelectedOrder.status)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                  {formatDateShort(activeSelectedOrder.orderDate, language)} ·{' '}
                  {tChannel(activeSelectedOrder.channel)} · {selectedOrderCurrency} ·{' '}
                  {inferStockDeducted(activeSelectedOrder)
                    ? t('stockDeducted')
                    : isRestoredStatus(activeSelectedOrder.status)
                    ? t('stockRestored')
                    : t('awaitingConfirm')}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {!isRestoredStatus(activeSelectedOrder.status) && (
                  <button
                    type="button"
                    onClick={() => openEditModal(activeSelectedOrder)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-blue-500/40 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('edit')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDetailError(null);
                    onSelectOrder(null);
                  }}
                  aria-label={t('close')}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {detailError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{detailError}</span>
                </div>
              )}

              {/* Customer & Contact Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#070D1D] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('colCustomer')}
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                    {activeSelectedOrder.customerName}
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 mt-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <span>{activeSelectedOrder.customerEmail}</span>
                  </div>
                  {activeSelectedOrder.customerPhone && (
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 mt-1 font-mono">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span>{activeSelectedOrder.customerPhone}</span>
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('shippingAndNotes')}
                  </div>
                  <div className="flex items-start gap-1.5 text-slate-700 dark:text-slate-300 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      {activeSelectedOrder.shippingAddress || t('noShippingRecorded')}
                    </span>
                  </div>
                  {activeSelectedOrder.notes && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                      {t('notePrefix', { note: activeSelectedOrder.notes })}
                    </p>
                  )}
                </div>
              </div>

              {/* Line Items */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {activeSelectedOrder.items && activeSelectedOrder.items.length > 0 ? (
                  activeSelectedOrder.items.map((item) => (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between text-xs gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {item.productName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                          {item.sku} · {t('variantPrefix', { variant: item.variant || 'Standard' })} ·{' '}
                          {item.quantity} ×{' '}
                          {formatCurrency(item.unitPrice, selectedOrderCurrency, 2, language)}
                        </div>
                      </div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {formatCurrency(item.lineTotal, selectedOrderCurrency, 2, language)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {activeSelectedOrder.itemsSummary}
                  </div>
                )}
              </div>

              {/* Financial Breakdown */}
              <div className="rounded-xl bg-slate-100 dark:bg-[#070D1D] border border-slate-200 dark:border-slate-800 p-4 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>
                    {t('subtotalUnits', {
                      count: formatNumber(activeSelectedOrder.itemCount, language),
                      unit:
                        activeSelectedOrder.itemCount === 1 ? t('unitSingle') : t('unitPlural'),
                    })}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(
                      activeSelectedOrder.subtotal,
                      selectedOrderCurrency,
                      2,
                      language
                    )}
                  </span>
                </div>
                {(activeSelectedOrder.discountAmount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>{t('discountWord')}</span>
                    <span className="font-mono tabular-nums">
                      -
                      {formatCurrency(
                        activeSelectedOrder.discountAmount,
                        selectedOrderCurrency,
                        2,
                        language
                      )}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{t('taxWord')}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(
                      activeSelectedOrder.taxAmount,
                      selectedOrderCurrency,
                      2,
                      language
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{t('shippingWord')}</span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(
                      activeSelectedOrder.shippingCost,
                      selectedOrderCurrency,
                      2,
                      language
                    )}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-800 font-semibold text-slate-900 dark:text-white">
                  <span>{t('finalOrderTotal')}</span>
                  <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                    {formatCurrency(
                      activeSelectedOrder.totalAmount,
                      selectedOrderCurrency,
                      2,
                      language
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-cyan-600 dark:text-cyan-400 font-medium">
                  <span>
                    {t('grossProfitAfterCogs', {
                      cogs: formatCurrency(
                        activeSelectedOrder.totalCost,
                        selectedOrderCurrency,
                        2,
                        language
                      ),
                    })}
                  </span>
                  <span className="font-mono tabular-nums">
                    {isRestoredStatus(activeSelectedOrder.status)
                      ? formatCurrency(0, selectedOrderCurrency, 2, language)
                      : formatCurrency(
                          activeSelectedOrder.totalAmount - activeSelectedOrder.totalCost,
                          selectedOrderCurrency,
                          2,
                          language
                        )}
                  </span>
                </div>
                {activeSelectedOrder.reportingCurrency &&
                  activeSelectedOrder.reportingCurrency !== selectedOrderCurrency &&
                  activeSelectedOrder.exchangeRate &&
                  activeSelectedOrder.convertedAmount !== undefined && (
                    <div className="pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 space-y-0.5">
                      <div>
                        {t('appliedRateInfo', {
                          from: selectedOrderCurrency,
                          rate: activeSelectedOrder.exchangeRate,
                          to: activeSelectedOrder.reportingCurrency,
                          converted: formatCurrency(
                            activeSelectedOrder.convertedAmount,
                            activeSelectedOrder.reportingCurrency,
                            2,
                            language
                          ),
                        })}
                      </div>
                      {activeSelectedOrder.rateSource && (
                        <div>
                          {t('cbeRateSourceLabel')}: {activeSelectedOrder.rateSource}
                          {activeSelectedOrder.ratePublicationDate
                            ? ` · ${t('cbePubDateShort', {
                                date: activeSelectedOrder.ratePublicationDate,
                              })}`
                            : ''}
                        </div>
                      )}
                    </div>
                  )}
              </div>

              {/* Fulfillment Status Transitions */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t('updateStatusInventory')}
                  </span>
                  {activeSelectedOrder.status === 'pending' && (
                    <button
                      type="button"
                      disabled={statusUpdatingId === activeSelectedOrder.id}
                      onClick={() => handleStatusChange(activeSelectedOrder, 'processing', true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer disabled:opacity-50"
                    >
                      {t('confirmDeductStockBtn')}
                    </button>
                  )}
                </div>

                {isRestoredStatus(activeSelectedOrder.status) ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('lockedStatusNote', {
                      status: tOrderStatus(activeSelectedOrder.status),
                    })}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {ORDER_STATUS_LIST.map((st) => {
                      const isCurrent = activeSelectedOrder.status === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          disabled={isCurrent || statusUpdatingId === activeSelectedOrder.id}
                          onClick={() => handleStatusChange(activeSelectedOrder, st, true)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:cursor-default ${
                            isCurrent
                              ? 'border-blue-500 bg-blue-600 text-white'
                              : st === 'cancelled' || st === 'returned'
                              ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                              : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/40'
                          }`}
                        >
                          {tOrderStatus(st)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Chronological Order History */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <History className="w-3.5 h-3.5 text-blue-500" aria-hidden="true" />
                  {t('orderHistoryTitle')}
                </div>
                {activeSelectedOrder.history && activeSelectedOrder.history.length > 0 ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                    {activeSelectedOrder.history.map((entry) => (
                      <div key={entry.id} className="px-4 py-2.5 flex items-start justify-between gap-3 text-xs">
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {entry.title}
                          </div>
                          {entry.detail && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {entry.detail}
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                          {formatRelativeTime(entry.createdAt, language)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('noStatusTransitions')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
