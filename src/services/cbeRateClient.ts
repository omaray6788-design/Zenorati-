import type { CbeSyncState } from '../types/zenorati';

export async function fetchCbeRateState(): Promise<CbeSyncState> {
  const res = await fetch('/api/exchange-rate/cbe', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Unable to fetch CBE exchange rate (${res.status}).`);
  }
  return (await res.json()) as CbeSyncState;
}

export async function refreshCbeRate(): Promise<CbeSyncState> {
  const res = await fetch('/api/exchange-rate/cbe/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const body = (await res.json().catch(() => null)) as
    | (CbeSyncState & { error?: string; state?: CbeSyncState })
    | null;
  if (!res.ok) {
    if (body?.state) return body.state;
    throw new Error(body?.error || `CBE refresh failed (${res.status}).`);
  }
  return body as CbeSyncState;
}

export function subscribeCbeRateStream(onState: (state: CbeSyncState) => void): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => undefined;
  }

  const es = new EventSource('/api/exchange-rate/stream');

  const handleRateEvent = (event: Event) => {
    try {
      const msg = event as MessageEvent<string>;
      const parsed = JSON.parse(msg.data) as CbeSyncState;
      if (parsed && typeof parsed.status === 'string') {
        onState(parsed);
      }
    } catch {
      // Ignore malformed SSE payload
    }
  };

  es.addEventListener('rate_state', handleRateEvent);

  return () => {
    es.removeEventListener('rate_state', handleRateEvent);
    es.close();
  };
}
