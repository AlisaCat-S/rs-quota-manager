import type { Settings } from '../../types'
import { request } from '../request'
import { parsePage, parsePolicy, parseSettings, parseUpdate } from '../schemas/quota'

export const api = {
  settings: () => request('GET', 'api/settings').then(parseSettings),
  saveSettings: (value: Settings, expectedVersion: number | null) => request('POST', 'api/settings', { value, expectedVersion }).then(parseSettings),
  automatic: (enabled: boolean, expectedVersion: number | null) => request('POST', 'api/automatic', { enabled, expectedVersion }).then(parseSettings),
  accounts: (cursor?: string) => request('GET', 'api/accounts', undefined, cursor ? new URLSearchParams({ cursor }).toString() : undefined).then(parsePage),
  policy: (accountId: string, automatic: boolean, expectedVersion: number | null) => request('POST', 'api/policy', { accountId, automatic, expectedVersion }).then(parsePolicy),
  refresh: (accountId: string) => request('POST', 'api/refresh', { accountId }).then(parseUpdate),
  consume: (accountId: string, creditId: string | null) => request('POST', 'api/consume', { accountId, creditId }).then(parseUpdate),
  retry: (accountId: string, requestId: string) => request('POST', 'api/retry', { accountId, requestId }).then(parseUpdate),
}
