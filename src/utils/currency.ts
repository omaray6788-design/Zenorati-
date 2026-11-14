import type { AppLanguage, CurrencyCode, CurrencyConfig, TenantProfile } from '../types/zenorati';

export const DEFAULT_USD_TO_EGP_RATE = 50;

export const OFFICIAL_CBE_SOURCE = 'Central Bank of Egypt (CBE) - Official Sell';
export const MANUAL_RATE_SOURCE = 'Manual Override (Custom)';

export const SUPPORTED_CURRENCIES: CurrencyCode[] = ['EGP', 'USD'];

export function formatConversionDirection(from: CurrencyCode, to: CurrencyCode): string {
  return `${from}->${to}`;
}

export function isValidExchangeRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && rate <= 10000;
}

export function getEffectiveUsdToEgpRate(rate?: number | null): number {
  return isValidExchangeRate(rate) ? rate : DEFAULT_USD_TO_EGP_RATE;
}

export function getCurrencySymbol(code: CurrencyCode, language: AppLanguage = 'en'): string {
  switch (code) {
    case 'EGP':
      return language === 'ar' ? 'ج.م' : 'EGP';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'CAD':
      return 'CA$';
    case 'AUD':
      return 'A$';
    default:
      return code;
  }
}

export function getCurrencyLabel(code: CurrencyCode, language: AppLanguage = 'en'): string {
  if (language === 'ar') {
    switch (code) {
      case 'EGP':
        return 'جنيه مصري (EGP)';
      case 'USD':
        return 'دولار أمريكي ($ USD)';
      case 'EUR':
        return 'يورو (€ EUR)';
      case 'GBP':
        return 'جنيه إسترليني (£ GBP)';
      case 'CAD':
        return 'دولار كندي (CA$ CAD)';
      case 'AUD':
        return 'دولار أسترالي (A$ AUD)';
      default:
        return code;
    }
  }

  switch (code) {
    case 'EGP':
      return 'Egyptian Pound (EGP)';
    case 'USD':
      return 'US Dollar ($ USD)';
    case 'EUR':
      return 'Euro (€ EUR)';
    case 'GBP':
      return 'British Pound (£ GBP)';
    case 'CAD':
      return 'Canadian Dollar (CA$)';
    case 'AUD':
      return 'Australian Dollar (A$)';
    default:
      return code;
  }
}

export function buildCurrencyConfig(
  profile?: Partial<
    Pick<
      TenantProfile,
      | 'currency'
      | 'usdToEgpRate'
      | 'legacyCurrency'
      | 'language'
      | 'exchangeRateMode'
      | 'cbePublicationDate'
      | 'cbeSellRate'
    >
  >
): CurrencyConfig {
  const mode = profile?.exchangeRateMode ?? 'cbe_official';
  const effectiveRate =
    mode === 'cbe_official' && isValidExchangeRate(profile?.cbeSellRate)
      ? profile.cbeSellRate
      : getEffectiveUsdToEgpRate(profile?.usdToEgpRate);

  const rateSource =
    mode === 'manual_override'
      ? MANUAL_RATE_SOURCE
      : isValidExchangeRate(profile?.cbeSellRate)
      ? OFFICIAL_CBE_SOURCE
      : 'Store Configured Rate';

  return {
    reportingCurrency: profile?.currency || 'USD',
    usdToEgpRate: effectiveRate,
    legacyCurrency: profile?.legacyCurrency,
    language: profile?.language,
    exchangeRateMode: mode,
    ...(profile?.cbePublicationDate ? { cbePublicationDate: profile.cbePublicationDate } : {}),
    rateSource,
  };
}

/**
 * Resolves a transaction or product's true original currency without mutating historical records.
 * Unlabeled legacy documents fall back to `legacyCurrency` (if the store changed its default currency)
 * or the store's current currency.
 */
export function resolveTransactionCurrency(
  recordCurrency: CurrencyCode | undefined,
  context?:
    | Pick<TenantProfile, 'currency' | 'legacyCurrency'>
    | Pick<CurrencyConfig, 'reportingCurrency' | 'legacyCurrency'>
    | CurrencyCode
): CurrencyCode {
  if (recordCurrency) return recordCurrency;
  if (!context) return 'USD';
  if (typeof context === 'string') return context;
  if (context.legacyCurrency) return context.legacyCurrency;
  if ('currency' in context && context.currency) return context.currency;
  if ('reportingCurrency' in context && context.reportingCurrency) return context.reportingCurrency;
  return 'USD';
}

export type ConversionResult =
  | {
      ok: true;
      amount: number;
      /** Applied multiplier: fromCurrency -> toCurrency */
      exchangeRate: number;
    }
  | {
      ok: false;
      reason: 'invalid_rate' | 'unsupported_pair';
    };

/**
 * Strictly converts between USD and EGP (or identity same-currency).
 * Refuses to convert if exchange rate is missing/invalid (<= 0) or for unconfigured pairs.
 */
export function convertCurrencyAmount(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  usdToEgpRate?: number | null
): ConversionResult {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if (fromCurrency === toCurrency) {
    return {
      ok: true,
      amount: Number(safeAmount.toFixed(2)),
      exchangeRate: 1,
    };
  }

  const isUsdEgpPair =
    (fromCurrency === 'USD' && toCurrency === 'EGP') ||
    (fromCurrency === 'EGP' && toCurrency === 'USD');

  if (!isUsdEgpPair) {
    return { ok: false, reason: 'unsupported_pair' };
  }

  if (!isValidExchangeRate(usdToEgpRate)) {
    return { ok: false, reason: 'invalid_rate' };
  }

  const multiplier = fromCurrency === 'USD' ? usdToEgpRate : 1 / usdToEgpRate;
  return {
    ok: true,
    amount: Number((safeAmount * multiplier).toFixed(2)),
    exchangeRate: Number(multiplier.toFixed(6)),
  };
}

export type ReportingResolution =
  | {
      ok: true;
      amount: number;
      multiplier: number;
      sourceCurrency: CurrencyCode;
    }
  | {
      ok: false;
      sourceCurrency: CurrencyCode;
      reason: 'invalid_rate' | 'unsupported_pair';
    };

/**
 * Resolves a record's numeric value into `targetCurrency` for safe aggregation.
 * Priority:
 * 1. Exact match (`sourceCurrency === targetCurrency`) -> original amount untouched.
 * 2. Stored conversion snapshot (`recordReportingCurrency === targetCurrency` with valid `recordedConvertedAmount` or `recordedExchangeRate`).
 * 3. Live `fallbackUsdToEgpRate` conversion for USD <-> EGP when valid (> 0).
 * 4. Otherwise returns `{ ok: false }` so callers NEVER add incompatible currencies together.
 */
export function resolveReportingAmount(params: {
  amount: number;
  recordCurrency?: CurrencyCode;
  recordedExchangeRate?: number;
  recordedConvertedAmount?: number;
  recordedReportingCurrency?: CurrencyCode;
  config: CurrencyConfig;
}): ReportingResolution {
  const {
    amount,
    recordCurrency,
    recordedExchangeRate,
    recordedConvertedAmount,
    recordedReportingCurrency,
    config,
  } = params;

  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const sourceCurrency = resolveTransactionCurrency(recordCurrency, config);
  const targetCurrency = config.reportingCurrency;

  if (sourceCurrency === targetCurrency) {
    return {
      ok: true,
      amount: safeAmount,
      multiplier: 1,
      sourceCurrency,
    };
  }

  if (recordedReportingCurrency === targetCurrency) {
    if (
      typeof recordedConvertedAmount === 'number' &&
      Number.isFinite(recordedConvertedAmount) &&
      recordedConvertedAmount >= 0
    ) {
      const multiplier =
        safeAmount > 0
          ? recordedConvertedAmount / safeAmount
          : isValidExchangeRate(recordedExchangeRate)
          ? recordedExchangeRate
          : 1;
      return {
        ok: true,
        amount: recordedConvertedAmount,
        multiplier,
        sourceCurrency,
      };
    }

    if (isValidExchangeRate(recordedExchangeRate)) {
      return {
        ok: true,
        amount: Number((safeAmount * recordedExchangeRate).toFixed(2)),
        multiplier: recordedExchangeRate,
        sourceCurrency,
      };
    }
  }

  const converted = convertCurrencyAmount(
    safeAmount,
    sourceCurrency,
    targetCurrency,
    config.usdToEgpRate
  );

  if (!converted.ok) {
    return {
      ok: false,
      sourceCurrency,
      reason: converted.reason,
    };
  }

  return {
    ok: true,
    amount: converted.amount,
    multiplier: converted.exchangeRate,
    sourceCurrency,
  };
}
