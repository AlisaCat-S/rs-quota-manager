export interface Settings { automatic: boolean; checkIntervalSeconds: number; cardsRefreshSeconds: number; batchSize: number }
export interface SettingsResult { value: Settings; version: number | null; scan?: { checkedAtMs: number | null } }
export interface Card { id: string; status: string | null; title: string | null; expiresAt: string | null; expiresAtDisplay: string | null; resetType: string | null }
export interface QuotaWindow { key: string; window_seconds: number | null; used_percent: number | null; reset_at_ms: number | null }
export interface Quota { account_id: string; observed_at_ms: number | null; windows: QuotaWindow[] }
export interface Pending { requestId: string; creditId: string | null; startedAtMs: number; automatic: boolean }
export interface Event { atMs: number; requestId: string; creditId: string | null; automatic: boolean; code: string }
export interface State {
  automatic: boolean; cards: { availableCount: number; credits: Card[] } | null;
  cardsObservedAtMs: number | null; cardsCheckedAtMs: number | null; error: string | null;
  pending: Pending | null; awaitingRecovery: boolean; lastAttemptAtMs: number | null; history: Event[];
}
export interface Row {
  account: { account_id: string; provider_id: string; name: string; email: string | null; enabled: boolean; authentication_kind: string; plan_type: string | null };
  quota: Quota | null; state: State;
}
export interface Page { accounts: Row[]; excludedPending: Row[]; nextCursor: string | null; generatedAtMs: number }
export interface Bridge {
  readonly version: 2; readonly theme: 'light' | 'dark';
  request(input: { method: 'GET' | 'POST'; path: string; query?: string; contentType?: string; body?: string }): Promise<{ status: number; contentType: string; body: ArrayBuffer }>;
}
declare global { interface Window { codexProxyPlugin?: Bridge } }
