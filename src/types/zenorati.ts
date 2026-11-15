export type NavSection =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'customers'
  | 'inventory'
  | 'finance'
  | 'marketing'
  | 'research'
  | 'assistant'
  | 'reports'
  | 'automations'
  | 'integrations'
  | 'profile'
  | 'invitations'
  | 'settings'
  | 'sa_overview'
  | 'sa_users'
  | 'sa_stores'
  | 'sa_invitations'
  | 'sa_roles'
  | 'sa_audit';

export type CurrencyCode = 'USD' | 'EGP' | 'EUR' | 'GBP' | 'CAD' | 'AUD';

export type AppLanguage = 'en' | 'ar';

export type ExchangeRateMode = 'cbe_official' | 'manual_override';

export type CbeRateSyncStatus =
  | 'synced'
  | 'checking'
  | 'no_change'
  | 'unavailable'
  | 'outdated';

export interface CbeOfficialRate {
  currencyPair: 'USD/EGP';
  buyRate: number;
  sellRate: number;
  defaultRate: number;
  source: string;
  sourceUrl: string;
  publicationDate: string; // YYYY-MM-DD from CBE
  lastSyncedAt: string; // ISO 8601 UTC timestamp
  lastChangedAt: string; // ISO 8601 UTC timestamp
}

export interface CbeSyncState {
  status: CbeRateSyncStatus;
  officialRate: CbeOfficialRate | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  isOutdated: boolean;
  schedulerActive: boolean;
  checkIntervalMinutes: number;
  nextScheduledCheckAt: string | null;
}

export interface CurrencyConfig {
  reportingCurrency: CurrencyCode;
  usdToEgpRate: number;
  legacyCurrency?: CurrencyCode;
  language?: AppLanguage;
  exchangeRateMode?: ExchangeRateMode;
  cbePublicationDate?: string;
  rateSource?: string;
}

export type ProductStatus = 'active' | 'draft' | 'archived';

export type ProductImageKey = 'headphones' | 'kettle' | 'keyboard' | 'folio' | 'none';

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type OrderChannel = 'Direct Store' | 'Wholesale' | 'Marketplace' | 'Manual';

export type ExpenseCategory =
  | 'Marketing'
  | 'Shipping'
  | 'Packaging'
  | 'Software'
  | 'Operations'
  | 'Other'
  | 'Inventory'
  | 'Payroll';

export type ExpenseStatus = 'paid' | 'pending';

export type ActivityType =
  | 'order'
  | 'product'
  | 'expense'
  | 'inventory'
  | 'customer'
  | 'settings';

export type UserRole =
  | 'super_admin'
  | 'store_owner'
  | 'manager'
  | 'staff'
  | 'viewer'
  | 'owner'
  | 'admin'
  | 'user';

export type CanonicalRole = 'super_admin' | 'store_owner' | 'manager' | 'staff' | 'viewer';

export type PermissionSection =
  | 'products'
  | 'orders'
  | 'customers'
  | 'inventory'
  | 'finance'
  | 'marketing'
  | 'reports'
  | 'settings';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface SectionPermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export type SectionPermissions = Record<PermissionSection, SectionPermission>;

export type AccountStatus = 'active' | 'suspended';

export type InvitationStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface InvitationRedemption {
  inviteId: string;
  uid: string;
  email: string;
  displayName: string;
  provider: string;
  redeemedAt: string;
}

export interface InvitationRecord {
  id: string;
  codeHash: string;
  codePreview: string;
  label: string;
  createdByUid: string;
  status: InvitationStatus;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  targetEmail?: string;
  targetFullName?: string;
  targetBusinessName?: string;
  targetRole?: CanonicalRole;
  targetTenantId?: string;
  targetPermissions?: SectionPermissions;
  lastSentAt?: string;
  resendCount?: number;
  redemptions?: InvitationRedemption[];
}

export interface SuperAdminDiagnostic {
  hasAdminDoc: boolean;
  adminDocRole: string | null;
  envOwnerUidMatched: boolean;
  reason:
    | 'verified_admin_doc'
    | 'verified_owner_uid'
    | 'email_unverified'
    | 'missing_admin_doc'
    | 'role_insufficient';
}

export interface EmailDeliveryInfo {
  sent: boolean;
  provider: 'resend' | 'manual_link';
  message: string;
  mailtoUrl?: string;
}

export interface AuthSessionInfo {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoUrl: string;
  createdAt: string | null;
  providerIds: string[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  role: CanonicalRole;
  accountStatus: AccountStatus;
  tenantId: string | null;
  permissions: SectionPermissions;
  hasTenant: boolean;
  legacyOwnerShellAccess?: boolean;
  superAdminDiagnostic: SuperAdminDiagnostic;
}

export interface PlatformUserRecord {
  uid: string;
  email: string;
  fullName: string;
  photoUrl?: string;
  role: CanonicalRole;
  accountStatus: AccountStatus;
  tenantId: string | null;
  businessName?: string;
  permissions: SectionPermissions;
  invitationId?: string;
  createdByUid?: string;
  createdAt?: string;
  lastActiveAt?: string;
  updatedAt?: string;
  source?: 'users_collection' | 'legacy_tenant';
}

export interface StoreSummaryRecord {
  tenantId: string;
  ownerId: string;
  ownerEmail: string;
  businessName: string;
  currency: CurrencyCode;
  accountStatus: AccountStatus;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreInspectionReport {
  tenantId: string;
  profile: TenantProfile;
  counts: {
    products: number;
    orders: number;
    customers: number;
    expenses: number;
    members: number;
  };
  auditLogId: string;
  inspectedAt: string;
}

export interface RoleTemplateRecord {
  role: CanonicalRole;
  label: string;
  description: string;
  permissions: SectionPermissions;
  updatedAt?: string;
  updatedByUid?: string;
}

export interface AdminAuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType: 'user' | 'tenant' | 'invitation' | 'role_template' | 'system';
  targetId: string;
  targetLabel: string;
  details: string;
  createdAt: string;
}

export interface SuperAdminOverviewData {
  totalUsers: number;
  totalStores: number;
  activeAccounts: number;
  suspendedAccounts: number;
  pendingInvitations: number;
  recentAuditLogs: AdminAuditLogEntry[];
  recentUsers: PlatformUserRecord[];
}

export interface TenantProfile {
  ownerId: string;
  businessName: string;
  ownerEmail: string;
  fullName?: string;
  photoUrl?: string;
  role?: UserRole;
  accountStatus?: AccountStatus;
  invitationId?: string;
  currency: CurrencyCode;
  usdToEgpRate?: number;
  legacyCurrency?: CurrencyCode;
  language?: AppLanguage;
  exchangeRateMode?: ExchangeRateMode;
  cbeBuyRate?: number;
  cbeSellRate?: number;
  cbePublicationDate?: string;
  cbeLastSyncedAt?: string;
  cbeSource?: string;
  taxRate: number;
  lowStockThreshold: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  ownerId: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  currency?: CurrencyCode;
  stock: number;
  status: ProductStatus;
  imageKey: ProductImageKey;
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Customer {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  shippingAddress?: string;
  city?: string;
  country?: string;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export type CustomerSegment = 'new' | 'active' | 'vip';

export interface CustomerSegmentRules {
  vipMinSpend: number;
  vipMinOrders: number;
  activeMinOrders: number;
}

export interface OrderItem {
  id: string;
  ownerId: string;
  productId: string;
  productName: string;
  sku: string;
  variant: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
}

export interface OrderHistoryEntry {
  id: string;
  ownerId: string;
  status: OrderStatus;
  title: string;
  detail: string;
  createdAt: string;
}

export interface Order {
  id: string;
  ownerId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  status: OrderStatus;
  channel: OrderChannel;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingCost: number;
  totalAmount: number;
  totalCost: number;
  currency?: CurrencyCode;
  exchangeRate?: number;
  convertedAmount?: number;
  reportingCurrency?: CurrencyCode;
  rateSource?: string;
  conversionDirection?: string;
  ratePublicationDate?: string;
  rateTimestamp?: string;
  itemCount: number;
  itemsSummary: string;
  orderDate: string;
  notes: string;
  stockDeducted: boolean;
  items?: OrderItem[];
  history?: OrderHistoryEntry[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Expense {
  id: string;
  ownerId: string;
  title: string;
  category: ExpenseCategory;
  vendor: string;
  amount: number;
  currency?: CurrencyCode;
  exchangeRate?: number;
  convertedAmount?: number;
  reportingCurrency?: CurrencyCode;
  rateSource?: string;
  conversionDirection?: string;
  ratePublicationDate?: string;
  rateTimestamp?: string;
  expenseDate: string;
  status: ExpenseStatus;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BusinessActivity {
  id: string;
  ownerId: string;
  type: ActivityType;
  title: string;
  detail: string;
  amount: number;
  createdAt: string;
}

export interface ProductIdea {
  id: string;
  ownerId: string;
  name: string;
  targetPrice: number;
  estimatedCost: number;
  shippingEstimate: number;
  adCpaEstimate: number;
  currency?: CurrencyCode;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DateRangeFilter = '7d' | '30d' | '90d' | 'all';

export interface SalesSeriesPoint {
  date: string;
  label: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  orders: number;
}

export interface TopProductPerformance {
  productId: string;
  name: string;
  sku: string;
  category: string;
  imageKey: ProductImageKey;
  unitsSold: number;
  revenue: number;
  grossProfit: number;
  marginPct: number;
  stock: number;
}

export interface DashboardMetrics {
  totalRevenue: number;
  totalCogs: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPct: number;
  totalOrders: number;
  cancelledOrders: number;
  averageOrderValue: number;
  inventoryValueRetail: number;
  inventoryValueCost: number;
  lowStockCount: number;
  outOfStockCount: number;
  unconvertedCount?: number;
  salesSeries: SalesSeriesPoint[];
  expensesByCategory: Array<{ category: ExpenseCategory; amount: number; sharePct: number }>;
  topProducts: TopProductPerformance[];
}

export type FinancialGranularity = 'daily' | 'weekly' | 'monthly';

export type FinancialOrderScope = 'all_active' | 'delivered';

export interface FinancialPeriodSummary {
  periodKey: string;
  label: string;
  ordersCount: number;
  revenue: number;
  productCosts: number;
  shippingCosts: number;
  additionalExpenses: number;
  netProfit: number;
  marginPct: number;
}

export interface FinanceAnalyticsData {
  totalRevenue: number;
  orderSubtotalNet: number;
  orderTaxTotal: number;
  productCosts: number;
  orderShippingCosts: number;
  additionalExpenses: number;
  shippingExpensesInLedger: number;
  grossProfit: number;
  netProfit: number;
  profitMarginPct: number;
  orderCount: number;
  averageOrderValue: number;
  deliveredOrderCount: number;
  excludedOrderCount: number;
  unconvertedCount?: number;
  periodSummaries: FinancialPeriodSummary[];
  chartSeries: SalesSeriesPoint[];
  expensesByCategory: Array<{ category: ExpenseCategory; amount: number; sharePct: number }>;
  bestSellingProducts: TopProductPerformance[];
}

export interface CustomerComputedMetrics {
  customer: Customer;
  city: string;
  country: string;
  shippingAddress: string;
  totalOrders: number;
  allOrdersCount: number;
  totalSpent: number;
  lastOrderDate: string | null;
  segment: CustomerSegment;
  orders: Order[];
}

export interface CrmInsights {
  totalCustomers: number;
  newCustomersThisMonth: number;
  returningCustomers: number;
  vipCustomers: number;
  topCustomers: CustomerComputedMetrics[];
}
