import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, ShieldAlert } from 'lucide-react';
import { auth, googleProvider } from './lib/firebase';
import type {
  ActivityType,
  AppLanguage,
  AuthSessionInfo,
  BusinessActivity,
  CbeSyncState,
  Customer,
  DateRangeFilter,
  Expense,
  NavSection,
  Order,
  OrderHistoryEntry,
  OrderStatus,
  Product,
  ProductIdea,
  TenantProfile,
} from './types/zenorati';
import { I18nProvider, readStoredLanguage, writeStoredLanguage } from './i18n/I18nContext';
import { ar, en } from './i18n/translations';
import {
  buildCurrencyConfig,
  DEFAULT_USD_TO_EGP_RATE,
  OFFICIAL_CBE_SOURCE,
} from './utils/currency';
import {
  fetchCbeRateState,
  refreshCbeRate,
  subscribeCbeRateStream,
} from './services/cbeRateClient';
import {
  cloudAdjustStock,
  cloudCreateOrder,
  cloudDeleteCustomer,
  cloudDeleteExpense,
  cloudDeleteOrder,
  cloudDeleteProduct,
  cloudDeleteProductIdea,
  cloudSaveCustomer,
  cloudSaveExpense,
  cloudSaveProduct,
  cloudSaveProductIdea,
  cloudSyncCustomersFromOrders,
  cloudSyncTenantCbeRate,
  cloudUpdateOrder,
  cloudUpdateOrderStatus,
  cloudUpdateProfile,
  ensureExistingOwnerUserProfile,
  fetchExistingCloudTenantProfile,
  loadLocalWorkspace,
  LOCAL_TENANT_ID,
  resetLocalWorkspace,
  saveLocalWorkspace,
  seedCloudWorkspace,
  subscribeCloudWorkspace,
  touchUserLastActive,
} from './services/tenantStore';
import {
  fetchServerSessionInfo,
  redeemInvitationOnServer,
} from './services/authInviteClient';
import { computeDashboardMetrics } from './utils/analytics';
import { createSafeId } from './utils/formatters';
import {
  getDefaultPermissionsForRole,
  hasSectionPermission,
  navSectionToPermissionSection,
} from './utils/permissions';
import {
  buildHistoryEntry,
  computeDeleteOrderStockPlan,
  computeStatusTransitionStockPlan,
} from './utils/orderHelpers';
import {
  computeCustomerBackfillPlan,
  reconcileCustomerFromOrder,
} from './utils/customerHelpers';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import {
  AuthPortal,
  clearPendingInviteActivation,
  getPendingInviteActivation,
} from './components/AuthPortal';
import { AdminInvitationsView, UserProfileView } from './components/AccountAndAdminViews';
import { SuperAdminDashboardView } from './components/SuperAdminDashboardView';
import { DashboardView } from './components/DashboardView';
import { ProductsView } from './components/ProductsView';
import { OrdersView } from './components/OrdersView';
import { FinanceView } from './components/FinanceView';
import { CustomersView } from './components/CustomersView';
import { InventoryView } from './components/CustomersInventoryViews';
import {
  AiAssistantView,
  ProductResearchView,
  ReportsView,
  SettingsView,
  UnconnectedModuleView,
} from './components/SecondaryViews';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = window.localStorage.getItem('zenorati_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('zenorati_theme', theme);
    } catch {
      // Ignore storage failures
    }
  }, [theme]);

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('30d');

  // Quick modal triggers so Dashboard buttons jump straight into live creation workflows
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Firebase Auth State
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [sessionInfo, setSessionInfo] = useState<AuthSessionInfo | null>(null);
  const [workspaceGate, setWorkspaceGate] = useState<
    'loading' | 'active' | 'verify_email' | 'needs_activation' | 'suspended'
  >('loading');
  const [authGateError, setAuthGateError] = useState<string | null>(null);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [seedingCloud, setSeedingCloud] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Active Tenant Data
  const [localData, setLocalData] = useState(() => loadLocalWorkspace());
  const [cloudProfile, setCloudProfile] = useState<TenantProfile | null>(null);
  const [hasCloudTenantDoc, setHasCloudTenantDoc] = useState(false);
  const [cloudProducts, setCloudProducts] = useState<Product[]>([]);
  const [cloudCustomers, setCloudCustomers] = useState<Customer[]>([]);
  const [cloudOrders, setCloudOrders] = useState<Order[]>([]);
  const [cloudExpenses, setCloudExpenses] = useState<Expense[]>([]);
  const [cloudActivities, setCloudActivities] = useState<BusinessActivity[]>([]);
  const [cloudIdeas, setCloudIdeas] = useState<ProductIdea[]>([]);
  const [cloudHydrated, setCloudHydrated] = useState({ customers: false, orders: false });
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const syncingCustomersRef = useRef(false);
  const suppressedCustomerIdsRef = useRef<Set<string>>(new Set());
  const [cbeSyncState, setCbeSyncState] = useState<CbeSyncState | null>(null);
  const [cbeUpdateBanner, setCbeUpdateBanner] = useState<{ rate: number; date: string } | null>(
    null
  );
  const lastSyncedCbeSigRef = useRef<string>('');

  const isSuperAdmin = Boolean(sessionInfo?.isSuperAdmin);
  const isAdmin = Boolean(sessionInfo?.isAdmin || sessionInfo?.isSuperAdmin);
  const userRole = sessionInfo?.role ?? 'store_owner';
  const userPermissions = useMemo(
    () => sessionInfo?.permissions ?? getDefaultPermissionsForRole(userRole),
    [sessionInfo?.permissions, userRole]
  );
  const isCloudMode = authReady && firebaseUser !== null && workspaceGate === 'active';

  const triggerSessionRefresh = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload().catch(() => undefined);
      setFirebaseUser(auth.currentUser);
    }
    setSessionNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      setSessionNonce((n) => n + 1);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    suppressedCustomerIdsRef.current.clear();
    if (!authReady || !firebaseUser) {
      setSessionInfo(null);
      setWorkspaceGate('loading');
      setCloudProfile(null);
      setHasCloudTenantDoc(false);
      setCloudProducts([]);
      setCloudCustomers([]);
      setCloudOrders([]);
      setCloudExpenses([]);
      setCloudActivities([]);
      setCloudIdeas([]);
      setCloudHydrated({ customers: false, orders: false });
      return;
    }

    if (!firebaseUser.emailVerified) {
      setSessionInfo(null);
      setWorkspaceGate('verify_email');
      setCloudLoading(false);
      return;
    }

    let cancelled = false;
    let unsubFirestore: (() => void) | null = null;

    setWorkspaceGate('loading');
    setCloudLoading(true);
    setCloudHydrated({ customers: false, orders: false });
    setErrorBanner(null);

    const resolveSessionAndWorkspace = async () => {
      const idToken = await firebaseUser.getIdToken();
      const [serverSession, ownProfile] = await Promise.all([
        fetchServerSessionInfo(idToken).catch((sessionErr): AuthSessionInfo => {
          if (!cancelled) {
            setErrorBanner(
              sessionErr instanceof Error
                ? `Session verification failed: ${sessionErr.message}`
                : 'Session verification failed.'
            );
          }
          return {
            uid: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            emailVerified: firebaseUser.emailVerified,
            displayName: firebaseUser.displayName ?? '',
            photoUrl: firebaseUser.photoURL ?? '',
            createdAt: firebaseUser.metadata.creationTime ?? null,
            providerIds: firebaseUser.providerData.map((p) => p.providerId),
            isAdmin: false,
            isSuperAdmin: false,
            role: 'store_owner',
            accountStatus: 'active',
            tenantId: null,
            permissions: getDefaultPermissionsForRole('store_owner'),
            hasTenant: false,
            legacyOwnerShellAccess: false,
            superAdminDiagnostic: {
              hasAdminDoc: false,
              adminDocRole: null,
              envOwnerUidMatched: false,
              reason: 'missing_admin_doc',
            },
          };
        }),
        fetchExistingCloudTenantProfile(firebaseUser.uid),
      ]);

      if (cancelled) return;
      setSessionInfo(serverSession);

      if (serverSession.accountStatus === 'suspended') {
        setWorkspaceGate('suspended');
        setCloudLoading(false);
        return;
      }

      let resolvedTenantId = serverSession.tenantId || firebaseUser.uid;
      let initialProfile = ownProfile;
      if (!initialProfile && resolvedTenantId !== firebaseUser.uid) {
        initialProfile = await fetchExistingCloudTenantProfile(resolvedTenantId);
      }
      if (cancelled) return;

      let docExists = Boolean(initialProfile);

      if (!initialProfile) {
        const pending = getPendingInviteActivation(firebaseUser.uid);
        if (pending) {
          try {
            await redeemInvitationOnServer({
              idToken,
              code: pending.code,
              fullName: pending.fullName || firebaseUser.displayName || undefined,
              businessName: pending.businessName || undefined,
            });
            clearPendingInviteActivation(firebaseUser.uid);
            const refreshedSession = await fetchServerSessionInfo(idToken).catch(() => serverSession);
            if (cancelled) return;
            setSessionInfo(refreshedSession);
            if (refreshedSession.accountStatus === 'suspended') {
              setWorkspaceGate('suspended');
              setCloudLoading(false);
              return;
            }
            resolvedTenantId = refreshedSession.tenantId || firebaseUser.uid;
            initialProfile = await fetchExistingCloudTenantProfile(resolvedTenantId);
            docExists = Boolean(initialProfile);
          } catch (redeemErr) {
            clearPendingInviteActivation(firebaseUser.uid);
            if (!cancelled) {
              setAuthGateError(
                redeemErr instanceof Error
                  ? redeemErr.message
                  : 'Invitation redemption could not be completed.'
              );
              setWorkspaceGate('needs_activation');
              setCloudLoading(false);
            }
            return;
          }
        } else if (
          serverSession.isSuperAdmin ||
          serverSession.isAdmin ||
          serverSession.hasTenant ||
          serverSession.legacyOwnerShellAccess
        ) {
          // Never auto-create or overwrite a missing /tenants/{uid} document for an existing owner/tenant.
          // Provide a read-only in-memory shell so the owner can inspect their UID, admin tools, or legacy subcollections without triggering Firestore writes.
          docExists = false;
          initialProfile = {
            ownerId: resolvedTenantId,
            businessName: firebaseUser.displayName
              ? `${firebaseUser.displayName.split(' ')[0]}'s Store`
              : 'ZENORATI Store',
            ownerEmail: firebaseUser.email || '',
            ...(firebaseUser.displayName ? { fullName: firebaseUser.displayName } : {}),
            role: serverSession.role,
            accountStatus: serverSession.accountStatus,
            currency: 'USD',
            usdToEgpRate: DEFAULT_USD_TO_EGP_RATE,
            language,
            taxRate: 8.25,
            lowStockThreshold: 12,
          };
        } else {
          if (!cancelled) {
            setWorkspaceGate('needs_activation');
            setCloudLoading(false);
          }
          return;
        }
      } else {
        clearPendingInviteActivation(firebaseUser.uid);
      }

      if (cancelled || !initialProfile) return;

      if (initialProfile.accountStatus === 'suspended') {
        setWorkspaceGate('suspended');
        setCloudLoading(false);
        return;
      }

      if (docExists && resolvedTenantId === firebaseUser.uid) {
        void ensureExistingOwnerUserProfile({
          uid: firebaseUser.uid,
          email: firebaseUser.email || initialProfile.ownerEmail || '',
          fullName: initialProfile.fullName || firebaseUser.displayName || '',
          businessName: initialProfile.businessName,
          photoUrl: initialProfile.photoUrl || firebaseUser.photoURL || undefined,
        });
      } else {
        void touchUserLastActive(firebaseUser.uid);
      }

      setAuthGateError(null);
      setHasCloudTenantDoc(docExists);
      setCloudProfile(initialProfile);
      setWorkspaceGate('active');

      unsubFirestore = subscribeCloudWorkspace(resolvedTenantId, {
        onProfile: (p) => {
          setHasCloudTenantDoc(true);
          setCloudProfile(p);
          if (p.accountStatus === 'suspended') {
            setWorkspaceGate('suspended');
          }
        },
        onProducts: (p) => setCloudProducts(p),
        onCustomers: (c) => {
          setCloudCustomers(c);
          setCloudHydrated((prev) => (prev.customers ? prev : { ...prev, customers: true }));
        },
        onOrders: (o) => {
          setCloudOrders(o);
          setCloudHydrated((prev) => (prev.orders ? prev : { ...prev, orders: true }));
        },
        onExpenses: (e) => setCloudExpenses(e),
        onActivities: (a) => setCloudActivities(a),
        onIdeas: (i) => setCloudIdeas(i),
        onError: (err) => setErrorBanner(err.message),
      });
    };

    void resolveSessionAndWorkspace()
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Unable to load tenant workspace.';
          setErrorBanner(msg);
          setAuthGateError(msg);
          setWorkspaceGate('needs_activation');
        }
      })
      .finally(() => {
        if (!cancelled) setCloudLoading(false);
      });

    return () => {
      cancelled = true;
      if (unsubFirestore) unsubFirestore();
    };
  }, [authReady, firebaseUser, sessionNonce]);

  useEffect(() => {
    if (activeSection.startsWith('sa_') && !isSuperAdmin) {
      setActiveSection('dashboard');
      return;
    }
    if (activeSection === 'invitations' && !isAdmin) {
      setActiveSection('dashboard');
      return;
    }
    const permSection = navSectionToPermissionSection(activeSection);
    if (permSection && !hasSectionPermission(userPermissions, userRole, permSection, 'view')) {
      setActiveSection('dashboard');
    }
  }, [activeSection, isSuperAdmin, isAdmin, userPermissions, userRole]);

  const [language, setLanguage] = useState<AppLanguage>(
    () => readStoredLanguage(LOCAL_TENANT_ID) ?? 'en'
  );

  const activeOwnerId = isCloudMode
    ? sessionInfo?.tenantId || firebaseUser.uid
    : LOCAL_TENANT_ID;

  const activeProfile: TenantProfile = isCloudMode
    ? cloudProfile ?? {
        ownerId: activeOwnerId,
        businessName: 'ZENORATI Store',
        ownerEmail: firebaseUser.email || '',
        currency: 'USD',
        usdToEgpRate: DEFAULT_USD_TO_EGP_RATE,
        language,
        taxRate: 8.25,
        lowStockThreshold: 12,
      }
    : localData.profile;
  const activeProducts = isCloudMode ? cloudProducts : localData.products;
  const activeCustomers = isCloudMode ? cloudCustomers : localData.customers;
  const activeOrders = isCloudMode ? cloudOrders : localData.orders;
  const activeExpenses = isCloudMode ? cloudExpenses : localData.expenses;
  const activeActivities = isCloudMode ? cloudActivities : localData.activities;
  const activeIdeas = isCloudMode ? cloudIdeas : localData.researchIdeas;

  useEffect(() => {
    if (!authReady) return;
    if (isCloudMode && firebaseUser) {
      if (cloudProfile?.language === 'ar' || cloudProfile?.language === 'en') {
        setLanguage(cloudProfile.language);
        writeStoredLanguage(cloudProfile.language, firebaseUser.uid);
      } else {
        const stored = readStoredLanguage(firebaseUser.uid);
        if (stored) setLanguage(stored);
      }
    } else {
      const localLang = localData.profile.language ?? readStoredLanguage(LOCAL_TENANT_ID);
      if (localLang === 'ar' || localLang === 'en') {
        setLanguage(localLang);
      }
    }
  }, [authReady, isCloudMode, firebaseUser, cloudProfile?.language, localData.profile.language]);

  useEffect(() => {
    void fetchCbeRateState()
      .then((state) => setCbeSyncState(state))
      .catch(() => undefined);
    const unsub = subscribeCbeRateStream((nextState) => {
      setCbeSyncState(nextState);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || cloudLoading) return;
    if (
      isCloudMode &&
      (!cloudProfile ||
        !hasCloudTenantDoc ||
        !hasSectionPermission(userPermissions, userRole, 'settings', 'edit'))
    ) {
      return;
    }
    const official = cbeSyncState?.officialRate;
    if (!official) return;

    const mode = activeProfile.exchangeRateMode ?? 'cbe_official';
    const rateChanged =
      activeProfile.cbeSellRate !== official.sellRate ||
      activeProfile.cbeBuyRate !== official.buyRate ||
      activeProfile.cbePublicationDate !== official.publicationDate;
    const modeNeedsSync = mode === 'cbe_official' && activeProfile.usdToEgpRate !== official.sellRate;

    if (!rateChanged && !modeNeedsSync) return;

    const sig = `${activeOwnerId}|${official.publicationDate}|${official.buyRate}|${official.sellRate}|${mode}`;
    if (lastSyncedCbeSigRef.current === sig) return;
    lastSyncedCbeSigRef.current = sig;

    if (
      activeProfile.cbeSellRate !== undefined &&
      activeProfile.cbeSellRate !== official.sellRate &&
      mode === 'cbe_official'
    ) {
      setCbeUpdateBanner({ rate: official.sellRate, date: official.publicationDate });
    }

    const patch: Pick<
      TenantProfile,
      | 'cbeBuyRate'
      | 'cbeSellRate'
      | 'cbePublicationDate'
      | 'cbeLastSyncedAt'
      | 'cbeSource'
      | 'exchangeRateMode'
      | 'usdToEgpRate'
    > = {
      exchangeRateMode: mode,
      cbeBuyRate: official.buyRate,
      cbeSellRate: official.sellRate,
      cbePublicationDate: official.publicationDate,
      cbeLastSyncedAt: official.lastSyncedAt,
      cbeSource: OFFICIAL_CBE_SOURCE,
      ...(mode === 'cbe_official' ? { usdToEgpRate: official.sellRate } : {}),
    };

    if (isCloudMode && firebaseUser) {
      void cloudSyncTenantCbeRate(activeOwnerId, patch).catch(() => {
        lastSyncedCbeSigRef.current = '';
      });
    } else {
      updateLocal((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      }));
    }
  }, [
    authReady,
    cloudLoading,
    isCloudMode,
    cloudProfile,
    hasCloudTenantDoc,
    firebaseUser,
    cbeSyncState,
    activeOwnerId,
    userPermissions,
    userRole,
    activeProfile.exchangeRateMode,
    activeProfile.cbeSellRate,
    activeProfile.cbeBuyRate,
    activeProfile.cbePublicationDate,
    activeProfile.usdToEgpRate,
  ]);

  const handleRefreshCbeRate = useCallback(async () => {
    const nextState = await refreshCbeRate();
    setCbeSyncState(nextState);
  }, []);

  const currencyConfig = useMemo(
    () =>
      buildCurrencyConfig({
        currency: activeProfile.currency,
        usdToEgpRate: activeProfile.usdToEgpRate,
        legacyCurrency: activeProfile.legacyCurrency,
        language,
        exchangeRateMode: activeProfile.exchangeRateMode,
        cbePublicationDate:
          activeProfile.cbePublicationDate ?? cbeSyncState?.officialRate?.publicationDate,
        cbeSellRate: activeProfile.cbeSellRate ?? cbeSyncState?.officialRate?.sellRate,
      }),
    [
      activeProfile.currency,
      activeProfile.usdToEgpRate,
      activeProfile.legacyCurrency,
      activeProfile.exchangeRateMode,
      activeProfile.cbePublicationDate,
      activeProfile.cbeSellRate,
      cbeSyncState?.officialRate?.publicationDate,
      cbeSyncState?.officialRate?.sellRate,
      language,
    ]
  );

  const metrics = useMemo(
    () =>
      computeDashboardMetrics(
        activeOrders,
        activeProducts,
        activeExpenses,
        dateRange,
        activeProfile.lowStockThreshold,
        currencyConfig
      ),
    [
      activeOrders,
      activeProducts,
      activeExpenses,
      dateRange,
      activeProfile.lowStockThreshold,
      currencyConfig,
    ]
  );

  // Local state helper that always persists to localStorage
  const updateLocal = (updater: (prev: typeof localData) => typeof localData) => {
    setLocalData((prev) => {
      const next = updater(prev);
      saveLocalWorkspace(next);
      return next;
    });
  };

  const pushLocalActivity = (
    list: BusinessActivity[],
    type: ActivityType,
    title: string,
    detail: string,
    amount = 0
  ): BusinessActivity[] => {
    const entry: BusinessActivity = {
      id: createSafeId('act'),
      ownerId: LOCAL_TENANT_ID,
      type,
      title,
      detail,
      amount,
      createdAt: new Date().toISOString(),
    };
    return [entry, ...list].slice(0, 30);
  };

  // Auth Actions
  const handleSignInGoogle = async () => {
    setErrorBanner(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleSignOut = async () => {
    setErrorBanner(null);
    try {
      await signOut(auth);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  const assertSectionPermission = (
    section: Parameters<typeof hasSectionPermission>[2],
    action: Parameters<typeof hasSectionPermission>[3]
  ) => {
    if (!isCloudMode) return;
    if (!hasSectionPermission(userPermissions, userRole, section, action)) {
      const dict = language === 'ar' ? ar : en;
      throw new Error(dict.saReadOnlyBanner);
    }
  };

  const handleSeedCloudSample = async () => {
    if (!firebaseUser) return;
    assertSectionPermission('settings', 'edit');
    setSeedingCloud(true);
    setErrorBanner(null);
    try {
      await seedCloudWorkspace(activeOwnerId, firebaseUser.email || 'owner@zenorati.app');
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load sample store data.');
    } finally {
      setSeedingCloud(false);
    }
  };

  // Unified CRUD Handlers
  const handleSaveProfile = async (next: TenantProfile) => {
    const resolvedLang = next.language ?? language;
    const normalizedProfile: TenantProfile = {
      ...next,
      language: resolvedLang,
    };
    setLanguage(resolvedLang);
    writeStoredLanguage(resolvedLang, activeOwnerId);

    if (isCloudMode) {
      assertSectionPermission('settings', 'edit');
      if (!hasCloudTenantDoc) {
        const dict = resolvedLang === 'ar' ? ar : en;
        throw new Error(
          dict.missingTenantDocSaveError.replace('{{uid}}', activeOwnerId)
        );
      }
      await cloudUpdateProfile(activeOwnerId, normalizedProfile);
    } else {
      updateLocal((prev) => ({
        ...prev,
        profile: normalizedProfile,
        activities: pushLocalActivity(
          prev.activities,
          'settings',
          'Workspace settings updated',
          normalizedProfile.businessName,
          0
        ),
      }));
    }
  };

  const handleChangeLanguage = useCallback(
    (nextLang: AppLanguage) => {
      setLanguage(nextLang);
      writeStoredLanguage(nextLang, activeOwnerId);
      if (isCloudMode && firebaseUser) {
        const nextProfile: TenantProfile = {
          ...(cloudProfile ?? activeProfile),
          language: nextLang,
        };
        setCloudProfile(nextProfile);
        if (
          hasCloudTenantDoc &&
          hasSectionPermission(userPermissions, userRole, 'settings', 'edit')
        ) {
          void cloudUpdateProfile(activeOwnerId, nextProfile).catch((err) => {
            setErrorBanner(
              err instanceof Error ? err.message : 'Unable to save language preference.'
            );
          });
        }
      } else {
        updateLocal((prev) => ({
          ...prev,
          profile: {
            ...prev.profile,
            language: nextLang,
          },
        }));
      }
    },
    [
      activeOwnerId,
      isCloudMode,
      firebaseUser,
      hasCloudTenantDoc,
      cloudProfile,
      activeProfile,
      userPermissions,
      userRole,
    ]
  );

  const handleSaveProduct = async (product: Product, isNew: boolean) => {
    if (isCloudMode) {
      assertSectionPermission('products', isNew ? 'create' : 'edit');
      await cloudSaveProduct(activeOwnerId, product, isNew);
    } else {
      updateLocal((prev) => ({
        ...prev,
        products: isNew
          ? [product, ...prev.products]
          : prev.products.map((p) => (p.id === product.id ? product : p)),
        activities: pushLocalActivity(
          prev.activities,
          'product',
          `${isNew ? 'Added' : 'Updated'} product ${product.name}`,
          `SKU ${product.sku}`,
          product.price
        ),
      }));
    }
  };

  const handleAdjustStock = async (product: Product, nextStock: number) => {
    const clamped = Math.max(0, Math.round(nextStock));
    if (isCloudMode) {
      assertSectionPermission('inventory', 'edit');
      await cloudAdjustStock(activeOwnerId, product, clamped);
    } else {
      updateLocal((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          p.id === product.id
            ? { ...p, stock: clamped, updatedAt: new Date().toISOString() }
            : p
        ),
        activities: pushLocalActivity(
          prev.activities,
          'inventory',
          `Adjusted stock for ${product.name}`,
          `${product.stock} → ${clamped} units`,
          0
        ),
      }));
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    if (isCloudMode) {
      assertSectionPermission('products', 'delete');
      await cloudDeleteProduct(activeOwnerId, product);
    } else {
      updateLocal((prev) => ({
        ...prev,
        products: prev.products.filter((p) => p.id !== product.id),
        activities: pushLocalActivity(
          prev.activities,
          'product',
          `Removed product ${product.name}`,
          `SKU ${product.sku}`,
          0
        ),
      }));
    }
  };

  const handleCreateOrder = async (
    order: Order,
    stockUpdates: Array<{ product: Product; nextStock: number }>
  ) => {
    const reconciled = reconcileCustomerFromOrder(activeCustomers, order, activeOwnerId);
    const orderToSave: Order = {
      ...order,
      customerId: reconciled.customer.id,
    };

    if (isCloudMode) {
      assertSectionPermission('orders', 'create');
      if (
        (reconciled.isNew || reconciled.changed) &&
        hasSectionPermission(userPermissions, userRole, 'customers', reconciled.isNew ? 'create' : 'edit')
      ) {
        await cloudSaveCustomer(activeOwnerId, reconciled.customer, reconciled.isNew);
      }
      await cloudCreateOrder(activeOwnerId, orderToSave, stockUpdates);
    } else {
      const stockMap = new Map(stockUpdates.map((s) => [s.product.id, s.nextStock]));
      const nowIso = new Date().toISOString();
      updateLocal((prev) => {
        const nextCustomers = reconciled.isNew
          ? [reconciled.customer, ...prev.customers]
          : reconciled.changed
          ? prev.customers.map((c) => (c.id === reconciled.customer.id ? reconciled.customer : c))
          : prev.customers;
        return {
          ...prev,
          customers: nextCustomers,
          orders: [orderToSave, ...prev.orders],
          products: prev.products.map((p) =>
            stockMap.has(p.id)
              ? { ...p, stock: Math.max(0, Math.round(stockMap.get(p.id)!)), updatedAt: nowIso }
              : p
          ),
          activities: pushLocalActivity(
            prev.activities,
            'order',
            `Created order ${orderToSave.orderNumber}`,
            `${orderToSave.customerName} · ${orderToSave.itemCount} item(s)`,
            orderToSave.totalAmount
          ),
        };
      });
    }
  };

  const handleUpdateOrder = async (
    previousOrder: Order,
    updatedOrder: Order,
    stockUpdates: Array<{ product: Product; nextStock: number }>,
    historyEntry: OrderHistoryEntry
  ) => {
    const reconciled = reconcileCustomerFromOrder(activeCustomers, updatedOrder, activeOwnerId);
    const orderWithHistory: Order = {
      ...updatedOrder,
      customerId: reconciled.customer.id,
      history: [historyEntry, ...(updatedOrder.history ?? [])],
    };
    if (isCloudMode) {
      assertSectionPermission('orders', 'edit');
      if (
        (reconciled.isNew || reconciled.changed) &&
        hasSectionPermission(userPermissions, userRole, 'customers', reconciled.isNew ? 'create' : 'edit')
      ) {
        await cloudSaveCustomer(activeOwnerId, reconciled.customer, reconciled.isNew);
      }
      await cloudUpdateOrder(
        activeOwnerId,
        previousOrder,
        orderWithHistory,
        stockUpdates,
        historyEntry
      );
    } else {
      const stockMap = new Map(stockUpdates.map((s) => [s.product.id, s.nextStock]));
      const nowIso = new Date().toISOString();
      updateLocal((prev) => {
        const nextCustomers = reconciled.isNew
          ? [reconciled.customer, ...prev.customers]
          : reconciled.changed
          ? prev.customers.map((c) => (c.id === reconciled.customer.id ? reconciled.customer : c))
          : prev.customers;
        return {
          ...prev,
          customers: nextCustomers,
          orders: prev.orders.map((o) => (o.id === orderWithHistory.id ? orderWithHistory : o)),
          products: prev.products.map((p) =>
            stockMap.has(p.id)
              ? { ...p, stock: Math.max(0, Math.round(stockMap.get(p.id)!)), updatedAt: nowIso }
              : p
          ),
          activities: pushLocalActivity(
            prev.activities,
            'order',
            `Updated order ${orderWithHistory.orderNumber}`,
            `${orderWithHistory.customerName} · ${orderWithHistory.itemCount} item(s)`,
            orderWithHistory.totalAmount
          ),
        };
      });
    }
    if (selectedOrder?.id === orderWithHistory.id) {
      setSelectedOrder(orderWithHistory);
    }
  };

  const handleUpdateOrderStatus = async (order: Order, nextStatus: OrderStatus): Promise<Order> => {
    if (order.status === nextStatus) return order;
    if (order.status === 'cancelled' || order.status === 'returned') {
      throw new Error(`Order ${order.orderNumber} is already ${order.status} and locked.`);
    }

    const plan = computeStatusTransitionStockPlan(activeProducts, order, nextStatus);
    if (!plan.ok) {
      throw new Error(plan.error);
    }

    let histTitle = `Status updated to ${nextStatus}`;
    let histDetail = `Changed from ${order.status} to ${nextStatus}.`;
    if (!order.stockDeducted && plan.nextStockDeducted) {
      histTitle = `Order confirmed (${nextStatus}) & stock deducted`;
      histDetail = `Allocated ${order.itemCount} unit(s) from product inventory.`;
    } else if (order.stockDeducted && !plan.nextStockDeducted) {
      histTitle = `Order ${nextStatus} & stock restored`;
      histDetail = `Restored ${order.itemCount} unit(s) back to product inventory.`;
    }

    const historyEntry = buildHistoryEntry(activeOwnerId, nextStatus, histTitle, histDetail);
    const nowIso = new Date().toISOString();
    const updatedOrder: Order = {
      ...order,
      status: nextStatus,
      stockDeducted: plan.nextStockDeducted,
      history: [historyEntry, ...(order.history ?? [])],
      updatedAt: nowIso,
    };

    if (isCloudMode) {
      assertSectionPermission('orders', 'edit');
      await cloudUpdateOrderStatus(
        activeOwnerId,
        order,
        nextStatus,
        plan.nextStockDeducted,
        plan.stockUpdates,
        historyEntry
      );
    } else {
      const stockMap = new Map(plan.stockUpdates.map((s) => [s.product.id, s.nextStock]));
      updateLocal((prev) => ({
        ...prev,
        orders: prev.orders.map((o) => (o.id === order.id ? updatedOrder : o)),
        products: prev.products.map((p) =>
          stockMap.has(p.id)
            ? { ...p, stock: Math.max(0, Math.round(stockMap.get(p.id)!)), updatedAt: nowIso }
            : p
        ),
        activities: pushLocalActivity(
          prev.activities,
          'order',
          `Order ${order.orderNumber} marked ${nextStatus}`,
          histDetail,
          nextStatus === 'cancelled' || nextStatus === 'returned' ? 0 : order.totalAmount
        ),
      }));
    }

    if (selectedOrder?.id === order.id) {
      setSelectedOrder(updatedOrder);
    }
    return updatedOrder;
  };

  const handleDeleteOrder = async (order: Order) => {
    const stockUpdates = computeDeleteOrderStockPlan(activeProducts, order);
    if (isCloudMode) {
      assertSectionPermission('orders', 'delete');
      await cloudDeleteOrder(activeOwnerId, order, stockUpdates);
    } else {
      const stockMap = new Map(stockUpdates.map((s) => [s.product.id, s.nextStock]));
      const nowIso = new Date().toISOString();
      updateLocal((prev) => ({
        ...prev,
        orders: prev.orders.filter((o) => o.id !== order.id),
        products: prev.products.map((p) =>
          stockMap.has(p.id)
            ? { ...p, stock: Math.max(0, Math.round(stockMap.get(p.id)!)), updatedAt: nowIso }
            : p
        ),
        activities: pushLocalActivity(
          prev.activities,
          'order',
          `Deleted order ${order.orderNumber}`,
          stockUpdates.length > 0 ? `${order.customerName} · stock restored` : order.customerName,
          0
        ),
      }));
    }
    if (selectedOrder?.id === order.id) {
      setSelectedOrder(null);
    }
  };

  const handleSaveExpense = async (expense: Expense, isNew: boolean) => {
    if (isCloudMode) {
      assertSectionPermission('finance', isNew ? 'create' : 'edit');
      await cloudSaveExpense(activeOwnerId, expense, isNew);
    } else {
      updateLocal((prev) => ({
        ...prev,
        expenses: isNew
          ? [expense, ...prev.expenses]
          : prev.expenses.map((e) => (e.id === expense.id ? expense : e)),
        activities: pushLocalActivity(
          prev.activities,
          'expense',
          `${isNew ? 'Logged' : 'Updated'} expense: ${expense.title}`,
          `${expense.category} · ${expense.vendor}`,
          -expense.amount
        ),
      }));
    }
  };

  const handleDeleteExpense = async (expense: Expense) => {
    if (isCloudMode) {
      assertSectionPermission('finance', 'delete');
      await cloudDeleteExpense(activeOwnerId, expense);
    } else {
      updateLocal((prev) => ({
        ...prev,
        expenses: prev.expenses.filter((e) => e.id !== expense.id),
        activities: pushLocalActivity(
          prev.activities,
          'expense',
          `Removed expense: ${expense.title}`,
          expense.category,
          0
        ),
      }));
    }
  };

  const handleSaveCustomer = async (customer: Customer, isNew: boolean) => {
    if (isCloudMode) {
      assertSectionPermission('customers', isNew ? 'create' : 'edit');
      await cloudSaveCustomer(activeOwnerId, customer, isNew);
    } else {
      updateLocal((prev) => ({
        ...prev,
        customers: isNew
          ? [customer, ...prev.customers]
          : prev.customers.map((c) => (c.id === customer.id ? customer : c)),
        activities: isNew
          ? pushLocalActivity(
              prev.activities,
              'customer',
              `Added customer ${customer.name}`,
              customer.email,
              0
            )
          : prev.activities,
      }));
    }
  };

  const handleDeleteCustomer = async (customer: Customer) => {
    suppressedCustomerIdsRef.current.add(customer.id);
    if (isCloudMode) {
      assertSectionPermission('customers', 'delete');
      await cloudDeleteCustomer(activeOwnerId, customer);
    } else {
      updateLocal((prev) => ({
        ...prev,
        customers: prev.customers.filter((c) => c.id !== customer.id),
      }));
    }
  };

  const runCustomerBackfillSync = useCallback(
    async (ignoreSuppressed = false): Promise<{ created: number; matched: number }> => {
      if (syncingCustomersRef.current) return { created: 0, matched: 0 };
      const suppressed = ignoreSuppressed ? undefined : suppressedCustomerIdsRef.current;

      if (isCloudMode) {
        if (
          !firebaseUser ||
          !cloudHydrated.customers ||
          !cloudHydrated.orders ||
          !hasCloudTenantDoc ||
          !hasSectionPermission(userPermissions, userRole, 'customers', 'create')
        ) {
          return { created: 0, matched: 0 };
        }
        const plan = computeCustomerBackfillPlan(
          cloudCustomers,
          cloudOrders,
          activeOwnerId,
          suppressed
        );
        if (plan.customersToCreate.length === 0) {
          return { created: 0, matched: plan.matchedOrdersCount };
        }

        syncingCustomersRef.current = true;
        setSyncingCustomers(true);
        try {
          await cloudSyncCustomersFromOrders(activeOwnerId, plan);
          return {
            created: plan.customersToCreate.length,
            matched: plan.matchedOrdersCount,
          };
        } finally {
          syncingCustomersRef.current = false;
          setSyncingCustomers(false);
        }
      }

      const plan = computeCustomerBackfillPlan(
        localData.customers,
        localData.orders,
        LOCAL_TENANT_ID,
        suppressed
      );
      if (plan.customersToCreate.length === 0) {
        return { created: 0, matched: plan.matchedOrdersCount };
      }

      updateLocal((prev) => ({
        ...prev,
        customers: [...plan.customersToCreate, ...prev.customers],
        activities: pushLocalActivity(
          prev.activities,
          'customer',
          `Created ${plan.customersToCreate.length} missing customer profile${plan.customersToCreate.length === 1 ? '' : 's'} from orders`,
          plan.customersToCreate.map((c) => c.name).slice(0, 3).join(', '),
          0
        ),
      }));

      return {
        created: plan.customersToCreate.length,
        matched: plan.matchedOrdersCount,
      };
    },
    [
      isCloudMode,
      firebaseUser,
      activeOwnerId,
      cloudHydrated.customers,
      cloudHydrated.orders,
      hasCloudTenantDoc,
      userPermissions,
      userRole,
      cloudCustomers,
      cloudOrders,
      localData.customers,
      localData.orders,
    ]
  );

  useEffect(() => {
    if (!authReady) return;
    if (
      isCloudMode &&
      (!cloudHydrated.customers ||
        !cloudHydrated.orders ||
        !hasCloudTenantDoc ||
        !hasSectionPermission(userPermissions, userRole, 'customers', 'create'))
    ) {
      return;
    }
    void runCustomerBackfillSync(false).catch((err) => {
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to synchronize customers from orders.'
      );
    });
  }, [
    authReady,
    isCloudMode,
    cloudHydrated.customers,
    cloudHydrated.orders,
    hasCloudTenantDoc,
    userPermissions,
    userRole,
    runCustomerBackfillSync,
  ]);

  const handleSaveIdea = async (idea: ProductIdea, isNew: boolean) => {
    if (isCloudMode) {
      assertSectionPermission('products', isNew ? 'create' : 'edit');
      await cloudSaveProductIdea(activeOwnerId, idea, isNew);
    } else {
      updateLocal((prev) => ({
        ...prev,
        researchIdeas: isNew
          ? [idea, ...prev.researchIdeas]
          : prev.researchIdeas.map((i) => (i.id === idea.id ? idea : i)),
      }));
    }
  };

  const handleDeleteIdea = async (ideaId: string) => {
    if (isCloudMode) {
      assertSectionPermission('products', 'delete');
      await cloudDeleteProductIdea(activeOwnerId, ideaId);
    } else {
      updateLocal((prev) => ({
        ...prev,
        researchIdeas: prev.researchIdeas.filter((i) => i.id !== ideaId),
      }));
    }
  };

  const isCloudEmpty =
    isCloudMode &&
    !cloudLoading &&
    activeProducts.length === 0 &&
    activeOrders.length === 0 &&
    activeExpenses.length === 0;

  if (!authReady || (firebaseUser !== null && workspaceGate === 'loading')) {
    return (
      <I18nProvider language={language} onChangeLanguage={handleChangeLanguage}>
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#060B18] text-slate-900 dark:text-slate-100 p-6 gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-sm animate-pulse">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6H20L8 18H20"
                stroke="white"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {language === 'ar' ? ar.authLoadingWorkspace : en.authLoadingWorkspace}
          </p>
        </div>
      </I18nProvider>
    );
  }

  if (firebaseUser && workspaceGate === 'suspended') {
    const dict = language === 'ar' ? ar : en;
    return (
      <I18nProvider language={language} onChangeLanguage={handleChangeLanguage}>
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#060B18] text-slate-900 dark:text-slate-100 p-6">
          <div className="max-w-md w-full rounded-2xl border border-rose-500/30 bg-white dark:bg-[#0B1328] p-6 shadow-xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold">{dict.saSuspendedTitle}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {dict.saSuspendedDesc}
            </p>
            <div className="text-[11px] font-mono text-slate-400" dir="ltr">
              {firebaseUser.email} · {firebaseUser.uid}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              {dict.signOut}
            </button>
          </div>
        </div>
      </I18nProvider>
    );
  }

  if (!firebaseUser || workspaceGate !== 'active') {
    const gateMode =
      !firebaseUser
        ? 'auth'
        : workspaceGate === 'verify_email'
        ? 'verify_email'
        : 'needs_activation';
    return (
      <I18nProvider language={language} onChangeLanguage={handleChangeLanguage}>
        <AuthPortal
          mode={gateMode}
          firebaseUser={firebaseUser}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          externalError={authGateError}
          onClearExternalError={() => setAuthGateError(null)}
          onSetExternalError={setAuthGateError}
          onSessionRefreshNeeded={triggerSessionRefresh}
        />
      </I18nProvider>
    );
  }

  const activePermSection = navSectionToPermissionSection(activeSection);
  const isSectionReadOnly = Boolean(
    isCloudMode &&
      activePermSection &&
      hasSectionPermission(userPermissions, userRole, activePermSection, 'view') &&
      !hasSectionPermission(userPermissions, userRole, activePermSection, 'create') &&
      !hasSectionPermission(userPermissions, userRole, activePermSection, 'edit')
  );

  return (
    <I18nProvider language={language} onChangeLanguage={handleChangeLanguage}>
      <div className="min-h-screen flex bg-slate-50 dark:bg-[#060B18] text-slate-900 dark:text-slate-100">
        <Sidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          businessName={activeProfile.businessName}
          isCloudMode={isCloudMode}
          lowStockCount={metrics.lowStockCount + metrics.outOfStockCount}
          isAdmin={isAdmin}
          isSuperAdmin={isSuperAdmin}
          userRole={userRole}
          permissions={userPermissions}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            activeSection={activeSection}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            isCloudMode={isCloudMode}
            userEmail={firebaseUser?.email ?? null}
            userDisplayName={activeProfile.fullName ?? firebaseUser?.displayName ?? null}
            onSignInGoogle={handleSignInGoogle}
            onNavigateSettings={() => setActiveSection('settings')}
            onNavigateProfile={() => setActiveSection('profile')}
          />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1480px] w-full mx-auto">
            {isCloudMode && !cloudLoading && !hasCloudTenantDoc && firebaseUser && (
              <div className="mb-5 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold">
                    {(language === 'ar' ? ar.missingTenantDocTitle : en.missingTenantDocTitle).replace(
                      '{{uid}}',
                      activeOwnerId
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90">
                    {(language === 'ar' ? ar.missingTenantDocDesc : en.missingTenantDocDesc).replace(
                      '{{email}}',
                      firebaseUser.email || '—'
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveSection('profile')}
                    className="px-3 py-1.5 rounded-lg font-semibold border border-amber-500/40 bg-white/60 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                  >
                    {language === 'ar'
                      ? ar.missingTenantDocProfileBtn
                      : en.missingTenantDocProfileBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="px-3 py-1.5 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 cursor-pointer"
                  >
                    {language === 'ar' ? ar.authBackToSignInBtn : en.authBackToSignInBtn}
                  </button>
                </div>
              </div>
            )}

            {isSectionReadOnly && (
              <div className="mb-5 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs text-blue-800 dark:text-cyan-200">
                {language === 'ar' ? ar.saReadOnlyBanner : en.saReadOnlyBanner}
              </div>
            )}

            {cbeUpdateBanner && (
              <div className="mb-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
                <span>
                  {language === 'ar'
                    ? `تم تحديث سعر البيع الرسمي للبنك المركزي إلى ${cbeUpdateBanner.rate} ج.م (تاريخ النشر ${cbeUpdateBanner.date}).`
                    : `Official CBE USD/EGP SELL rate updated to ${cbeUpdateBanner.rate} EGP (Published ${cbeUpdateBanner.date}).`}
                </span>
                <button
                  type="button"
                  onClick={() => setCbeUpdateBanner(null)}
                  className="font-semibold underline shrink-0 cursor-pointer"
                >
                  {language === 'ar' ? 'إغلاق' : 'Dismiss'}
                </button>
              </div>
            )}

            {errorBanner && (
              <div className="mb-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 flex items-center justify-between gap-3">
                <span className="truncate">{errorBanner}</span>
                <button
                  type="button"
                  onClick={() => setErrorBanner(null)}
                  className="font-semibold underline shrink-0 cursor-pointer"
                >
                  {language === 'ar' ? 'إغلاق' : 'Dismiss'}
                </button>
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeSection === 'dashboard' && (
                  <DashboardView
                    metrics={metrics}
                    orders={activeOrders}
                    activities={activeActivities}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    dateRange={dateRange}
                    onDateRangeChange={setDateRange}
                    searchQuery={searchQuery}
                    onNavigate={setActiveSection}
                    onSelectOrder={(order) => {
                      if (hasSectionPermission(userPermissions, userRole, 'orders', 'view')) {
                        setSelectedOrder(order);
                        setActiveSection('orders');
                      }
                    }}
                    onOpenNewOrder={() => {
                      if (hasSectionPermission(userPermissions, userRole, 'orders', 'create')) {
                        setActiveSection('orders');
                        setOrderModalOpen(true);
                      }
                    }}
                    onOpenNewProduct={() => {
                      if (hasSectionPermission(userPermissions, userRole, 'products', 'create')) {
                        setActiveSection('products');
                        setProductModalOpen(true);
                      }
                    }}
                    onOpenNewExpense={() => {
                      if (hasSectionPermission(userPermissions, userRole, 'finance', 'create')) {
                        setActiveSection('finance');
                        setExpenseModalOpen(true);
                      }
                    }}
                    isCloudEmpty={
                      isCloudEmpty &&
                      hasCloudTenantDoc &&
                      hasSectionPermission(userPermissions, userRole, 'settings', 'edit')
                    }
                    onSeedCloudSample={
                      hasCloudTenantDoc &&
                      hasSectionPermission(userPermissions, userRole, 'settings', 'edit')
                        ? handleSeedCloudSample
                        : undefined
                    }
                    isSeeding={seedingCloud}
                  />
                )}

                {activeSection === 'products' && (
                  <ProductsView
                    products={activeProducts}
                    ownerId={activeOwnerId}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    lowStockThreshold={activeProfile.lowStockThreshold}
                    globalSearch={searchQuery}
                    onSaveProduct={handleSaveProduct}
                    onDeleteProduct={handleDeleteProduct}
                    isCreateModalOpen={productModalOpen}
                    onOpenCreateModal={() => setProductModalOpen(true)}
                    onCloseCreateModal={() => setProductModalOpen(false)}
                  />
                )}

                {activeSection === 'orders' && (
                  <OrdersView
                    orders={activeOrders}
                    products={activeProducts}
                    customers={activeCustomers}
                    ownerId={activeOwnerId}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    defaultTaxRate={activeProfile.taxRate}
                    globalSearch={searchQuery}
                    onCreateOrder={handleCreateOrder}
                    onUpdateOrder={handleUpdateOrder}
                    onUpdateOrderStatus={handleUpdateOrderStatus}
                    onDeleteOrder={handleDeleteOrder}
                    isCreateModalOpen={orderModalOpen}
                    onOpenCreateModal={() => setOrderModalOpen(true)}
                    onCloseCreateModal={() => setOrderModalOpen(false)}
                    selectedOrder={selectedOrder}
                    onSelectOrder={setSelectedOrder}
                  />
                )}

                {activeSection === 'customers' && (
                  <CustomersView
                    customers={activeCustomers}
                    orders={activeOrders}
                    ownerId={activeOwnerId}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    globalSearch={searchQuery}
                    isCloudMode={isCloudMode}
                    userEmail={firebaseUser?.email ?? null}
                    onSignInGoogle={handleSignInGoogle}
                    onSaveCustomer={handleSaveCustomer}
                    onDeleteCustomer={handleDeleteCustomer}
                    onSyncFromOrders={() => runCustomerBackfillSync(true)}
                    syncingCustomers={syncingCustomers}
                    onOpenOrder={(order) => {
                      setSelectedOrder(order);
                      setActiveSection('orders');
                    }}
                  />
                )}

                {activeSection === 'inventory' && (
                  <InventoryView
                    products={activeProducts}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    lowStockThreshold={activeProfile.lowStockThreshold}
                    globalSearch={searchQuery}
                    onAdjustStock={handleAdjustStock}
                  />
                )}

                {activeSection === 'finance' && (
                  <FinanceView
                    orders={activeOrders}
                    products={activeProducts}
                    expenses={activeExpenses}
                    ownerId={activeOwnerId}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    globalSearch={searchQuery}
                    onSaveExpense={handleSaveExpense}
                    onDeleteExpense={handleDeleteExpense}
                    isCreateModalOpen={expenseModalOpen}
                    onOpenCreateModal={() => setExpenseModalOpen(true)}
                    onCloseCreateModal={() => setExpenseModalOpen(false)}
                  />
                )}

                {activeSection === 'marketing' && <UnconnectedModuleView module="marketing" />}
                {activeSection === 'research' && (
                  <ProductResearchView
                    ideas={activeIdeas}
                    ownerId={activeOwnerId}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                    onSaveIdea={handleSaveIdea}
                    onDeleteIdea={handleDeleteIdea}
                  />
                )}
                {activeSection === 'assistant' && (
                  <AiAssistantView
                    profile={activeProfile}
                    metrics={metrics}
                    products={activeProducts}
                  />
                )}
                {activeSection === 'reports' && (
                  <ReportsView
                    metrics={metrics}
                    products={activeProducts}
                    orders={activeOrders}
                    expenses={activeExpenses}
                    currency={activeProfile.currency}
                    currencyConfig={currencyConfig}
                  />
                )}
                {activeSection === 'automations' && <UnconnectedModuleView module="automations" />}
                {activeSection === 'integrations' && <UnconnectedModuleView module="integrations" />}
                {activeSection === 'profile' && firebaseUser && (
                  <UserProfileView
                    profile={{ ...activeProfile, language }}
                    firebaseUser={firebaseUser}
                    sessionInfo={sessionInfo}
                    onSaveProfile={handleSaveProfile}
                    onSignOut={handleSignOut}
                  />
                )}
                {activeSection === 'invitations' && isAdmin && firebaseUser && (
                  <AdminInvitationsView firebaseUser={firebaseUser} />
                )}
                {isSuperAdmin &&
                  firebaseUser &&
                  (activeSection === 'sa_overview' ||
                    activeSection === 'sa_users' ||
                    activeSection === 'sa_stores' ||
                    activeSection === 'sa_invitations' ||
                    activeSection === 'sa_roles' ||
                    activeSection === 'sa_audit') && (
                    <SuperAdminDashboardView
                      activeSection={activeSection}
                      firebaseUser={firebaseUser}
                      onSelectSection={setActiveSection}
                    />
                  )}
                {activeSection === 'settings' && (
                  <SettingsView
                    profile={{ ...activeProfile, language }}
                    isCloudMode={isCloudMode}
                    userEmail={firebaseUser?.email ?? null}
                    theme={theme}
                    onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                    onSaveProfile={handleSaveProfile}
                    onSignInGoogle={handleSignInGoogle}
                    onSignOut={handleSignOut}
                    onResetSandbox={() => setLocalData(resetLocalWorkspace())}
                    onSeedCloudSample={handleSeedCloudSample}
                    cbeSyncState={cbeSyncState}
                    onRefreshCbeRate={handleRefreshCbeRate}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </I18nProvider>
  );
}
