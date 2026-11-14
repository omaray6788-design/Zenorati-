import type {
  CrmInsights,
  CurrencyConfig,
  Customer,
  CustomerComputedMetrics,
  CustomerSegment,
  CustomerSegmentRules,
  Order,
} from '../types/zenorati';
import { resolveReportingAmount } from './currency';
import { createSafeId } from './formatters';

export const DEFAULT_SEGMENT_RULES: CustomerSegmentRules = {
  vipMinSpend: 500,
  vipMinOrders: 3,
  activeMinOrders: 2,
};

export const CUSTOMER_SEGMENT_META: Record<
  CustomerSegment,
  { label: string; textClass: string; description: string }
> = {
  new: {
    label: 'New Customer',
    textClass: 'text-blue-600 dark:text-blue-400',
    description: 'First-time or pre-repeat buyer',
  },
  active: {
    label: 'Active Customer',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    description: 'Repeat buyer meeting active order threshold',
  },
  vip: {
    label: 'VIP Customer',
    textClass: 'text-purple-600 dark:text-cyan-400',
    description: 'High-spend or high-frequency loyal customer',
  },
};

export function loadCrmSegmentRules(ownerId: string): CustomerSegmentRules {
  try {
    const raw = window.localStorage.getItem(`zenorati_crm_rules_${ownerId}`);
    if (!raw) return DEFAULT_SEGMENT_RULES;
    const parsed = JSON.parse(raw) as Partial<CustomerSegmentRules>;
    const vipMinSpend = Number(parsed.vipMinSpend);
    const vipMinOrders = Number(parsed.vipMinOrders);
    const activeMinOrders = Number(parsed.activeMinOrders);
    return {
      vipMinSpend: Number.isFinite(vipMinSpend) && vipMinSpend >= 0 ? vipMinSpend : DEFAULT_SEGMENT_RULES.vipMinSpend,
      vipMinOrders: Number.isFinite(vipMinOrders) && vipMinOrders >= 1 ? Math.round(vipMinOrders) : DEFAULT_SEGMENT_RULES.vipMinOrders,
      activeMinOrders: Number.isFinite(activeMinOrders) && activeMinOrders >= 1 ? Math.round(activeMinOrders) : DEFAULT_SEGMENT_RULES.activeMinOrders,
    };
  } catch {
    return DEFAULT_SEGMENT_RULES;
  }
}

export function saveCrmSegmentRules(ownerId: string, rules: CustomerSegmentRules): void {
  try {
    window.localStorage.setItem(`zenorati_crm_rules_${ownerId}`, JSON.stringify(rules));
  } catch {
    // Ignore storage failures
  }
}

export const DEMO_CUSTOMER_IDS = new Set([
  'cust_elena_vance',
  'cust_marcus_chen',
  'cust_claire_bennett',
  'cust_david_okafor',
  'cust_sofia_lindqvist',
]);

export const DEMO_CUSTOMER_EMAILS = new Set([
  'elena.vance@studio-north.co',
  'm.chen@atelierworks.io',
  'claire@bennettdesign.uk',
  'david.okafor@meridianhq.com',
  'sofia@nordichome.se',
]);

export const DEMO_ORDER_IDS = new Set([
  'ord_1048',
  'ord_1047',
  'ord_1046',
  'ord_1045',
  'ord_1044',
  'ord_1043',
  'ord_1042',
]);

export function isDemoCustomer(customer: Pick<Customer, 'id' | 'email'>): boolean {
  if (DEMO_CUSTOMER_IDS.has(customer.id)) return true;
  const normalized = normalizeEmail(customer.email);
  return Boolean(normalized && DEMO_CUSTOMER_EMAILS.has(normalized));
}

export function isDemoOrder(order: Pick<Order, 'id' | 'customerId' | 'customerEmail'>): boolean {
  if (DEMO_ORDER_IDS.has(order.id)) return true;
  if (DEMO_CUSTOMER_IDS.has(order.customerId)) return true;
  const normalized = normalizeEmail(order.customerEmail);
  return Boolean(normalized && DEMO_CUSTOMER_EMAILS.has(normalized));
}

function toAsciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

export function normalizePhone(phone?: string): string {
  return toAsciiDigits(phone || '').replace(/\D/g, '');
}

export function phonesMatch(a?: string, b?: string): boolean {
  const da = normalizePhone(a);
  const db = normalizePhone(b);
  if (da.length < 5 || db.length < 5) return false;
  if (da === db) return true;
  if (da.length === 11 && da.startsWith('1') && da.slice(1) === db) return true;
  if (db.length === 11 && db.startsWith('1') && db.slice(1) === da) return true;

  const stripIntl00 = (s: string) => (s.startsWith('00') && s.length > 9 ? s.slice(2) : s);
  const ia = stripIntl00(da);
  const ib = stripIntl00(db);
  if (ia === ib) return true;

  const coreA = ia.replace(/^0+/, '');
  const coreB = ib.replace(/^0+/, '');
  if (coreA.length >= 9 && coreB.length >= 9) {
    if (coreA === coreB) return true;
    if (coreA.length > coreB.length && coreA.length - coreB.length <= 3 && coreA.endsWith(coreB)) {
      return true;
    }
    if (coreB.length > coreA.length && coreB.length - coreA.length <= 3 && coreB.endsWith(coreA)) {
      return true;
    }
  }
  return false;
}

export function normalizeEmail(email?: string): string {
  return (email || '').trim().toLowerCase();
}

function normalizeCustomerName(name?: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function namesLookCompatible(a?: string, b?: string): boolean {
  const na = normalizeCustomerName(a);
  const nb = normalizeCustomerName(b);
  if (!na || !nb) return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Returns true when an order's buyer contact info clearly contradicts the customer
 * record referenced by `order.customerId` (e.g., order form defaulted to a demo
 * customer while the merchant entered a different buyer's name and phone).
 */
export function doesOrderContradictCustomer(
  order: Pick<Order, 'customerName' | 'customerEmail' | 'customerPhone'>,
  customer: Pick<Customer, 'id' | 'name' | 'email' | 'phone'>
): boolean {
  const orderPhoneValid = normalizePhone(order.customerPhone).length >= 5;
  const custPhoneValid = normalizePhone(customer.phone).length >= 5;
  const phoneMatches =
    orderPhoneValid && custPhoneValid && phonesMatch(order.customerPhone, customer.phone);

  if (phoneMatches) return false;

  const nameMatches = namesLookCompatible(order.customerName, customer.name);
  const phoneConflicts = orderPhoneValid && custPhoneValid && !phoneMatches;
  if (phoneConflicts && !nameMatches) return true;

  const orderEmail = normalizeEmail(order.customerEmail);
  const custEmail = normalizeEmail(customer.email);
  const emailConflicts = Boolean(orderEmail && custEmail && orderEmail !== custEmail);
  if (emailConflicts && !nameMatches) return true;

  if (isDemoCustomer(customer) && !nameMatches) return true;

  return false;
}

export function parseCityCountry(
  location?: string,
  city?: string,
  country?: string
): { city: string; country: string } {
  const cleanCity = (city || '').trim();
  const cleanCountry = (country || '').trim();
  if (cleanCity || cleanCountry) {
    return { city: cleanCity, country: cleanCountry };
  }
  const loc = (location || '').trim();
  if (!loc) return { city: '', country: '' };
  const parts = loc
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts.slice(0, -1).join(', '),
      country: parts[parts.length - 1],
    };
  }
  return { city: parts[0] || '', country: '' };
}

export function extractCityCountryFromAddress(address?: string): { city: string; country: string } {
  const raw = (address || '').trim();
  if (!raw) return { city: '', country: '' };
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    return { city: parts[0].slice(0, 80), country: '' };
  }
  if (parts.length === 2) {
    return { city: parts[0].slice(0, 80), country: parts[1].slice(0, 80) };
  }
  // e.g. "742 Market St, Suite 400, San Francisco, CA 94102" -> city: San Francisco, country/region: CA 94102
  const city = parts[parts.length - 2].slice(0, 80);
  const country = parts[parts.length - 1].slice(0, 80);
  return { city, country };
}

export function formatLocation(city?: string, country?: string, fallback?: string): string {
  const parts = [(city || '').trim(), (country || '').trim()].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(', ').slice(0, 120);
  }
  return (fallback || '').trim().slice(0, 120);
}

/**
 * Matches an existing customer using phone number first, then email, then customerId
 * (only when the customerId record does not contradict the order's buyer details).
 */
export function findMatchingCustomer(
  customers: Customer[],
  criteria: { phone?: string; email?: string; customerId?: string; name?: string }
): Customer | null {
  if (normalizePhone(criteria.phone).length >= 5) {
    const phoneMatch = customers.find((c) => phonesMatch(c.phone, criteria.phone));
    if (phoneMatch) return phoneMatch;
  }

  const targetEmail = normalizeEmail(criteria.email);
  if (targetEmail) {
    const emailMatch = customers.find((c) => {
      if (normalizeEmail(c.email) !== targetEmail) return false;
      // Do not match by email if phone explicitly conflicts and names differ
      const criteriaPhoneOk = normalizePhone(criteria.phone).length >= 5;
      const custPhoneOk = normalizePhone(c.phone).length >= 5;
      if (criteriaPhoneOk && custPhoneOk && !phonesMatch(criteria.phone, c.phone)) {
        if (!namesLookCompatible(criteria.name, c.name)) {
          return false;
        }
      }
      return true;
    });
    if (emailMatch) return emailMatch;
  }

  if (criteria.customerId) {
    const idMatch = customers.find((c) => c.id === criteria.customerId);
    if (
      idMatch &&
      !doesOrderContradictCustomer(
        {
          customerName: criteria.name || idMatch.name,
          customerEmail: criteria.email || '',
          customerPhone: criteria.phone || '',
        },
        idMatch
      )
    ) {
      return idMatch;
    }
  }

  return null;
}

export function findDuplicateCustomer(
  customers: Customer[],
  criteria: { phone?: string; email?: string },
  excludeId?: string
): Customer | null {
  const candidates = excludeId ? customers.filter((c) => c.id !== excludeId) : customers;
  return findMatchingCustomer(candidates, criteria);
}

/**
 * Automatically finds an existing customer (phone first, then email) or creates a new profile
 * from an order, synchronizing missing or updated details without overwriting existing data with empty fields.
 */
export function reconcileCustomerFromOrder(
  customers: Customer[],
  order: Pick<
    Order,
    'customerId' | 'customerName' | 'customerEmail' | 'customerPhone' | 'shippingAddress'
  >,
  ownerId: string
): { customer: Customer; isNew: boolean; changed: boolean } {
  const nowIso = new Date().toISOString();
  const existing = findMatchingCustomer(customers, {
    phone: order.customerPhone,
    email: order.customerEmail,
    customerId: order.customerId,
    name: order.customerName,
  });

  const orderName = (order.customerName || '').trim().slice(0, 120);
  const rawOrderEmail = (order.customerEmail || '').trim().slice(0, 160);
  const orderPhone = (order.customerPhone || '').trim().slice(0, 40);
  const orderAddress = (order.shippingAddress || '').trim().slice(0, 240);
  const addrLoc = extractCityCountryFromAddress(orderAddress);

  if (existing) {
    const prevParsed = parseCityCountry(existing.location, existing.city, existing.country);
    const emailOwnedByOther = rawOrderEmail
      ? customers.some(
          (c) => c.id !== existing.id && normalizeEmail(c.email) === normalizeEmail(rawOrderEmail)
        )
      : false;
    const safeOrderEmail = emailOwnedByOther ? '' : rawOrderEmail;
    const nextName = ((existing.name || '').trim() || orderName).slice(0, 120);
    const nextEmail = ((existing.email || '').trim() || safeOrderEmail).slice(0, 160);
    const nextPhone = ((existing.phone || '').trim() || orderPhone).slice(0, 40);
    const nextShippingAddress = (existing.shippingAddress?.trim() || orderAddress || '').slice(0, 240);
    const nextCity = (prevParsed.city || addrLoc.city).slice(0, 80);
    const nextCountry = (prevParsed.country || addrLoc.country).slice(0, 80);
    const nextLocation = formatLocation(nextCity, nextCountry, existing.location || nextShippingAddress);

    const changed =
      nextName !== existing.name ||
      nextEmail !== existing.email ||
      nextPhone !== existing.phone ||
      nextShippingAddress !== (existing.shippingAddress || '') ||
      nextCity !== (existing.city || '') ||
      nextCountry !== (existing.country || '') ||
      nextLocation !== existing.location;

    const updated: Customer = {
      ...existing,
      name: nextName,
      email: nextEmail,
      phone: nextPhone,
      location: nextLocation,
      shippingAddress: nextShippingAddress,
      city: nextCity,
      country: nextCountry,
      updatedAt: changed ? nowIso : existing.updatedAt,
    };

    return { customer: updated, isNew: false, changed };
  }

  // Avoid inheriting a leftover email that already belongs to a different customer
  const emailOwner = rawOrderEmail
    ? customers.find((c) => normalizeEmail(c.email) === normalizeEmail(rawOrderEmail))
    : undefined;
  const orderEmail = emailOwner ? '' : rawOrderEmail;

  const safeId =
    order.customerId &&
    order.customerId !== 'custom' &&
    /^[a-zA-Z0-9_-]+$/.test(order.customerId) &&
    !customers.some((c) => c.id === order.customerId)
      ? order.customerId
      : createSafeId('cust');

  const location = formatLocation(addrLoc.city, addrLoc.country, orderAddress);

  const created: Customer = {
    id: safeId,
    ownerId,
    name: orderName || 'Customer',
    email: orderEmail,
    phone: orderPhone,
    location,
    shippingAddress: orderAddress,
    city: addrLoc.city,
    country: addrLoc.country,
    notes: '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return { customer: created, isNew: true, changed: true };
}

export function assignCustomerSegment(
  totalOrders: number,
  totalSpent: number,
  rules: CustomerSegmentRules = DEFAULT_SEGMENT_RULES
): CustomerSegment {
  if (totalSpent >= rules.vipMinSpend || totalOrders >= rules.vipMinOrders) {
    return 'vip';
  }
  if (totalOrders >= rules.activeMinOrders) {
    return 'active';
  }
  return 'new';
}

export function getOrdersForCustomer(customer: Customer, orders: Order[]): Order[] {
  const seenIds = new Set<string>();
  const customerEmail = normalizeEmail(customer.email);
  const customerPhoneValid = normalizePhone(customer.phone).length >= 5;
  const matched: Order[] = [];

  for (const order of orders) {
    if (seenIds.has(order.id)) continue;
    const contradicts = doesOrderContradictCustomer(order, customer);
    const idMatch = order.customerId === customer.id && !contradicts;
    const phoneMatch = phonesMatch(order.customerPhone, customer.phone);
    const orderPhoneValid = normalizePhone(order.customerPhone).length >= 5;
    const emailMatch = Boolean(
      customerEmail &&
        normalizeEmail(order.customerEmail) === customerEmail &&
        !(customerPhoneValid && orderPhoneValid && !phoneMatch && !namesLookCompatible(order.customerName, customer.name))
    );

    if (idMatch || phoneMatch || emailMatch) {
      seenIds.add(order.id);
      matched.push(order);
    }
  }

  matched.sort(
    (a, b) =>
      (b.orderDate || '').localeCompare(a.orderDate || '') ||
      (b.orderNumber || '').localeCompare(a.orderNumber || '')
  );
  return matched;
}

export function buildCustomerMetricsList(
  customers: Customer[],
  orders: Order[],
  rules: CustomerSegmentRules = DEFAULT_SEGMENT_RULES,
  currencyConfig?: CurrencyConfig
): CustomerComputedMetrics[] {
  return customers.map((customer) => {
    const customerOrders = getOrdersForCustomer(customer, orders);
    const activeOrders = customerOrders.filter(
      (o) => o.status !== 'cancelled' && o.status !== 'returned'
    );

    const totalOrders = activeOrders.length;
    const totalSpent = Number(
      activeOrders
        .reduce((sum, o) => {
          const amt = Math.max(0, Number(o.totalAmount) || 0);
          if (!currencyConfig) return sum + amt;
          const res = resolveReportingAmount({
            amount: amt,
            recordCurrency: o.currency,
            recordedExchangeRate: o.exchangeRate,
            recordedConvertedAmount: o.convertedAmount,
            recordedReportingCurrency: o.reportingCurrency,
            config: currencyConfig,
          });
          return res.ok ? sum + res.amount : sum;
        }, 0)
        .toFixed(2)
    );
    const lastOrderDate = customerOrders.length > 0 ? customerOrders[0].orderDate : null;
    const parsedLoc = parseCityCountry(customer.location, customer.city, customer.country);
    const shippingAddress =
      (customer.shippingAddress || '').trim() ||
      (customerOrders.find((o) => (o.shippingAddress || '').trim())?.shippingAddress ?? '');
    const segment = assignCustomerSegment(totalOrders, totalSpent, rules);

    return {
      customer,
      city: parsedLoc.city,
      country: parsedLoc.country,
      shippingAddress,
      totalOrders,
      allOrdersCount: customerOrders.length,
      totalSpent,
      lastOrderDate,
      segment,
      orders: customerOrders,
    };
  });
}

export function computeCrmInsights(
  metricsList: CustomerComputedMetrics[],
  currentMonthIso?: string
): CrmInsights {
  const now = new Date();
  const targetMonth =
    currentMonthIso ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let newCustomersThisMonth = 0;
  let returningCustomers = 0;
  let vipCustomers = 0;

  for (const item of metricsList) {
    const addedMonth = (item.customer.createdAt || '').slice(0, 7);
    if (addedMonth === targetMonth) {
      newCustomersThisMonth += 1;
    }
    if (item.totalOrders >= 2) {
      returningCustomers += 1;
    }
    if (item.segment === 'vip') {
      vipCustomers += 1;
    }
  }

  const topCustomers = [...metricsList]
    .sort((a, b) => b.totalSpent - a.totalSpent || b.totalOrders - a.totalOrders)
    .slice(0, 5);

  return {
    totalCustomers: metricsList.length,
    newCustomersThisMonth,
    returningCustomers,
    vipCustomers,
    topCustomers,
  };
}

export interface CustomerBackfillPlan {
  customersToCreate: Customer[];
  matchedOrdersCount: number;
}

/**
 * Inspects all orders for a store and builds a strictly non-destructive, idempotent backfill plan:
 * - NEVER modifies existing order documents (historical orders match at read time by phone/email).
 * - NEVER modifies pre-existing customer documents (preserves all existing customer records).
 * - Handles legacy orders with missing non-contact fields as long as usable phone or email is present.
 * - Matches by normalized phone first, then normalized email, preventing duplicate customer profiles.
 * - Creates only missing customer profiles from valid order contact information.
 */
export function computeCustomerBackfillPlan(
  customers: Customer[],
  orders: Order[],
  ownerId: string,
  suppressedCustomerIds?: Set<string>
): CustomerBackfillPlan {
  const workingCustomers: Customer[] = customers.map((c) => ({ ...c }));
  const createdIds = new Set<string>();
  let matchedOrdersCount = 0;

  // Process chronologically (oldest first) so earliest order initializes a new profile cleanly
  const chronologicalOrders = [...orders].sort(
    (a, b) =>
      (a.orderDate || '').localeCompare(b.orderDate || '') ||
      (a.orderNumber || '').localeCompare(b.orderNumber || '')
  );

  for (const order of chronologicalOrders) {
    if (order.ownerId && order.ownerId !== ownerId) continue;

    const hasValidPhone = normalizePhone(order.customerPhone).length >= 5;
    const hasValidEmail = normalizeEmail(order.customerEmail).length >= 3;
    if (!hasValidPhone && !hasValidEmail) continue;

    if (order.customerId && suppressedCustomerIds?.has(order.customerId)) {
      continue;
    }

    const linkedById = order.customerId
      ? workingCustomers.find((c) => c.id === order.customerId)
      : undefined;
    const isMislinked = Boolean(linkedById && doesOrderContradictCustomer(order, linkedById));
    if (linkedById && !isMislinked) {
      continue;
    }

    // Match unlinked or mislinked order by normalized phone first, then normalized email
    const matched = findMatchingCustomer(workingCustomers, {
      phone: order.customerPhone,
      email: order.customerEmail,
      name: order.customerName,
    });

    if (matched) {
      // Preserve existing customer documents untouched; only enrich a newly staged (not-yet-persisted) profile
      if (createdIds.has(matched.id)) {
        const addrLoc = extractCityCountryFromAddress(order.shippingAddress);
        const parsed = parseCityCountry(matched.location, matched.city, matched.country);
        const rawOrderEmail = (order.customerEmail || '').trim();
        const emailOwnedByOther = rawOrderEmail
          ? workingCustomers.some(
              (c) => c.id !== matched.id && normalizeEmail(c.email) === normalizeEmail(rawOrderEmail)
            )
          : false;
        const safeOrderEmail = emailOwnedByOther ? '' : rawOrderEmail;

        matched.name = ((matched.name || '').trim() || (order.customerName || '').trim() || 'Customer').slice(0, 120);
        matched.email = ((matched.email || '').trim() || safeOrderEmail).slice(0, 160);
        matched.phone = ((matched.phone || '').trim() || (order.customerPhone || '').trim()).slice(0, 40);
        matched.shippingAddress = (
          (matched.shippingAddress || '').trim() || (order.shippingAddress || '').trim()
        ).slice(0, 240);
        matched.city = (parsed.city || addrLoc.city).slice(0, 80);
        matched.country = (parsed.country || addrLoc.country).slice(0, 80);
        matched.location = formatLocation(
          matched.city,
          matched.country,
          matched.location || matched.shippingAddress
        );
      }
      matchedOrdersCount += 1;
      continue;
    }

    // Create missing customer profile from the unlinked/mislinked order without modifying the order itself
    const reconciled = reconcileCustomerFromOrder(
      workingCustomers,
      {
        customerId: isMislinked || order.customerId === 'custom' ? '' : order.customerId,
        customerName: order.customerName || '',
        customerEmail: order.customerEmail || '',
        customerPhone: order.customerPhone || '',
        shippingAddress: order.shippingAddress || '',
      },
      ownerId
    );

    workingCustomers.push(reconciled.customer);
    createdIds.add(reconciled.customer.id);
    matchedOrdersCount += 1;
  }

  return {
    customersToCreate: workingCustomers.filter((c) => createdIds.has(c.id)),
    matchedOrdersCount,
  };
}
