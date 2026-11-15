import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  ActivityType,
  AppLanguage,
  BusinessActivity,
  CurrencyCode,
  Customer,
  ExchangeRateMode,
  Expense,
  Order,
  OrderHistoryEntry,
  OrderItem,
  OrderStatus,
  Product,
  ProductIdea,
  TenantProfile,
} from '../types/zenorati';
import { buildStarterWorkspaceData, type WorkspaceDataset } from '../data/starterData';
import { createSafeId } from '../utils/formatters';
import { inferStockDeducted } from '../utils/orderHelpers';
import type { CustomerBackfillPlan } from '../utils/customerHelpers';

function isValidCurrencyVal(val: unknown): val is CurrencyCode {
  return (
    val === 'USD' ||
    val === 'EGP' ||
    val === 'EUR' ||
    val === 'GBP' ||
    val === 'CAD' ||
    val === 'AUD'
  );
}

function isValidLanguageVal(val: unknown): val is AppLanguage {
  return val === 'en' || val === 'ar';
}

function optNum(val: unknown): number | undefined {
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function isValidExchangeRateModeVal(val: unknown): val is ExchangeRateMode {
  return val === 'cbe_official' || val === 'manual_override';
}

function optStr(val: unknown): string | undefined {
  return typeof val === 'string' && val.trim().length > 0 ? val : undefined;
}

const LOCAL_STORAGE_KEY = 'zenorati_local_workspace_v1';
export const LOCAL_TENANT_ID = 'local_sandbox_owner';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function normalizeOrders(orders: Order[] | undefined): Order[] {
  if (!Array.isArray(orders)) return [];
  return orders.map((o) => ({
    ...o,
    customerPhone: o.customerPhone ?? '',
    shippingAddress: o.shippingAddress ?? '',
    discountAmount: Number(o.discountAmount ?? 0),
    notes: o.notes ?? '',
    stockDeducted: inferStockDeducted(o),
    items: Array.isArray(o.items)
      ? o.items.map((it) => ({
          ...it,
          variant: it.variant || 'Standard',
        }))
      : [],
    history: Array.isArray(o.history) ? o.history : [],
  }));
}

function normalizeCustomers(customers: Customer[] | undefined): Customer[] {
  if (!Array.isArray(customers)) return [];
  return customers.map((c) => ({
    ...c,
    phone: c.phone ?? '',
    location: c.location ?? '',
    shippingAddress: c.shippingAddress ?? '',
    city: c.city ?? '',
    country: c.country ?? '',
    notes: c.notes ?? '',
  }));
}

export function loadLocalWorkspace(): WorkspaceDataset {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkspaceDataset;
      if (parsed && parsed.profile && Array.isArray(parsed.products)) {
        return {
          ...parsed,
          customers: normalizeCustomers(parsed.customers),
          orders: normalizeOrders(parsed.orders),
        };
      }
    }
  } catch {
    // Fallback to fresh starter dataset
  }
  const initial = buildStarterWorkspaceData(LOCAL_TENANT_ID, 'owner@northstar-demo.local');
  return initial;
}

export function saveLocalWorkspace(data: WorkspaceDataset): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

export function resetLocalWorkspace(): WorkspaceDataset {
  const fresh = buildStarterWorkspaceData(LOCAL_TENANT_ID, 'owner@northstar-demo.local');
  saveLocalWorkspace(fresh);
  return fresh;
}

function isValidUserRoleVal(val: unknown): val is TenantProfile['role'] {
  return (
    val === 'super_admin' ||
    val === 'store_owner' ||
    val === 'manager' ||
    val === 'staff' ||
    val === 'viewer' ||
    val === 'owner' ||
    val === 'admin' ||
    val === 'user'
  );
}

function isValidAccountStatusVal(val: unknown): val is TenantProfile['accountStatus'] {
  return val === 'active' || val === 'suspended';
}

function mapTenantProfileDoc(data: Record<string, unknown>): TenantProfile {
  const usdToEgpRate = optNum(data.usdToEgpRate);
  const cbeBuyRate = optNum(data.cbeBuyRate);
  const cbeSellRate = optNum(data.cbeSellRate);
  return {
    ownerId: String(data.ownerId ?? ''),
    businessName: String(data.businessName ?? 'ZENORATI Store'),
    ownerEmail: String(data.ownerEmail ?? ''),
    ...(typeof data.fullName === 'string' ? { fullName: data.fullName } : {}),
    ...(typeof data.photoUrl === 'string' ? { photoUrl: data.photoUrl } : {}),
    ...(isValidUserRoleVal(data.role) ? { role: data.role } : {}),
    ...(isValidAccountStatusVal(data.accountStatus) ? { accountStatus: data.accountStatus } : {}),
    ...(optStr(data.invitationId) ? { invitationId: optStr(data.invitationId) } : {}),
    currency: isValidCurrencyVal(data.currency) ? data.currency : 'USD',
    ...(usdToEgpRate !== undefined && usdToEgpRate > 0 ? { usdToEgpRate } : {}),
    ...(isValidCurrencyVal(data.legacyCurrency) ? { legacyCurrency: data.legacyCurrency } : {}),
    ...(isValidLanguageVal(data.language) ? { language: data.language } : {}),
    ...(isValidExchangeRateModeVal(data.exchangeRateMode)
      ? { exchangeRateMode: data.exchangeRateMode }
      : {}),
    ...(cbeBuyRate !== undefined && cbeBuyRate > 0 ? { cbeBuyRate } : {}),
    ...(cbeSellRate !== undefined && cbeSellRate > 0 ? { cbeSellRate } : {}),
    ...(optStr(data.cbePublicationDate)
      ? { cbePublicationDate: optStr(data.cbePublicationDate) }
      : {}),
    ...(optStr(data.cbeLastSyncedAt) ? { cbeLastSyncedAt: optStr(data.cbeLastSyncedAt) } : {}),
    ...(optStr(data.cbeSource) ? { cbeSource: optStr(data.cbeSource) } : {}),
    taxRate: Number(data.taxRate ?? 0),
    lowStockThreshold: Number(data.lowStockThreshold ?? 12),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

/**
 * Strictly reads an existing tenant profile without ever auto-creating an uninvited tenant workspace.
 */
export async function fetchExistingCloudTenantProfile(uid: string): Promise<TenantProfile | null> {
  const path = `tenants/${uid}`;
  const ref = doc(db, 'tenants', uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return mapTenantProfileDoc(snap.data() as Record<string, unknown>);
  } catch (error) {
    // A missing tenant document may return permission-denied on get when rule checks existing().ownerId
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
      return null;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Safely ensures an existing store owner has a /users/{uid} record without modifying /tenants/{uid} or any business collections.
 */
export async function ensureExistingOwnerUserProfile(params: {
  uid: string;
  email: string;
  fullName: string;
  businessName: string;
  photoUrl?: string;
}): Promise<void> {
  if (!params.uid || !params.email) return;
  const userRef = doc(db, 'users', params.uid);
  try {
    const existing = await getDoc(userRef);
    if (existing.exists()) {
      await updateDoc(userRef, {
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
      return;
    }
    await setDoc(userRef, {
      uid: params.uid,
      email: params.email.trim().toLowerCase().slice(0, 160),
      fullName: (params.fullName || params.businessName || 'Owner').trim().slice(0, 120),
      ...(params.photoUrl ? { photoUrl: params.photoUrl.slice(0, 500) } : {}),
      role: 'store_owner',
      accountStatus: 'active',
      tenantId: params.uid,
      businessName: (params.businessName || 'ZENORATI Store').trim().slice(0, 100),
      permissions: {
        products: { view: true, create: true, edit: true, delete: true },
        orders: { view: true, create: true, edit: true, delete: true },
        customers: { view: true, create: true, edit: true, delete: true },
        inventory: { view: true, create: true, edit: true, delete: true },
        finance: { view: true, create: true, edit: true, delete: true },
        marketing: { view: true, create: true, edit: true, delete: true },
        reports: { view: true, create: true, edit: true, delete: true },
        settings: { view: true, create: true, edit: true, delete: true },
      },
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking sync; never interrupt workspace access if user profile creation is deferred
  }
}

export async function touchUserLastActive(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      await updateDoc(userRef, {
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Silent non-blocking heartbeat
  }
}

export async function ensureCloudTenantProfile(
  uid: string,
  email: string,
  displayName: string | null
): Promise<TenantProfile> {
  const path = `tenants/${uid}`;
  const ref = doc(db, 'tenants', uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return mapTenantProfileDoc(snap.data() as Record<string, unknown>);
    }

    const defaultName = displayName ? `${displayName.split(' ')[0]}'s Store` : 'ZENORATI Store';
    const payload = {
      ownerId: uid,
      businessName: defaultName.slice(0, 100),
      ownerEmail: email.slice(0, 160),
      ...(displayName ? { fullName: displayName.slice(0, 120) } : {}),
      currency: 'USD' as const,
      usdToEgpRate: 50,
      taxRate: 8.25,
      lowStockThreshold: 12,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    return {
      ownerId: uid,
      businessName: payload.businessName,
      ownerEmail: payload.ownerEmail,
      ...(displayName ? { fullName: displayName.slice(0, 120) } : {}),
      currency: 'USD',
      usdToEgpRate: 50,
      taxRate: 8.25,
      lowStockThreshold: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function seedCloudWorkspace(uid: string, email: string): Promise<void> {
  const starter = buildStarterWorkspaceData(uid, email);
  const batch = writeBatch(db);

  for (const prod of starter.products) {
    batch.set(doc(db, 'tenants', uid, 'products', prod.id), {
      ownerId: uid,
      name: prod.name.slice(0, 120),
      sku: prod.sku.slice(0, 40),
      category: prod.category.slice(0, 60),
      price: prod.price,
      cost: prod.cost,
      stock: Math.round(prod.stock),
      status: prod.status,
      imageKey: prod.imageKey,
      description: prod.description.slice(0, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const cust of starter.customers) {
    batch.set(doc(db, 'tenants', uid, 'customers', cust.id), {
      ownerId: uid,
      name: cust.name.slice(0, 120),
      email: cust.email.slice(0, 160),
      phone: cust.phone.slice(0, 40),
      location: cust.location.slice(0, 120),
      shippingAddress: (cust.shippingAddress || '').slice(0, 240),
      city: (cust.city || '').slice(0, 80),
      country: (cust.country || '').slice(0, 80),
      notes: cust.notes.slice(0, 400),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const exp of starter.expenses) {
    batch.set(doc(db, 'tenants', uid, 'expenses', exp.id), {
      ownerId: uid,
      title: exp.title.slice(0, 120),
      category: exp.category,
      vendor: exp.vendor.slice(0, 100),
      amount: exp.amount,
      expenseDate: exp.expenseDate,
      status: exp.status,
      notes: exp.notes.slice(0, 400),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const act of starter.activities) {
    batch.set(doc(db, 'tenants', uid, 'activities', act.id), {
      ownerId: uid,
      type: act.type,
      title: act.title.slice(0, 160),
      detail: act.detail.slice(0, 250),
      amount: act.amount,
      createdAt: serverTimestamp(),
    });
  }

  for (const idea of starter.researchIdeas) {
    batch.set(doc(db, 'tenants', uid, 'researchIdeas', idea.id), {
      ownerId: uid,
      name: idea.name.slice(0, 120),
      targetPrice: idea.targetPrice,
      estimatedCost: idea.estimatedCost,
      shippingEstimate: idea.shippingEstimate,
      adCpaEstimate: idea.adCpaEstimate,
      notes: idea.notes.slice(0, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    // Commit orders first, then their items & history subcollections so exists(parentOrder) passes security rules
    for (const order of starter.orders) {
      await setDoc(doc(db, 'tenants', uid, 'orders', order.id), {
        ownerId: uid,
        orderNumber: order.orderNumber.slice(0, 40),
        customerId: order.customerId,
        customerName: order.customerName.slice(0, 120),
        customerEmail: order.customerEmail.slice(0, 160),
        customerPhone: (order.customerPhone || '').slice(0, 40),
        shippingAddress: (order.shippingAddress || '').slice(0, 240),
        status: order.status,
        channel: order.channel,
        subtotal: Number(order.subtotal),
        discountAmount: Number(order.discountAmount ?? 0),
        taxAmount: Number(order.taxAmount),
        shippingCost: Number(order.shippingCost),
        totalAmount: Number(order.totalAmount),
        totalCost: Number(order.totalCost),
        itemCount: Math.max(1, Math.round(order.itemCount)),
        itemsSummary: order.itemsSummary.slice(0, 300),
        orderDate: order.orderDate,
        notes: (order.notes || '').slice(0, 500),
        stockDeducted: Boolean(order.stockDeducted),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (order.items && order.items.length > 0) {
        await Promise.all(
          order.items.map((item) =>
            setDoc(doc(db, 'tenants', uid, 'orders', order.id, 'items', item.id), {
              ownerId: uid,
              productId: item.productId,
              productName: item.productName.slice(0, 120),
              sku: item.sku.slice(0, 40),
              variant: (item.variant || 'Standard').slice(0, 80),
              quantity: Math.max(1, Math.round(item.quantity)),
              unitPrice: Number(item.unitPrice),
              unitCost: Number(item.unitCost),
              lineTotal: Number(item.lineTotal),
            })
          )
        );
      }
      if (order.history && order.history.length > 0) {
        await Promise.all(
          order.history.map((hist) =>
            setDoc(doc(db, 'tenants', uid, 'orders', order.id, 'history', hist.id), {
              ownerId: uid,
              status: hist.status,
              title: hist.title.slice(0, 160),
              detail: (hist.detail || '').slice(0, 300),
              createdAt: serverTimestamp(),
            })
          )
        );
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `tenants/${uid}`);
  }
}

export function subscribeCloudWorkspace(
  uid: string,
  callbacks: {
    onProfile: (p: TenantProfile) => void;
    onProducts: (p: Product[]) => void;
    onCustomers: (c: Customer[]) => void;
    onOrders: (o: Order[]) => void;
    onExpenses: (e: Expense[]) => void;
    onActivities: (a: BusinessActivity[]) => void;
    onIdeas: (i: ProductIdea[]) => void;
    onError: (err: Error) => void;
  }
): () => void {
  const unsubscribers: Array<() => void> = [];

  const profilePath = `tenants/${uid}`;
  unsubscribers.push(
    onSnapshot(
      doc(db, 'tenants', uid),
      (snap) => {
        if (snap.exists()) {
          callbacks.onProfile(mapTenantProfileDoc(snap.data() as Record<string, unknown>));
        }
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, profilePath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  const productsPath = `tenants/${uid}/products`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'tenants', uid, 'products'), where('ownerId', '==', uid)),
      (snap) => {
        const list: Product[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId,
            name: data.name,
            sku: data.sku,
            category: data.category,
            price: Number(data.price),
            cost: Number(data.cost),
            ...(isValidCurrencyVal(data.currency) ? { currency: data.currency } : {}),
            stock: Number(data.stock),
            status: data.status,
            imageKey: data.imageKey || 'none',
            description: data.description || '',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
          };
        });
        list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        callbacks.onProducts(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, productsPath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  const customersPath = `tenants/${uid}/customers`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'tenants', uid, 'customers'), where('ownerId', '==', uid)),
      (snap) => {
        const list: Customer[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId,
            name: data.name,
            email: data.email || '',
            phone: data.phone || '',
            location: data.location || '',
            shippingAddress: data.shippingAddress || '',
            city: data.city || '',
            country: data.country || '',
            notes: data.notes || '',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        callbacks.onCustomers(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, customersPath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  const ordersPath = `tenants/${uid}/orders`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'tenants', uid, 'orders'), where('ownerId', '==', uid)),
      async (snap) => {
        const ordersWithItems: Order[] = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data();
            let items: OrderItem[] = [];
            let history: OrderHistoryEntry[] = [];
            try {
              const [itemsSnap, historySnap] = await Promise.all([
                getDocs(
                  query(
                    collection(db, 'tenants', uid, 'orders', d.id, 'items'),
                    where('ownerId', '==', uid)
                  )
                ),
                getDocs(
                  query(
                    collection(db, 'tenants', uid, 'orders', d.id, 'history'),
                    where('ownerId', '==', uid)
                  )
                ),
              ]);
              items = itemsSnap.docs.map((itemDoc) => {
                const it = itemDoc.data();
                return {
                  id: itemDoc.id,
                  ownerId: it.ownerId,
                  productId: it.productId,
                  productName: it.productName,
                  sku: it.sku,
                  variant: it.variant || 'Standard',
                  quantity: Number(it.quantity),
                  unitPrice: Number(it.unitPrice),
                  unitCost: Number(it.unitCost),
                  lineTotal: Number(it.lineTotal),
                };
              });
              history = historySnap.docs
                .map((hDoc) => {
                  const h = hDoc.data();
                  return {
                    id: hDoc.id,
                    ownerId: h.ownerId,
                    status: h.status as OrderStatus,
                    title: h.title,
                    detail: h.detail || '',
                    createdAt: toIsoString(h.createdAt),
                  };
                })
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            } catch {
              items = [];
              history = [];
            }

            const status = (data.status || 'pending') as OrderStatus;
            const createdAtIso = toIsoString(data.createdAt);
            const fallbackOrderDate = createdAtIso.slice(0, 10);
            const exRate = optNum(data.exchangeRate);
            const convAmt = optNum(data.convertedAmount);
            return {
              id: d.id,
              ownerId: data.ownerId || uid,
              orderNumber: data.orderNumber || d.id,
              customerId: data.customerId || '',
              customerName: data.customerName || data.name || '',
              customerEmail: data.customerEmail || data.email || '',
              customerPhone: data.customerPhone || data.phone || '',
              shippingAddress: data.shippingAddress || data.address || '',
              status,
              channel: data.channel || 'Direct',
              subtotal: Number(data.subtotal ?? 0) || 0,
              discountAmount: Number(data.discountAmount ?? 0) || 0,
              taxAmount: Number(data.taxAmount ?? 0) || 0,
              shippingCost: Number(data.shippingCost ?? 0) || 0,
              totalAmount: Number(data.totalAmount ?? 0) || 0,
              totalCost: Number(data.totalCost ?? 0) || 0,
              ...(isValidCurrencyVal(data.currency) ? { currency: data.currency } : {}),
              ...(exRate !== undefined && exRate > 0 ? { exchangeRate: exRate } : {}),
              ...(convAmt !== undefined && convAmt >= 0 ? { convertedAmount: convAmt } : {}),
              ...(isValidCurrencyVal(data.reportingCurrency)
                ? { reportingCurrency: data.reportingCurrency }
                : {}),
              ...(optStr(data.rateSource) ? { rateSource: optStr(data.rateSource) } : {}),
              ...(optStr(data.conversionDirection)
                ? { conversionDirection: optStr(data.conversionDirection) }
                : {}),
              ...(optStr(data.ratePublicationDate)
                ? { ratePublicationDate: optStr(data.ratePublicationDate) }
                : {}),
              ...(optStr(data.rateTimestamp) ? { rateTimestamp: optStr(data.rateTimestamp) } : {}),
              itemCount: Number(data.itemCount ?? items.length) || 0,
              itemsSummary: data.itemsSummary || '',
              orderDate: data.orderDate || fallbackOrderDate,
              notes: data.notes || '',
              stockDeducted: inferStockDeducted({
                status,
                stockDeducted: data.stockDeducted,
              }),
              items,
              history,
              createdAt: createdAtIso,
              updatedAt: toIsoString(data.updatedAt),
            };
          })
        );
        ordersWithItems.sort(
          (a, b) =>
            (b.orderDate || '').localeCompare(a.orderDate || '') ||
            (b.orderNumber || '').localeCompare(a.orderNumber || '')
        );
        callbacks.onOrders(ordersWithItems);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, ordersPath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  const expensesPath = `tenants/${uid}/expenses`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'tenants', uid, 'expenses'), where('ownerId', '==', uid)),
      (snap) => {
        const list: Expense[] = snap.docs.map((d) => {
          const data = d.data();
          const exRate = optNum(data.exchangeRate);
          const convAmt = optNum(data.convertedAmount);
          return {
            id: d.id,
            ownerId: data.ownerId,
            title: data.title,
            category: data.category,
            vendor: data.vendor,
            amount: Number(data.amount),
            ...(isValidCurrencyVal(data.currency) ? { currency: data.currency } : {}),
            ...(exRate !== undefined && exRate > 0 ? { exchangeRate: exRate } : {}),
            ...(convAmt !== undefined && convAmt >= 0 ? { convertedAmount: convAmt } : {}),
            ...(isValidCurrencyVal(data.reportingCurrency)
              ? { reportingCurrency: data.reportingCurrency }
              : {}),
            ...(optStr(data.rateSource) ? { rateSource: optStr(data.rateSource) } : {}),
            ...(optStr(data.conversionDirection)
              ? { conversionDirection: optStr(data.conversionDirection) }
              : {}),
            ...(optStr(data.ratePublicationDate)
              ? { ratePublicationDate: optStr(data.ratePublicationDate) }
              : {}),
            ...(optStr(data.rateTimestamp) ? { rateTimestamp: optStr(data.rateTimestamp) } : {}),
            expenseDate: data.expenseDate,
            status: data.status,
            notes: data.notes || '',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
          };
        });
        list.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
        callbacks.onExpenses(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, expensesPath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  const activitiesPath = `tenants/${uid}/activities`;
  unsubscribers.push(
    onSnapshot(
      query(
        collection(db, 'tenants', uid, 'activities'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'desc')
      ),
      (snap) => {
        const list: BusinessActivity[] = snap.docs.slice(0, 30).map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId,
            type: data.type,
            title: data.title,
            detail: data.detail || '',
            amount: Number(data.amount ?? 0),
            createdAt: toIsoString(data.createdAt),
          };
        });
        callbacks.onActivities(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, activitiesPath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  const ideasPath = `tenants/${uid}/researchIdeas`;
  unsubscribers.push(
    onSnapshot(
      query(collection(db, 'tenants', uid, 'researchIdeas'), where('ownerId', '==', uid)),
      (snap) => {
        const list: ProductIdea[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId,
            name: data.name,
            targetPrice: Number(data.targetPrice),
            estimatedCost: Number(data.estimatedCost),
            shippingEstimate: Number(data.shippingEstimate),
            adCpaEstimate: Number(data.adCpaEstimate),
            ...(isValidCurrencyVal(data.currency) ? { currency: data.currency } : {}),
            notes: data.notes || '',
            createdAt: toIsoString(data.createdAt),
            updatedAt: toIsoString(data.updatedAt),
          };
        });
        callbacks.onIdeas(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, ideasPath);
        } catch (wrapped) {
          callbacks.onError(wrapped as Error);
        }
      }
    )
  );

  return () => {
    unsubscribers.forEach((u) => u());
  };
}

// Cloud CRUD Operations (strictly validated against firebase-blueprint.json & firestore.rules)
export async function cloudLogActivity(
  uid: string,
  type: ActivityType,
  title: string,
  detail: string,
  amount = 0
): Promise<void> {
  const id = createSafeId('act');
  const path = `tenants/${uid}/activities/${id}`;
  try {
    await setDoc(doc(db, 'tenants', uid, 'activities', id), {
      ownerId: uid,
      type,
      title: title.slice(0, 160),
      detail: detail.slice(0, 250),
      amount: Number(amount),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function cloudUpdateProfile(uid: string, profile: TenantProfile): Promise<void> {
  const path = `tenants/${uid}`;
  try {
    await updateDoc(doc(db, 'tenants', uid), {
      businessName: profile.businessName.slice(0, 100),
      ownerEmail: profile.ownerEmail.slice(0, 160),
      ...(profile.fullName !== undefined ? { fullName: profile.fullName.slice(0, 120) } : {}),
      ...(profile.photoUrl !== undefined ? { photoUrl: profile.photoUrl.slice(0, 500) } : {}),
      currency: profile.currency,
      ...(profile.usdToEgpRate !== undefined && profile.usdToEgpRate > 0
        ? { usdToEgpRate: Number(profile.usdToEgpRate) }
        : {}),
      ...(profile.legacyCurrency ? { legacyCurrency: profile.legacyCurrency } : {}),
      ...(profile.language ? { language: profile.language } : {}),
      ...(profile.exchangeRateMode ? { exchangeRateMode: profile.exchangeRateMode } : {}),
      ...(profile.cbeBuyRate !== undefined && profile.cbeBuyRate > 0
        ? { cbeBuyRate: Number(profile.cbeBuyRate) }
        : {}),
      ...(profile.cbeSellRate !== undefined && profile.cbeSellRate > 0
        ? { cbeSellRate: Number(profile.cbeSellRate) }
        : {}),
      ...(profile.cbePublicationDate
        ? { cbePublicationDate: profile.cbePublicationDate.slice(0, 10) }
        : {}),
      ...(profile.cbeLastSyncedAt
        ? { cbeLastSyncedAt: profile.cbeLastSyncedAt.slice(0, 40) }
        : {}),
      ...(profile.cbeSource ? { cbeSource: profile.cbeSource.slice(0, 80) } : {}),
      taxRate: Number(profile.taxRate),
      lowStockThreshold: Math.round(profile.lowStockThreshold),
      updatedAt: serverTimestamp(),
    });
    await cloudLogActivity(uid, 'settings', 'Workspace settings updated', profile.businessName, 0);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudSyncTenantCbeRate(
  uid: string,
  patch: Pick<
    TenantProfile,
    | 'cbeBuyRate'
    | 'cbeSellRate'
    | 'cbePublicationDate'
    | 'cbeLastSyncedAt'
    | 'cbeSource'
    | 'exchangeRateMode'
    | 'usdToEgpRate'
  >
): Promise<void> {
  const path = `tenants/${uid}`;
  try {
    await updateDoc(doc(db, 'tenants', uid), {
      ...(patch.exchangeRateMode ? { exchangeRateMode: patch.exchangeRateMode } : {}),
      ...(patch.usdToEgpRate !== undefined && patch.usdToEgpRate > 0
        ? { usdToEgpRate: Number(patch.usdToEgpRate) }
        : {}),
      ...(patch.cbeBuyRate !== undefined && patch.cbeBuyRate > 0
        ? { cbeBuyRate: Number(patch.cbeBuyRate) }
        : {}),
      ...(patch.cbeSellRate !== undefined && patch.cbeSellRate > 0
        ? { cbeSellRate: Number(patch.cbeSellRate) }
        : {}),
      ...(patch.cbePublicationDate
        ? { cbePublicationDate: patch.cbePublicationDate.slice(0, 10) }
        : {}),
      ...(patch.cbeLastSyncedAt ? { cbeLastSyncedAt: patch.cbeLastSyncedAt.slice(0, 40) } : {}),
      ...(patch.cbeSource ? { cbeSource: patch.cbeSource.slice(0, 80) } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudSaveProduct(uid: string, product: Product, isNew: boolean): Promise<void> {
  const path = `tenants/${uid}/products/${product.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'tenants', uid, 'products', product.id), {
        ownerId: uid,
        name: product.name.slice(0, 120),
        sku: product.sku.slice(0, 40),
        category: product.category.slice(0, 60),
        price: Number(product.price),
        cost: Number(product.cost),
        ...(product.currency ? { currency: product.currency } : {}),
        stock: Math.max(0, Math.round(product.stock)),
        status: product.status,
        imageKey: product.imageKey,
        description: product.description.slice(0, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await cloudLogActivity(uid, 'product', `Added product ${product.name}`, `SKU ${product.sku}`, product.price);
    } else {
      await updateDoc(doc(db, 'tenants', uid, 'products', product.id), {
        name: product.name.slice(0, 120),
        sku: product.sku.slice(0, 40),
        category: product.category.slice(0, 60),
        price: Number(product.price),
        cost: Number(product.cost),
        ...(product.currency ? { currency: product.currency } : {}),
        stock: Math.max(0, Math.round(product.stock)),
        status: product.status,
        imageKey: product.imageKey,
        description: product.description.slice(0, 500),
        updatedAt: serverTimestamp(),
      });
      await cloudLogActivity(uid, 'product', `Updated product ${product.name}`, `SKU ${product.sku}`, product.price);
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function cloudAdjustStock(uid: string, product: Product, newStock: number): Promise<void> {
  const path = `tenants/${uid}/products/${product.id}`;
  const clamped = Math.max(0, Math.round(newStock));
  try {
    await updateDoc(doc(db, 'tenants', uid, 'products', product.id), {
      stock: clamped,
      updatedAt: serverTimestamp(),
    });
    await cloudLogActivity(
      uid,
      'inventory',
      `Adjusted stock for ${product.name}`,
      `${product.stock} → ${clamped} units`,
      0
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudDeleteProduct(uid: string, product: Product): Promise<void> {
  const path = `tenants/${uid}/products/${product.id}`;
  try {
    await deleteDoc(doc(db, 'tenants', uid, 'products', product.id));
    await cloudLogActivity(uid, 'product', `Removed product ${product.name}`, `SKU ${product.sku}`, 0);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudCreateOrder(
  uid: string,
  order: Order,
  stockUpdates: Array<{ product: Product; nextStock: number }>
): Promise<void> {
  const path = `tenants/${uid}/orders/${order.id}`;
  try {
    await setDoc(doc(db, 'tenants', uid, 'orders', order.id), {
      ownerId: uid,
      orderNumber: order.orderNumber.slice(0, 40),
      customerId: order.customerId,
      customerName: order.customerName.slice(0, 120),
      customerEmail: order.customerEmail.slice(0, 160),
      customerPhone: (order.customerPhone || '').slice(0, 40),
      shippingAddress: (order.shippingAddress || '').slice(0, 240),
      status: order.status,
      channel: order.channel,
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discountAmount ?? 0),
      taxAmount: Number(order.taxAmount),
      shippingCost: Number(order.shippingCost),
      totalAmount: Number(order.totalAmount),
      totalCost: Number(order.totalCost),
      ...(order.currency ? { currency: order.currency } : {}),
      ...(order.exchangeRate !== undefined && order.exchangeRate > 0
        ? { exchangeRate: Number(order.exchangeRate) }
        : {}),
      ...(order.convertedAmount !== undefined && order.convertedAmount >= 0
        ? { convertedAmount: Number(order.convertedAmount) }
        : {}),
      ...(order.reportingCurrency ? { reportingCurrency: order.reportingCurrency } : {}),
      ...(order.rateSource ? { rateSource: order.rateSource.slice(0, 120) } : {}),
      ...(order.conversionDirection
        ? { conversionDirection: order.conversionDirection.slice(0, 20) }
        : {}),
      ...(order.ratePublicationDate
        ? { ratePublicationDate: order.ratePublicationDate.slice(0, 10) }
        : {}),
      ...(order.rateTimestamp ? { rateTimestamp: order.rateTimestamp.slice(0, 40) } : {}),
      itemCount: Math.max(1, Math.round(order.itemCount)),
      itemsSummary: order.itemsSummary.slice(0, 300),
      orderDate: order.orderDate,
      notes: (order.notes || '').slice(0, 500),
      stockDeducted: Boolean(order.stockDeducted),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (order.items && order.items.length > 0) {
      await Promise.all(
        order.items.map((item) =>
          setDoc(doc(db, 'tenants', uid, 'orders', order.id, 'items', item.id), {
            ownerId: uid,
            productId: item.productId,
            productName: item.productName.slice(0, 120),
            sku: item.sku.slice(0, 40),
            variant: (item.variant || 'Standard').slice(0, 80),
            quantity: Math.max(1, Math.round(item.quantity)),
            unitPrice: Number(item.unitPrice),
            unitCost: Number(item.unitCost),
            lineTotal: Number(item.lineTotal),
          })
        )
      );
    }

    if (order.history && order.history.length > 0) {
      await Promise.all(
        order.history.map((hist) =>
          setDoc(doc(db, 'tenants', uid, 'orders', order.id, 'history', hist.id), {
            ownerId: uid,
            status: hist.status,
            title: hist.title.slice(0, 160),
            detail: (hist.detail || '').slice(0, 300),
            createdAt: serverTimestamp(),
          })
        )
      );
    }

    await Promise.all(
      stockUpdates.map(({ product, nextStock }) =>
        updateDoc(doc(db, 'tenants', uid, 'products', product.id), {
          stock: Math.max(0, Math.round(nextStock)),
          updatedAt: serverTimestamp(),
        })
      )
    );

    await cloudLogActivity(
      uid,
      'order',
      `Created order ${order.orderNumber}`,
      `${order.customerName} · ${order.itemCount} item(s)`,
      order.convertedAmount ?? order.totalAmount
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function cloudUpdateOrder(
  uid: string,
  previousOrder: Order,
  updatedOrder: Order,
  stockUpdates: Array<{ product: Product; nextStock: number }>,
  historyEntry: OrderHistoryEntry
): Promise<void> {
  const path = `tenants/${uid}/orders/${updatedOrder.id}`;
  try {
    await updateDoc(doc(db, 'tenants', uid, 'orders', updatedOrder.id), {
      customerId: updatedOrder.customerId,
      customerName: updatedOrder.customerName.slice(0, 120),
      customerEmail: updatedOrder.customerEmail.slice(0, 160),
      customerPhone: (updatedOrder.customerPhone || '').slice(0, 40),
      shippingAddress: (updatedOrder.shippingAddress || '').slice(0, 240),
      status: updatedOrder.status,
      channel: updatedOrder.channel,
      subtotal: Number(updatedOrder.subtotal),
      discountAmount: Number(updatedOrder.discountAmount ?? 0),
      taxAmount: Number(updatedOrder.taxAmount),
      shippingCost: Number(updatedOrder.shippingCost),
      totalAmount: Number(updatedOrder.totalAmount),
      totalCost: Number(updatedOrder.totalCost),
      ...(updatedOrder.currency ? { currency: updatedOrder.currency } : {}),
      ...(updatedOrder.exchangeRate !== undefined && updatedOrder.exchangeRate > 0
        ? { exchangeRate: Number(updatedOrder.exchangeRate) }
        : {}),
      ...(updatedOrder.convertedAmount !== undefined && updatedOrder.convertedAmount >= 0
        ? { convertedAmount: Number(updatedOrder.convertedAmount) }
        : {}),
      ...(updatedOrder.reportingCurrency
        ? { reportingCurrency: updatedOrder.reportingCurrency }
        : {}),
      ...(updatedOrder.rateSource ? { rateSource: updatedOrder.rateSource.slice(0, 120) } : {}),
      ...(updatedOrder.conversionDirection
        ? { conversionDirection: updatedOrder.conversionDirection.slice(0, 20) }
        : {}),
      ...(updatedOrder.ratePublicationDate
        ? { ratePublicationDate: updatedOrder.ratePublicationDate.slice(0, 10) }
        : {}),
      ...(updatedOrder.rateTimestamp
        ? { rateTimestamp: updatedOrder.rateTimestamp.slice(0, 40) }
        : {}),
      itemCount: Math.max(1, Math.round(updatedOrder.itemCount)),
      itemsSummary: updatedOrder.itemsSummary.slice(0, 300),
      orderDate: updatedOrder.orderDate,
      notes: (updatedOrder.notes || '').slice(0, 500),
      stockDeducted: Boolean(updatedOrder.stockDeducted),
      updatedAt: serverTimestamp(),
    });

    const nextItems = updatedOrder.items ?? [];
    const nextIds = new Set(nextItems.map((i) => i.id));
    const prevItems = previousOrder.items ?? [];

    await Promise.all([
      ...prevItems
        .filter((oldItem) => !nextIds.has(oldItem.id))
        .map((oldItem) =>
          deleteDoc(doc(db, 'tenants', uid, 'orders', updatedOrder.id, 'items', oldItem.id))
        ),
      ...nextItems.map((item) =>
        setDoc(doc(db, 'tenants', uid, 'orders', updatedOrder.id, 'items', item.id), {
          ownerId: uid,
          productId: item.productId,
          productName: item.productName.slice(0, 120),
          sku: item.sku.slice(0, 40),
          variant: (item.variant || 'Standard').slice(0, 80),
          quantity: Math.max(1, Math.round(item.quantity)),
          unitPrice: Number(item.unitPrice),
          unitCost: Number(item.unitCost),
          lineTotal: Number(item.lineTotal),
        })
      ),
      setDoc(doc(db, 'tenants', uid, 'orders', updatedOrder.id, 'history', historyEntry.id), {
        ownerId: uid,
        status: historyEntry.status,
        title: historyEntry.title.slice(0, 160),
        detail: (historyEntry.detail || '').slice(0, 300),
        createdAt: serverTimestamp(),
      }),
      ...stockUpdates.map(({ product, nextStock }) =>
        updateDoc(doc(db, 'tenants', uid, 'products', product.id), {
          stock: Math.max(0, Math.round(nextStock)),
          updatedAt: serverTimestamp(),
        })
      ),
    ]);

    await cloudLogActivity(
      uid,
      'order',
      `Updated order ${updatedOrder.orderNumber}`,
      `${updatedOrder.customerName} · ${updatedOrder.itemCount} item(s)`,
      updatedOrder.totalAmount
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudUpdateOrderStatus(
  uid: string,
  order: Order,
  status: OrderStatus,
  nextStockDeducted: boolean,
  stockUpdates: Array<{ product: Product; nextStock: number }>,
  historyEntry: OrderHistoryEntry
): Promise<void> {
  const path = `tenants/${uid}/orders/${order.id}`;
  try {
    await Promise.all([
      updateDoc(doc(db, 'tenants', uid, 'orders', order.id), {
        status,
        stockDeducted: nextStockDeducted,
        updatedAt: serverTimestamp(),
      }),
      setDoc(doc(db, 'tenants', uid, 'orders', order.id, 'history', historyEntry.id), {
        ownerId: uid,
        status: historyEntry.status,
        title: historyEntry.title.slice(0, 160),
        detail: (historyEntry.detail || '').slice(0, 300),
        createdAt: serverTimestamp(),
      }),
      ...stockUpdates.map(({ product, nextStock }) =>
        updateDoc(doc(db, 'tenants', uid, 'products', product.id), {
          stock: Math.max(0, Math.round(nextStock)),
          updatedAt: serverTimestamp(),
        })
      ),
    ]);

    await cloudLogActivity(
      uid,
      'order',
      `Order ${order.orderNumber} marked ${status}`,
      historyEntry.detail || order.customerName,
      status === 'cancelled' || status === 'returned' ? 0 : order.totalAmount
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function cloudDeleteOrder(
  uid: string,
  order: Order,
  stockUpdates: Array<{ product: Product; nextStock: number }>
): Promise<void> {
  const path = `tenants/${uid}/orders/${order.id}`;
  try {
    const [itemsSnap, historySnap] = await Promise.all([
      getDocs(
        query(collection(db, 'tenants', uid, 'orders', order.id, 'items'), where('ownerId', '==', uid))
      ),
      getDocs(
        query(
          collection(db, 'tenants', uid, 'orders', order.id, 'history'),
          where('ownerId', '==', uid)
        )
      ),
    ]);

    await Promise.all([
      ...itemsSnap.docs.map((d) =>
        deleteDoc(doc(db, 'tenants', uid, 'orders', order.id, 'items', d.id))
      ),
      ...historySnap.docs.map((d) =>
        deleteDoc(doc(db, 'tenants', uid, 'orders', order.id, 'history', d.id))
      ),
      ...stockUpdates.map(({ product, nextStock }) =>
        updateDoc(doc(db, 'tenants', uid, 'products', product.id), {
          stock: Math.max(0, Math.round(nextStock)),
          updatedAt: serverTimestamp(),
        })
      ),
    ]);

    await deleteDoc(doc(db, 'tenants', uid, 'orders', order.id));
    await cloudLogActivity(
      uid,
      'order',
      `Deleted order ${order.orderNumber}`,
      stockUpdates.length > 0 ? `${order.customerName} · stock restored` : order.customerName,
      0
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudSaveExpense(uid: string, expense: Expense, isNew: boolean): Promise<void> {
  const path = `tenants/${uid}/expenses/${expense.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'tenants', uid, 'expenses', expense.id), {
        ownerId: uid,
        title: expense.title.slice(0, 120),
        category: expense.category,
        vendor: expense.vendor.slice(0, 100),
        amount: Number(expense.amount),
        ...(expense.currency ? { currency: expense.currency } : {}),
        ...(expense.exchangeRate !== undefined && expense.exchangeRate > 0
          ? { exchangeRate: Number(expense.exchangeRate) }
          : {}),
        ...(expense.convertedAmount !== undefined && expense.convertedAmount >= 0
          ? { convertedAmount: Number(expense.convertedAmount) }
          : {}),
        ...(expense.reportingCurrency ? { reportingCurrency: expense.reportingCurrency } : {}),
        ...(expense.rateSource ? { rateSource: expense.rateSource.slice(0, 120) } : {}),
        ...(expense.conversionDirection
          ? { conversionDirection: expense.conversionDirection.slice(0, 20) }
          : {}),
        ...(expense.ratePublicationDate
          ? { ratePublicationDate: expense.ratePublicationDate.slice(0, 10) }
          : {}),
        ...(expense.rateTimestamp ? { rateTimestamp: expense.rateTimestamp.slice(0, 40) } : {}),
        expenseDate: expense.expenseDate,
        status: expense.status,
        notes: expense.notes.slice(0, 400),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await cloudLogActivity(
        uid,
        'expense',
        `Logged expense: ${expense.title}`,
        `${expense.category} · ${expense.vendor}`,
        -(expense.convertedAmount ?? expense.amount)
      );
    } else {
      await updateDoc(doc(db, 'tenants', uid, 'expenses', expense.id), {
        title: expense.title.slice(0, 120),
        category: expense.category,
        vendor: expense.vendor.slice(0, 100),
        amount: Number(expense.amount),
        ...(expense.currency ? { currency: expense.currency } : {}),
        ...(expense.exchangeRate !== undefined && expense.exchangeRate > 0
          ? { exchangeRate: Number(expense.exchangeRate) }
          : {}),
        ...(expense.convertedAmount !== undefined && expense.convertedAmount >= 0
          ? { convertedAmount: Number(expense.convertedAmount) }
          : {}),
        ...(expense.reportingCurrency ? { reportingCurrency: expense.reportingCurrency } : {}),
        ...(expense.rateSource ? { rateSource: expense.rateSource.slice(0, 120) } : {}),
        ...(expense.conversionDirection
          ? { conversionDirection: expense.conversionDirection.slice(0, 20) }
          : {}),
        ...(expense.ratePublicationDate
          ? { ratePublicationDate: expense.ratePublicationDate.slice(0, 10) }
          : {}),
        ...(expense.rateTimestamp ? { rateTimestamp: expense.rateTimestamp.slice(0, 40) } : {}),
        expenseDate: expense.expenseDate,
        status: expense.status,
        notes: expense.notes.slice(0, 400),
        updatedAt: serverTimestamp(),
      });
      await cloudLogActivity(
        uid,
        'expense',
        `Updated expense: ${expense.title}`,
        expense.category,
        -(expense.convertedAmount ?? expense.amount)
      );
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function cloudDeleteExpense(uid: string, expense: Expense): Promise<void> {
  const path = `tenants/${uid}/expenses/${expense.id}`;
  try {
    await deleteDoc(doc(db, 'tenants', uid, 'expenses', expense.id));
    await cloudLogActivity(uid, 'expense', `Removed expense: ${expense.title}`, expense.category, 0);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudSaveCustomer(uid: string, customer: Customer, isNew: boolean): Promise<void> {
  const path = `tenants/${uid}/customers/${customer.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'tenants', uid, 'customers', customer.id), {
        ownerId: uid,
        name: customer.name.slice(0, 120),
        email: customer.email.slice(0, 160),
        phone: customer.phone.slice(0, 40),
        location: customer.location.slice(0, 120),
        shippingAddress: (customer.shippingAddress || '').slice(0, 240),
        city: (customer.city || '').slice(0, 80),
        country: (customer.country || '').slice(0, 80),
        notes: customer.notes.slice(0, 400),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await cloudLogActivity(
        uid,
        'customer',
        `Added customer ${customer.name}`,
        customer.email || customer.phone || customer.location,
        0
      );
    } else {
      await updateDoc(doc(db, 'tenants', uid, 'customers', customer.id), {
        name: customer.name.slice(0, 120),
        email: customer.email.slice(0, 160),
        phone: customer.phone.slice(0, 40),
        location: customer.location.slice(0, 120),
        shippingAddress: (customer.shippingAddress || '').slice(0, 240),
        city: (customer.city || '').slice(0, 80),
        country: (customer.country || '').slice(0, 80),
        notes: customer.notes.slice(0, 400),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function cloudDeleteCustomer(uid: string, customer: Customer): Promise<void> {
  const path = `tenants/${uid}/customers/${customer.id}`;
  try {
    await deleteDoc(doc(db, 'tenants', uid, 'customers', customer.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudSyncCustomersFromOrders(
  uid: string,
  plan: CustomerBackfillPlan
): Promise<void> {
  if (plan.customersToCreate.length === 0) {
    return;
  }

  const path = `tenants/${uid}/customers`;
  const CHUNK_SIZE = 400;

  try {
    // Strictly non-destructive sync: create ONLY missing customer profiles.
    // Never modifies existing order documents or pre-existing customer records.
    for (let i = 0; i < plan.customersToCreate.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const c of plan.customersToCreate.slice(i, i + CHUNK_SIZE)) {
        batch.set(doc(db, 'tenants', uid, 'customers', c.id), {
          ownerId: uid,
          name: (c.name.trim() || 'Customer').slice(0, 120),
          email: (c.email || '').slice(0, 160),
          phone: (c.phone || '').slice(0, 40),
          location: (c.location || '').slice(0, 120),
          shippingAddress: (c.shippingAddress || '').slice(0, 240),
          city: (c.city || '').slice(0, 80),
          country: (c.country || '').slice(0, 80),
          notes: (c.notes || '').slice(0, 400),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await cloudLogActivity(
      uid,
      'customer',
      `Created ${plan.customersToCreate.length} missing customer profile${plan.customersToCreate.length === 1 ? '' : 's'} from orders`,
      plan.customersToCreate.map((c) => c.name).slice(0, 3).join(', '),
      0
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cloudSaveProductIdea(uid: string, idea: ProductIdea, isNew: boolean): Promise<void> {
  const path = `tenants/${uid}/researchIdeas/${idea.id}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'tenants', uid, 'researchIdeas', idea.id), {
        ownerId: uid,
        name: idea.name.slice(0, 120),
        targetPrice: Number(idea.targetPrice),
        estimatedCost: Number(idea.estimatedCost),
        shippingEstimate: Number(idea.shippingEstimate),
        adCpaEstimate: Number(idea.adCpaEstimate),
        notes: idea.notes.slice(0, 500),
        ...(idea.currency ? { currency: idea.currency } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'tenants', uid, 'researchIdeas', idea.id), {
        name: idea.name.slice(0, 120),
        targetPrice: Number(idea.targetPrice),
        estimatedCost: Number(idea.estimatedCost),
        shippingEstimate: Number(idea.shippingEstimate),
        adCpaEstimate: Number(idea.adCpaEstimate),
        notes: idea.notes.slice(0, 500),
        ...(idea.currency ? { currency: idea.currency } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function cloudDeleteProductIdea(uid: string, ideaId: string): Promise<void> {
  const path = `tenants/${uid}/researchIdeas/${ideaId}`;
  try {
    await deleteDoc(doc(db, 'tenants', uid, 'researchIdeas', ideaId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
