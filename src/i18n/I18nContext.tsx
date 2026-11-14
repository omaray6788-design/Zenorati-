import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type {
  AppLanguage,
  CustomerSegment,
  ExpenseCategory,
  ExpenseStatus,
  NavSection,
  OrderChannel,
  OrderStatus,
  ProductStatus,
} from '../types/zenorati';
import {
  ar,
  en,
  interpolate,
  translateCustomerSegment,
  translateExpenseCategory,
  translateExpenseStatus,
  translateNavSection,
  translateOrderChannel,
  translateOrderStatus,
  translateProductStatus,
  type TranslationKey,
} from './translations';

const GLOBAL_LANG_STORAGE_KEY = 'zenorati_lang';

export function getTenantLangStorageKey(ownerId?: string | null): string {
  return ownerId ? `zenorati_lang_${ownerId}` : GLOBAL_LANG_STORAGE_KEY;
}

export function readStoredLanguage(ownerId?: string | null): AppLanguage | null {
  try {
    if (ownerId) {
      const perTenant = window.localStorage.getItem(getTenantLangStorageKey(ownerId));
      if (perTenant === 'ar' || perTenant === 'en') return perTenant;
    }
    const globalVal = window.localStorage.getItem(GLOBAL_LANG_STORAGE_KEY);
    if (globalVal === 'ar' || globalVal === 'en') return globalVal;
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export function writeStoredLanguage(lang: AppLanguage, ownerId?: string | null): void {
  try {
    window.localStorage.setItem(GLOBAL_LANG_STORAGE_KEY, lang);
    if (ownerId) {
      window.localStorage.setItem(getTenantLangStorageKey(ownerId), lang);
    }
  } catch {
    // Ignore storage write errors
  }
}

interface I18nContextValue {
  language: AppLanguage;
  isRtl: boolean;
  dir: 'ltr' | 'rtl';
  setLanguage: (lang: AppLanguage) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  tNav: (section: NavSection) => string;
  tOrderStatus: (status: OrderStatus) => string;
  tChannel: (channel: OrderChannel) => string;
  tExpenseCategory: (category: ExpenseCategory) => string;
  tExpenseStatus: (status: ExpenseStatus) => string;
  tProductStatus: (status: ProductStatus) => string;
  tCustomerSegment: (segment: CustomerSegment) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  language: AppLanguage;
  onChangeLanguage: (lang: AppLanguage) => void;
  children: React.ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({
  language,
  onChangeLanguage,
  children,
}) => {
  const isRtl = language === 'ar';
  const dir: 'ltr' | 'rtl' = isRtl ? 'rtl' : 'ltr';

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = dir;
  }, [language, dir]);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const dict = language === 'ar' ? ar : en;
      const template = dict[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [language]
  );

  const tNav = useCallback((section: NavSection) => translateNavSection(section, language), [language]);
  const tOrderStatus = useCallback(
    (status: OrderStatus) => translateOrderStatus(status, language),
    [language]
  );
  const tChannel = useCallback(
    (channel: OrderChannel) => translateOrderChannel(channel, language),
    [language]
  );
  const tExpenseCategory = useCallback(
    (category: ExpenseCategory) => translateExpenseCategory(category, language),
    [language]
  );
  const tExpenseStatus = useCallback(
    (status: ExpenseStatus) => translateExpenseStatus(status, language),
    [language]
  );
  const tProductStatus = useCallback(
    (status: ProductStatus) => translateProductStatus(status, language),
    [language]
  );
  const tCustomerSegment = useCallback(
    (segment: CustomerSegment) => translateCustomerSegment(segment, language),
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      isRtl,
      dir,
      setLanguage: onChangeLanguage,
      t,
      tNav,
      tOrderStatus,
      tChannel,
      tExpenseCategory,
      tExpenseStatus,
      tProductStatus,
      tCustomerSegment,
    }),
    [
      language,
      isRtl,
      dir,
      onChangeLanguage,
      t,
      tNav,
      tOrderStatus,
      tChannel,
      tExpenseCategory,
      tExpenseStatus,
      tProductStatus,
      tCustomerSegment,
    ]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside an I18nProvider');
  }
  return ctx;
}
