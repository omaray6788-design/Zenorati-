import type { AppLanguage, CurrencyCode, OrderStatus, ProductImageKey } from '../types/zenorati';

import headphonesImg from '../assets/images/product_studio_headphones_1794624714768.jpg';
import kettleImg from '../assets/images/product_ceramic_kettle_1794624713782.jpg';
import keyboardImg from '../assets/images/product_mechanical_keyboard_1794624716760.jpg';
import folioImg from '../assets/images/product_leather_folio_1794624716428.jpg';

const CURRENCY_LOCALES: Record<CurrencyCode, string> = {
  USD: 'en-US',
  EGP: 'en-EG',
  EUR: 'de-DE',
  GBP: 'en-GB',
  CAD: 'en-CA',
  AUD: 'en-AU',
};

function getLocaleForCurrency(currency: CurrencyCode, language: AppLanguage): string {
  if (language === 'ar') {
    if (currency === 'EGP') return 'ar-EG-u-nu-latn';
    if (currency === 'USD') return 'en-US';
    return `${CURRENCY_LOCALES[currency] || 'en-US'}`;
  }
  return CURRENCY_LOCALES[currency] || 'en-US';
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode = 'USD',
  decimals = 2,
  language: AppLanguage = 'en'
): string {
  const safe = Number.isFinite(amount) ? amount : 0;

  if (currency === 'EGP') {
    const numStr = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Math.abs(safe));
    const sign = safe < 0 ? '-' : '';
    return language === 'ar' ? `${sign}${numStr} ج.م` : `${sign}EGP ${numStr}`;
  }

  return new Intl.NumberFormat(getLocaleForCurrency(currency, language), {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}

export function formatCompactCurrency(
  amount: number,
  currency: CurrencyCode = 'USD',
  language: AppLanguage = 'en'
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (currency === 'EGP') {
    if (Math.abs(safe) >= 1000) {
      const compactNum = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(Math.abs(safe));
      const sign = safe < 0 ? '-' : '';
      return language === 'ar' ? `${sign}${compactNum} ج.م` : `${sign}EGP ${compactNum}`;
    }
    return formatCurrency(safe, currency, 0, language);
  }

  if (Math.abs(safe) >= 1000) {
    return new Intl.NumberFormat(getLocaleForCurrency(currency, language), {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(safe);
  }
  return formatCurrency(safe, currency, 0, language);
}

export function formatNumber(value: number, _language: AppLanguage = 'en'): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US').format(safe);
}

export function formatDateShort(isoDate: string, language: AppLanguage = 'en'): string {
  if (!isoDate) return '—';
  const parsed = new Date(isoDate.length === 10 ? `${isoDate}T12:00:00` : isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

export function formatRelativeTime(isoTimestamp: string, language: AppLanguage = 'en'): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return language === 'ar' ? 'مؤخراً' : 'Recently';
  }
  const diffSeconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  if (diffSeconds < 60) return language === 'ar' ? 'الآن' : 'Just now';
  if (diffSeconds < 3600) {
    const m = Math.floor(diffSeconds / 60);
    return language === 'ar' ? `منذ ${m} د` : `${m}m ago`;
  }
  if (diffSeconds < 86400) {
    const h = Math.floor(diffSeconds / 3600);
    return language === 'ar' ? `منذ ${h} س` : `${h}h ago`;
  }
  const days = Math.floor(diffSeconds / 86400);
  if (days < 7) return language === 'ar' ? `منذ ${days} ي` : `${days}d ago`;
  return formatDateShort(isoTimestamp, language);
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function offsetIsoDate(daysOffset: number): string {
  const now = new Date();
  now.setDate(now.getDate() + daysOffset);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getProductImageSrc(key: ProductImageKey): string | null {
  switch (key) {
    case 'headphones':
      return headphonesImg;
    case 'kettle':
      return kettleImg;
    case 'keyboard':
      return keyboardImg;
    case 'folio':
      return folioImg;
    default:
      return null;
  }
}

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; textClass: string; bgClass: string }
> = {
  pending: {
    label: 'Pending',
    textClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-500/10',
  },
  processing: {
    label: 'Processing',
    textClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-500/10',
  },
  shipped: {
    label: 'Shipped',
    textClass: 'text-cyan-600 dark:text-cyan-400',
    bgClass: 'bg-cyan-500/10',
  },
  delivered: {
    label: 'Delivered',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-500/10',
  },
  cancelled: {
    label: 'Cancelled',
    textClass: 'text-rose-600 dark:text-rose-400',
    bgClass: 'bg-rose-500/10',
  },
  returned: {
    label: 'Returned',
    textClass: 'text-orange-600 dark:text-orange-400',
    bgClass: 'bg-orange-500/10',
  },
};

export function createSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}
