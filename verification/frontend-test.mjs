import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'

const server = await createServer({ root: fileURLToPath(new URL('../frontend', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const passed = []
const check = name => passed.push(name)
try {
  const { request } = await server.ssrLoadModule('/src/api/request.ts')
  const { api } = await server.ssrLoadModule('/src/api/index.ts')
  const { parsePage, parseSettings, parseUpdate } = await server.ssrLoadModule('/src/api/schemas/quota.ts')
  const { csv, isFree, weeklyForecast, forecastTitle } = await server.ssrLoadModule('/src/format.ts')
  globalThis.window = {}
  await assert.rejects(api.settings(), /宿主桥不可用/)
  check('Missing host bridge fails without network fallback')
  const calls = []
  const reply = (data, status = 200, contentType = 'application/json') => ({ status, contentType, body: new TextEncoder().encode(JSON.stringify(data)).buffer })
  let response = reply({ value: { automatic: false, checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }, version: null })
  window.codexProxyPlugin = { version: 2, theme: 'light', request: async input => { calls.push(input); return response } }
  assert.equal((await api.settings()).value.automatic, false)
  assert.deepEqual(calls.at(-1), { method: 'GET', path: 'api/settings' })
  check('GET uses only public bridge and sends no synthetic content type')
  response.contentType = 'Application/JSON; charset=utf-8'
  await api.settings()
  check('JSON media type normalization matches official example')
  const settings = { automatic: false, checkIntervalSeconds: 60, cardsRefreshSeconds: 3600, batchSize: 10 }
  await api.saveSettings(settings, 2)
  assert.deepEqual(JSON.parse(calls.at(-1).body), { value: settings, expectedVersion: 2 })
  assert.equal(calls.at(-1).contentType, 'application/json')
  check('POST preserves JSON data and optimistic concurrency version')
  for (const path of ['', '/api/settings', 'https://example.com', '../api/settings', 'api/settings?x=1', 'api/../settings']) await assert.rejects(request('GET', path), /相对路径/)
  check('Absolute paths, traversal and unregistered route syntax are rejected locally')
  response = { status: 200, contentType: 'application/json', body: new TextEncoder().encode('{').buffer }
  await assert.rejects(api.settings(), /无效 JSON/)
  response = reply({}, 200, 'text/html')
  await assert.rejects(api.settings(), /内容类型/)
  check('Invalid JSON and unexpected response types fail explicitly')
  response = reply({ error: { message: '设置冲突' } }, 409)
  await assert.rejects(api.settings(), /设置冲突/)
  response = reply(['untrusted'], 502)
  await assert.rejects(api.settings(), /HTTP 502/)
  check('Structured errors and malformed error payloads are handled safely')
  const stamp = Date.now()
  const state = { automatic: false, cards: { availableCount: 1, credits: [{ id: 'card-1', status: 'available', title: 'Weekly', expiresAt: new Date(stamp + 86400000).toISOString(), expiresAtDisplay: null, resetType: 'full' }] }, cardsObservedAtMs: stamp, cardsCheckedAtMs: stamp, error: null, pending: null, awaitingRecovery: false, lastAttemptAtMs: null, history: [] }
  const row = { account: { account_id: 'acct-1', provider_id: 'openai', name: '=sample full name', email: 'sample@example.com', enabled: false, authentication_kind: 'oauth', plan_type: 'team' }, state, quota: { account_id: 'acct-1', observed_at_ms: stamp, windows: [{ key: 'codex:604800s', window_seconds: 604800, used_percent: 100, reset_at_ms: stamp + 86400000 }] } }
  const forecast = { accountId: 'acct-1', generatedAt: new Date(stamp).toISOString(), forecasts: [
    { period: 'monthly', targetDays: 30, extrapolated: true, unavailableReason: null, lowSample: false, incompleteCost: false, estimatedUsd: 150, estimatedUsdDisplay: '$150.00' },
    { period: 'weekly', targetDays: 7, extrapolated: false, unavailableReason: null, lowSample: true, incompleteCost: true, estimatedUsd: 0, estimatedUsdDisplay: '$0.00' },
  ] }
  Object.assign(row, { forecast, forecastError: null })
  const page = { accounts: [row], excludedPending: [], nextCursor: 'cursor &/next', generatedAtMs: stamp }
  assert.deepEqual(parsePage(page), page)
  response = reply(page)
  await api.accounts('cursor &/next')
  assert.equal(new URLSearchParams(calls.at(-1).query).get('cursor'), 'cursor &/next')
  check('Account page decoder preserves email, pause state, membership and cursor encoding')
  assert.equal(weeklyForecast(parsePage(page).accounts[0]).estimatedUsd, 0)
  assert.match(forecastTitle(row), /初步预估/)
  assert.match(forecastTitle(row), /费用记录不完整/)
  assert.equal(weeklyForecast({ ...row, forecast: { ...forecast, forecasts: [forecast.forecasts[0]] } }), undefined)
  assert.match(forecastTitle({ ...row, forecast: null, forecastError: '预估查询失败' }), /预估查询失败/)
  const unavailable = { ...forecast.forecasts[1], estimatedUsd: null, unavailableReason: '样本不足' }
  assert.match(forecastTitle({ ...row, forecast: { ...forecast, forecasts: [unavailable] } }), /样本不足/)
  assert.throws(() => parsePage({ ...page, accounts: [{ ...row, forecast: { ...forecast, forecasts: [{ ...forecast.forecasts[1], estimatedUsd: '0' }] } }] }), /预估美元/)
  check('Forecast decoder preserves null and zero, uses weekly rather than monthly, and exposes sample limitations')
  assert.throws(() => parsePage({ ...page, accounts: [{ ...row, state: { ...state, automatic: 'false' } }] }), /自动使用/)
  assert.throws(() => parsePage({ ...page, accounts: [{ ...row, state: { ...state, cards: { availableCount: -1, credits: [] } } }] }), /卡片数量/)
  assert.throws(() => parseUpdate({ state, quota: {} }), /额度账号/)
  assert.throws(() => parseSettings({ value: { ...settings, automatic: 'false' }, version: 1 }), /自动使用/)
  check('Malformed successful responses cannot silently become business state')
  const uncertain = { ...state, pending: { requestId: 'original-request', creditId: 'card-1', startedAtMs: stamp, automatic: false }, history: [{ atMs: stamp, requestId: 'previous', creditId: null, automatic: false, code: 'reset' }] }
  const update = { state: uncertain, quota: null, forecast, forecastError: null }
  assert.deepEqual(parseUpdate(update), update)
  response = reply(update)
  await api.retry('acct-1', 'original-request')
  assert.equal(JSON.parse(calls.at(-1).body).requestId, 'original-request')
  check('Unknown result and retry retain original durable request ID')
  const exported = csv([row])
  assert.ok(exported.startsWith('\uFEFF'))
  assert.ok(exported.includes('"acct-1"') && exported.includes('"\'=sample full name"') && exported.includes('"sample@example.com"'))
  assert.ok(exported.includes('"周预估金额USD","周预估说明"') && exported.includes('"0"'))
  assert.doesNotMatch(exported, /Token|5小时|暂不支持/)
  assert.ok(isFree({ ...row, account: { ...row.account, plan_type: ' Free ' } }))
  check('CSV retains full identity and formula escaping; Free scope remains normalized')
  console.log(JSON.stringify({ passed: passed.length, tests: passed, productionRequests: 0 }, null, 2))
} finally { delete globalThis.window; await server.close() }
