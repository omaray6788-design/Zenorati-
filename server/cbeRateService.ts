import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CbeOfficialRate, CbeRateSyncStatus, CbeSyncState } from '../src/types/zenorati';

export const CBE_EXCHANGE_RATES_URL =
  'https://www.cbe.org.eg/en/economic-research/statistics/cbe-exchange-rates';
export const CBE_OFFICIAL_SOURCE_NAME = 'Central Bank of Egypt (CBE)';
export const CBE_CHECK_INTERVAL_MINUTES = 15;
export const CBE_CHECK_INTERVAL_MS = CBE_CHECK_INTERVAL_MINUTES * 60 * 1000;
const OUTDATED_SYNC_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours without successful sync
const FETCH_TIMEOUT_MS = 15000;
const MANUAL_COOLDOWN_MS = 10000;

const CACHE_FILE_PATH = path.resolve(process.cwd(), '.cbe-rate-cache.json');

export interface ParsedCbeUsdRate {
  currencyPair: 'USD/EGP';
  buyRate: number;
  sellRate: number;
  publicationDate: string; // YYYY-MM-DD
  source: string;
  sourceUrl: string;
}

export type ParseCbeResult =
  | { ok: true; data: ParsedCbeUsdRate }
  | { ok: false; error: string };

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDdMmYyyyToIso(dayStr: string, monthStr: string, yearStr: string): string | null {
  const day = Number.parseInt(dayStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const year = Number.parseInt(yearStr, 10);
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Pure parser & authenticity validator for the official CBE Exchange Rates HTML page.
 * Rejects WAF challenge pages, missing tables, invalid dates, missing Currency/Buy/Sell headers,
 * missing US Dollar row, or invalid/inverted numeric rates.
 */
export function parseCbeExchangeRatesHtml(html: string): ParseCbeResult {
  if (!html || typeof html !== 'string' || html.trim().length < 200) {
    return { ok: false, error: 'CBE response payload is empty or incomplete.' };
  }

  // Detect F5 ASM / WAF rejection or non-CBE error pages
  if (
    /Request Rejected/i.test(html) ||
    /Your support ID is/i.test(html) ||
    /Access Denied/i.test(html)
  ) {
    return { ok: false, error: 'CBE gateway rejected the automated request.' };
  }

  const hasCbeBrand =
    /CBE Exchange Rates/i.test(html) ||
    /CBE Official Exchange rates/i.test(html) ||
    /cbe-exchange-rates/i.test(html);

  if (!hasCbeBrand) {
    return {
      ok: false,
      error: 'Response could not be verified as the official Central Bank of Egypt (CBE) page.',
    };
  }

  // Extract official publication date: "Rates for Date: DD/MM/YYYY"
  const dateMatch = /Rates\s+for\s+Date\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(html);
  if (!dateMatch) {
    return { ok: false, error: 'Official CBE publication date was not found in response.' };
  }

  const publicationDate = parseDdMmYyyyToIso(dateMatch[1], dateMatch[2], dateMatch[3]);
  if (!publicationDate) {
    return { ok: false, error: 'Official CBE publication date format is invalid.' };
  }

  // Locate main exchange-rate table
  const tableMatch = /<table[^>]*class="[^"]*table-comp[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  const tableHtml = tableMatch?.[1] ?? '';
  if (!tableHtml) {
    return { ok: false, error: 'Official CBE exchange-rate table was not found in response.' };
  }

  // Validate table headers (Currency, Buy, Sell)
  const theadMatch = /<thead[^>]*>([\s\S]*?)<\/thead>/i.exec(tableHtml);
  const headerCells = Array.from((theadMatch?.[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map(
    (m) => stripHtmlTags(m[1]).toLowerCase()
  );

  const currencyColIdx = headerCells.findIndex((h) => h.includes('currency'));
  const buyColIdx = headerCells.findIndex((h) => h === 'buy' || h.includes('buy'));
  const sellColIdx = headerCells.findIndex((h) => h === 'sell' || h.includes('sell'));

  if (currencyColIdx === -1 || buyColIdx === -1 || sellColIdx === -1) {
    return {
      ok: false,
      error: 'Official CBE table headers (Currency / Buy / Sell) did not match expected structure.',
    };
  }

  // Parse tbody rows and find US Dollar
  const tbodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableHtml);
  const tbodyHtml = tbodyMatch?.[1] ?? '';
  const rowMatches = Array.from(tbodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));

  for (const rowMatch of rowMatches) {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) =>
      stripHtmlTags(c[1])
    );
    if (cells.length <= Math.max(currencyColIdx, buyColIdx, sellColIdx)) continue;

    const currencyName = cells[currencyColIdx];
    if (/^US\s+Dollar$/i.test(currencyName) || /^USD$/i.test(currencyName)) {
      const rawBuy = cells[buyColIdx].replace(/,/g, '').trim();
      const rawSell = cells[sellColIdx].replace(/,/g, '').trim();
      const buyRate = Number(rawBuy);
      const sellRate = Number(rawSell);

      if (
        !Number.isFinite(buyRate) ||
        !Number.isFinite(sellRate) ||
        buyRate <= 0 ||
        sellRate <= 0 ||
        buyRate > 10000 ||
        sellRate > 10000
      ) {
        return { ok: false, error: 'CBE USD/EGP BUY or SELL numeric values are out of range.' };
      }

      if (buyRate > sellRate) {
        return {
          ok: false,
          error: 'CBE USD/EGP BUY rate exceeded SELL rate; rejected anomalous payload.',
        };
      }

      return {
        ok: true,
        data: {
          currencyPair: 'USD/EGP',
          buyRate: Number(buyRate.toFixed(4)),
          sellRate: Number(sellRate.toFixed(4)),
          publicationDate,
          source: CBE_OFFICIAL_SOURCE_NAME,
          sourceUrl: CBE_EXCHANGE_RATES_URL,
        },
      };
    }
  }

  return { ok: false, error: 'US Dollar row was not found in the official CBE table.' };
}

export function isRateRecordChanged(
  prev: CbeOfficialRate | null,
  next: ParsedCbeUsdRate
): boolean {
  if (!prev) return true;
  return (
    prev.publicationDate !== next.publicationDate ||
    Math.abs(prev.buyRate - next.buyRate) > 1e-6 ||
    Math.abs(prev.sellRate - next.sellRate) > 1e-6
  );
}

export function computeIsRateOutdated(
  officialRate: CbeOfficialRate | null,
  nowMs = Date.now()
): boolean {
  if (!officialRate) return true;
  const syncedMs = Date.parse(officialRate.lastSyncedAt);
  if (!Number.isFinite(syncedMs)) return true;
  return nowMs - syncedMs > OUTDATED_SYNC_THRESHOLD_MS;
}

export type CbeFetcher = () => Promise<string>;

export async function defaultCbeFetcher(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(CBE_EXCHANGE_RATES_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    if (!response.ok) {
      throw new Error(`CBE HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export function verifyCronSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.trim().length === 0) return false;
  if (!provided || provided.trim().length === 0) return false;
  const a = Buffer.from(provided.trim(), 'utf8');
  const b = Buffer.from(expected.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface PersistedCacheShape {
  officialRate: CbeOfficialRate | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export class CbeRateMonitor {
  private officialRate: CbeOfficialRate | null = null;
  private status: CbeRateSyncStatus = 'outdated';
  private lastAttemptAt: string | null = null;
  private lastError: string | null = null;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private nextScheduledCheckAt: string | null = null;
  private inFlightPromise: Promise<CbeSyncState> | null = null;
  private listeners = new Set<(state: CbeSyncState) => void>();
  private readonly fetcher: CbeFetcher;
  private readonly persistToDisk: boolean;

  constructor(options?: { fetcher?: CbeFetcher; persistToDisk?: boolean }) {
    this.fetcher = options?.fetcher ?? defaultCbeFetcher;
    this.persistToDisk = options?.persistToDisk ?? true;
    if (this.persistToDisk) {
      this.loadDiskCache();
    }
  }

  private loadDiskCache(): void {
    try {
      if (!fs.existsSync(CACHE_FILE_PATH)) return;
      const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PersistedCacheShape;
      if (
        parsed?.officialRate &&
        parsed.officialRate.currencyPair === 'USD/EGP' &&
        typeof parsed.officialRate.buyRate === 'number' &&
        parsed.officialRate.buyRate > 0 &&
        typeof parsed.officialRate.sellRate === 'number' &&
        parsed.officialRate.sellRate > 0 &&
        typeof parsed.officialRate.publicationDate === 'string'
      ) {
        this.officialRate = parsed.officialRate;
        this.lastAttemptAt = parsed.lastAttemptAt ?? parsed.officialRate.lastSyncedAt;
        this.lastError = parsed.lastError ?? null;
        this.status = computeIsRateOutdated(this.officialRate) ? 'outdated' : 'synced';
      }
    } catch {
      // Ignore corrupt cache file; fresh fetch will recover cleanly
    }
  }

  private writeDiskCache(): void {
    if (!this.persistToDisk) return;
    try {
      const payload: PersistedCacheShape = {
        officialRate: this.officialRate,
        lastAttemptAt: this.lastAttemptAt,
        lastError: this.lastError,
      };
      const tmp = `${CACHE_FILE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, CACHE_FILE_PATH);
    } catch {
      // Ignore read-only filesystem errors
    }
  }

  getState(): CbeSyncState {
    const outdated = computeIsRateOutdated(this.officialRate);
    let effectiveStatus: CbeRateSyncStatus = this.status;
    if (this.status !== 'checking' && this.status !== 'unavailable' && outdated) {
      effectiveStatus = 'outdated';
    }
    return {
      status: effectiveStatus,
      officialRate: this.officialRate ? { ...this.officialRate } : null,
      lastAttemptAt: this.lastAttemptAt,
      lastError: this.lastError,
      isOutdated: outdated,
      schedulerActive: this.schedulerTimer !== null,
      checkIntervalMinutes: CBE_CHECK_INTERVAL_MINUTES,
      nextScheduledCheckAt: this.nextScheduledCheckAt,
    };
  }

  subscribe(listener: (state: CbeSyncState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  async checkNow(options?: { respectCooldown?: boolean }): Promise<CbeSyncState> {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    if (options?.respectCooldown && this.lastAttemptAt && this.officialRate) {
      const elapsed = Date.now() - Date.parse(this.lastAttemptAt);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MANUAL_COOLDOWN_MS) {
        return this.getState();
      }
    }

    this.status = 'checking';
    this.emit();

    this.inFlightPromise = (async () => {
      const attemptIso = new Date().toISOString();
      this.lastAttemptAt = attemptIso;

      try {
        const html = await this.fetcher();
        const parsed = parseCbeExchangeRatesHtml(html);
        if (!parsed.ok) {
          throw new Error(parsed.error);
        }

        const changed = isRateRecordChanged(this.officialRate, parsed.data);
        const nextOfficial: CbeOfficialRate = {
          currencyPair: 'USD/EGP',
          buyRate: parsed.data.buyRate,
          sellRate: parsed.data.sellRate,
          defaultRate: parsed.data.sellRate,
          source: parsed.data.source,
          sourceUrl: parsed.data.sourceUrl,
          publicationDate: parsed.data.publicationDate,
          lastSyncedAt: attemptIso,
          lastChangedAt: changed
            ? attemptIso
            : this.officialRate?.lastChangedAt ?? attemptIso,
        };

        this.officialRate = nextOfficial;
        this.lastError = null;
        this.status = changed ? 'synced' : 'no_change';

        // Avoid unnecessary disk writes when rate has not changed (only persist on actual change or first sync)
        if (changed) {
          this.writeDiskCache();
        }
      } catch (err) {
        // Keep the last verified CBE rate untouched; never invent or overwrite with 0/null
        this.status = 'unavailable';
        this.lastError =
          err instanceof Error ? err.message : 'Unable to reach Central Bank of Egypt (CBE).';
      } finally {
        this.inFlightPromise = null;
        this.emit();
      }

      return this.getState();
    })();

    return this.inFlightPromise;
  }

  startScheduler(): void {
    if (this.schedulerTimer) return;
    const scheduleNextLabel = () => {
      this.nextScheduledCheckAt = new Date(Date.now() + CBE_CHECK_INTERVAL_MS).toISOString();
    };
    scheduleNextLabel();

    this.schedulerTimer = setInterval(() => {
      scheduleNextLabel();
      void this.checkNow({ respectCooldown: false });
    }, CBE_CHECK_INTERVAL_MS);

    if (typeof this.schedulerTimer.unref === 'function') {
      this.schedulerTimer.unref();
    }

    // Immediate non-blocking startup verification
    void this.checkNow({ respectCooldown: false });
  }

  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.nextScheduledCheckAt = null;
  }
}

export const cbeRateMonitor = new CbeRateMonitor();
