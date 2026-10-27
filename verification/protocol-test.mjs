import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const binary = process.argv[2] || fileURLToPath(new URL(`../backend/target/debug/quota-manager${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const stamp = Date.now()
const account = (id, enabled = true, plan = 'team') => ({ account_id: id, provider_id: 'openai', name: `team+${id}+2026/10/28+workspace3`, email: `${id}@example.com`, group_ids: [], enabled, updated_at_ms: stamp, plan })
const accounts = [account('acct_001'), account('acct_002', false), account('acct_003'), account('acct_004'), account('acct_005'), account('acct_006', true, 'free'), account('acct_007', true, ' Free '), account('acct_008', true, 'plus')]
accounts[7].name = 'free-prefix-but-paid-plus@example.com'
const quota = (id, used = 25, key = 'codex:604800s', seconds = 604800) => ({ schema_version: 1, account_id: id, observed_at_ms: Date.now(), windows: [{ key, window_seconds: seconds, used_percent: used, reset_at_ms: stamp + 86400000 }] })
const quotas = new Map(accounts.map(a => [a.account_id, quota(a.account_id)]))
const forecast = id => ({ accountId: id, generatedAt: new Date().toISOString(), forecasts: [
  { period: 'weekly', targetDays: 7, extrapolated: false, unavailableReason: null, lowSample: false, incompleteCost: false, estimatedUsd: 37.5, estimatedUsdDisplay: '$37.50' },
  { period: 'monthly', targetDays: 30, extrapolated: true, unavailableReason: null, lowSample: false, incompleteCost: false, estimatedUsd: 150, estimatedUsdDisplay: '$150.00' },
] })
const forecasts = new Map(accounts.map(a => [a.account_id, forecast(a.account_id)])), forecastQueries = []
let forecastMode = 'normal'
const cards = new Map(accounts.map(a => [a.account_id, { availableCount: 2, credits: [
  { id: `${a.account_id}_late`, status: 'available', title: 'Full reset (Weekly + 5 hr)', resetType: 'full', expiresAt: new Date(stamp + 86400000 * 7).toISOString(), expiresAtDisplay: null },
  { id: `${a.account_id}_early`, status: 'available', title: 'Full reset (Weekly + 5 hr)', resetType: 'full', expiresAt: new Date(stamp + 86400000 * 2).toISOString(), expiresAtDisplay: null },
] }]))
const records = new Map(), posts = [], refreshCalls = [], reads = [], handles = new Map()
const runtimeAccount = a => ({ account_id: a.account_id, provider_id: a.provider_id, name: a.name, email: a.email, enabled: a.enabled,
  credential_revision: 1, upstream_user_id: null, upstream_account_id: null, plan_type: a.plan, authentication_kind: 'oauth', credential_state: 'ready', has_refresh_token: true, access_token_expires_at_ms: null, next_refresh_at_ms: null })
let consumeMode = 'reset', child, buffered, pending, ready, sequence = 99, errors = '', activeMode = 'normal', incarnation, handleSequence = 0, runtimeReads = 0, cardQueries = 0, failSelectionWrite = false

const schedules = new Map(), residentCallbacks = new Map(), heldResumes = new Map()
let holdResumes = false, suspensionCount = 0, consumptionCount = 0

// RPC v7 keeps only control fields in metadata. Request context and business
// JSON precede the raw body, with separate byte lengths (SDK client/frame.rs).
function encode(meta, payload = Buffer.alloc(0)) {
  if (!(payload instanceof Buffer)) payload = Buffer.from(JSON.stringify(payload))
  meta = structuredClone(meta)
  let request = Buffer.alloc(0), data = Buffer.alloc(0)
  if (meta.type === 'call' && meta.context.request) {
    request = Buffer.from(JSON.stringify(meta.context.request))
    delete meta.context.request
    meta.request_context_bytes = request.length
  }
  if (meta.type === 'hello') {
    data = Buffer.from(JSON.stringify(meta.handshake.configuration))
    delete meta.handshake.configuration
  } else if (meta.type === 'call' || meta.type === 'callback') {
    data = Buffer.from(JSON.stringify(meta.params))
    delete meta.params
  } else if (meta.type === 'result') {
    data = Buffer.from(JSON.stringify(meta.result))
    delete meta.result
  }
  if (data.length) meta.data_bytes = data.length
  const json = Buffer.from(JSON.stringify(meta)), header = Buffer.alloc(12)
  assert.ok(json.length <= 65536)
  header.writeUInt32BE(json.length); header.writeBigUInt64BE(BigInt(request.length + data.length + payload.length), 4)
  return Buffer.concat([header, json, request, data, payload])
}
function send(meta, payload = Buffer.alloc(0)) { child.stdin.write(encode(meta, payload)) }
function result(id, value = {}, payload = Buffer.alloc(0)) { send({ type: 'result', id, result: value }, payload) }
function error(id, code = 'rejected') { send({ type: 'error', id, error: { code, message: 'mock rejection', send_state: 'not_sent' } }) }
async function callback(meta, payload) {
  reads.push(meta.method)
  const data = payload.length ? JSON.parse(payload.toString()) : meta.params
  if (meta.method === 'host.data.accounts.list' || meta.method === 'host.auth.list') {
    const start = data.cursor ? accounts.findIndex(a => a.account_id === data.cursor) + 1 : 0
    const batch = accounts.slice(start, start + Math.min(data.limit, 2))
    return result(meta.id, {}, { ...(meta.method === 'host.data.accounts.list' ? {schema_version:1} : {}), accounts: meta.method === 'host.auth.list' ? batch.map(runtimeAccount) : batch, next_cursor: start + batch.length < accounts.length ? batch.at(-1).account_id : null })
  }
  if (meta.method === 'host.data.quota.get' || meta.method === 'host.quota_observations.refresh') {
    const q = structuredClone(quotas.get(data.account_id))
    if (meta.method.includes('refresh')) { refreshCalls.push(data.account_id); q.observed_at_ms = Date.now(); if (activeMode === 'recovered') q.windows[0].used_percent = 10 }
    return result(meta.id, {}, q)
  }
  if (meta.method === 'host.auth.get_runtime') {
    runtimeReads++
    const a = accounts.find(a => a.account_id === data.account_id)
    return result(meta.id, {}, runtimeAccount(a))
  }
  if (meta.method === 'host.state.get') return result(meta.id, { record: records.get(data.key) ?? null })
  if (meta.method === 'host.state.put') {
    if (data.key === 'automation' && failSelectionWrite) { failSelectionWrite = false; return error(meta.id) }
    const existing = records.get(data.key)
    if ((existing?.version ?? null) !== data.expected_version) return error(meta.id, 'conflict')
    const version = (existing?.version ?? 0) + 1
    records.set(data.key, { value: structuredClone(data.value), version, schema_version: 1 })
    return result(meta.id, { version })
  }
  if (meta.method === 'host.http.dispatch') {
    const url = new URL(meta.params.uri, 'http://mock.invalid'), id = url.searchParams.get('accountId') || data.accountId
    assert.ok(['/api/admin/accounts/reset-credits', '/api/admin/accounts/quota-forecast'].includes(url.pathname))
    let envelope, status = 200
    if (url.pathname === '/api/admin/accounts/quota-forecast') {
      assert.equal(meta.params.method, 'GET')
      assert.deepEqual([...url.searchParams.keys()], ['accountId'], 'Local forecast must not request an upstream refresh')
      assert.equal(meta.params.body.kind, 'empty')
      forecastQueries.push(id)
      if (id === 'acct_001' && forecastMode === 'failed') return error(meta.id)
      const report = structuredClone(forecasts.get(id))
      for (const item of report.forecasts) Object.assign(item, { estimatedTokens: 2500000, estimatedTokensDisplay: '2.50M', incompleteTokens: false })
      if (id === 'acct_001' && forecastMode === 'mismatch') report.accountId = 'another-account'
      if (id === 'acct_001' && forecastMode === 'invalid') report.forecasts[0].estimatedUsdDisplay = 37.5
      envelope = { code: 200, message: 'ok', data: report }
    }
    else if (meta.params.method === 'GET') { cardQueries++; envelope = { code: 200, message: 'ok', data: cards.get(id) }; if (activeMode === 'downgraded') accounts.find(a=>a.account_id===id).plan = 'free'; if (activeMode === 'automation_off') { records.get('settings').value.automatic = false; records.get('settings').version++ } }
    else {
      assert.equal(meta.params.method, 'POST')
      const state = records.get(`account/${id}`).value
      assert.equal(state.pending.requestId, data.redeemRequestId, 'Pending UUID must be durable before POST')
      assert.equal(state.pending.creditId, data.creditId)
      assert.match(data.redeemRequestId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
      posts.push(structuredClone(data))
      if (consumeMode === 'disconnect') { child.stdin.end(); return }
      if (consumeMode === 'uncertain') return error(meta.id, 'uncertain')
      if (consumeMode === 'host_conflict') { status = 409; envelope = { code: 409, message: '自动重置结果待确认，请稍后刷新' } }
      else if (consumeMode === 'rate_limited') { status = 429; envelope = { code: 429, message: 'mock rate limit' } }
      else if (consumeMode === 'invalid') envelope = { code: 200, message: 'ok', data: {} }
      else {
        const c = cards.get(id)
        c.availableCount = Math.max(0, c.availableCount - 1); c.credits = c.credits.filter(c => c.id !== data.creditId)
        quotas.set(id, quota(id, 0))
        envelope = { code: 200, message: 'ok', data: { code: consumeMode, credit: null } }
      }
    }
    const handle = `body_${++handleSequence}`; handles.set(handle, Buffer.from(JSON.stringify(envelope)))
    return result(meta.id, { status, version: 'HTTP/1.1', headers: [], body: { kind: 'handle', handle }, response: null, session: false })
  }
  if (meta.method === 'host.http.body_read') {
    const value = handles.get(meta.params.handle)
    if (value) { handles.delete(meta.params.handle); return result(meta.id, { eof: false, trailers: null }, value) }
    return result(meta.id, { eof: true, trailers: null })
  }
  if (meta.method === 'host.http.body_close') return result(meta.id, {})
  throw new Error(`Unhandled callback: ${meta.method}`)
}
function parse() {
  while (buffered.length >= 12) {
    const m = buffered.readUInt32BE(), p = Number(buffered.readBigUInt64BE(4)), total = 12 + m + p
    if (buffered.length < total) return
    assert.ok(m > 0 && m <= 65536)
    const meta = JSON.parse(buffered.subarray(12, 12 + m).toString())
    const contextBytes = meta.request_context_bytes ?? 0, dataBytes = meta.data_bytes ?? 0
    assert.ok(contextBytes + dataBytes <= p)
    assert.equal(contextBytes, 0, 'Plugin responses must not contain an entry request snapshot')
    if (meta.type === 'callback' || meta.type === 'result') {
      assert.ok(dataBytes > 0, 'RPC v7 requires a business JSON prefix')
      const field = meta.type === 'callback' ? 'params' : 'result'
      assert.ok(!(field in meta), 'Business JSON must not leak back into control metadata')
      meta[field] = JSON.parse(buffered.subarray(12 + m + contextBytes, 12 + m + contextBytes + dataBytes).toString())
    } else assert.equal(dataBytes, 0)
    const payload = buffered.subarray(12 + m + contextBytes + dataBytes, total); buffered = buffered.subarray(total)
    if (meta.type === 'ready') {
      assert.equal(meta.protocol_version, 7)
      assert.equal(meta.incarnation, incarnation)
      assert.deepEqual(meta.call_budgets, {}, 'Use the SDK stage defaults, including maintenance 120s')
      ready.resolve()
    } else if (meta.type === 'suspend') {
      assert.equal(payload.length, 0)
      const schedule = schedules.get(meta.id)
      assert.equal(schedule.phase, 'running')
      assert.equal(meta.epoch, schedule.epoch + 1)
      schedule.epoch = meta.epoch; schedule.phase = 'suspended'; suspensionCount++
    } else if (meta.type === 'resume') {
      assert.equal(payload.length, 0)
      const schedule = schedules.get(meta.id)
      assert.equal(schedule.phase, 'suspended')
      assert.equal(meta.epoch, schedule.epoch)
      schedule.phase = 'resuming'
      if (holdResumes) heldResumes.set(meta.id, meta.epoch)
      else authorizeResume(meta.id, meta.epoch)
    } else if (meta.type === 'callback_consumed') {
      assert.equal(payload.length, 0)
      assert.equal(residentCallbacks.get(meta.id), meta.parent_id)
      residentCallbacks.delete(meta.id); consumptionCount++
    } else if (meta.type === 'callback') {
      assert.equal(schedules.get(meta.parent_id).phase, 'running', 'No business processing before Resumed')
      assert.ok(!residentCallbacks.has(meta.id))
      residentCallbacks.set(meta.id, meta.parent_id)
      callback(meta, payload).catch(e => { ready.reject(e); for (const x of pending.values()) x.reject(e) })
    } else if (meta.type === 'result' || meta.type === 'error' || meta.type === 'cancelled') {
      // Terminal calls reclaim remaining callbacks, including cancellation/timeout races.
      for (const [id, parent] of residentCallbacks) if (parent === meta.id) residentCallbacks.delete(id)
      schedules.delete(meta.id)
      const waiter = pending.get(meta.id)
      if (waiter) { pending.delete(meta.id); meta.type === 'result' ? waiter.resolve({ result: meta.result, payload }) : waiter.reject(new Error(meta.type === 'cancelled' ? 'cancelled' : JSON.stringify(meta.error))) }
    } else assert.fail(`Unhandled plugin frame: ${meta.type}`)
  }
}
function authorizeResume(id, epoch) {
  const schedule = schedules.get(id)
  if (schedule) { assert.equal(schedule.phase, 'resuming'); schedule.phase = 'running' }
  heldResumes.delete(id)
  send({ type: 'resumed', id, epoch })
}
async function waitFor(predicate) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for scheduling control')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
async function start() {
  schedules.clear(); residentCallbacks.clear(); heldResumes.clear(); holdResumes = false
  buffered = Buffer.alloc(0); pending = new Map(); ready = Promise.withResolvers(); errors = ''; incarnation = `test_${Date.now()}`
  child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { buffered = Buffer.concat([buffered, data]); parse() })
  child.stderr.on('data', data => { errors += data }); child.on('error', e => ready.reject(e))
  child.on('exit', code => { const e = new Error(`Plugin exited ${code}: ${errors}`); ready.reject(e); for (const w of pending.values()) w.reject(e) })
  send(hello())
  await Promise.race([ready.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Handshake timeout: ${errors}`)), 10000).unref())])
}
async function stop() { const exited = new Promise(resolve => child.once('exit', resolve)); send({ type: 'shutdown' }); child.stdin.end(); await exited }
function hello(protocolVersion = 7, managementVersion = 2) {
  return { type: 'hello', handshake: { protocol_version: protocolVersion, artifact_sha256: 'a'.repeat(64), plugin_id: 'personal.quota-manager', instance_id: 'test_instance', generation: 1, incarnation, configuration: {}, contributes: {
    management: { id: 'personal.quota-manager.management', version: managementVersion, stages: ['management'] }, maintenance: { id: 'personal.quota-manager.maintenance', version: 1, stages: ['maintenance'] },
  } } }
}
async function rejectsHandshake(protocolVersion, managementVersion) {
  const process = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = '', callbacks = Buffer.alloc(0)
  process.stderr.on('data', chunk => { stderr += chunk })
  process.stdout.on('data', chunk => { callbacks = Buffer.concat([callbacks, chunk]) })
  const exited = new Promise((resolve, reject) => { process.on('error', reject); process.on('exit', resolve) })
  const timer = setTimeout(() => process.kill(), 10000)
  try {
    process.stdin.end(encode(hello(protocolVersion, managementVersion)))
    assert.notEqual(await exited, 0)
    assert.match(stderr, /Handshake|contract version/)
    assert.ok(!callbacks.includes(Buffer.from('"type":"callback"')))
  } finally { clearTimeout(timer) }
}
async function call(method, params = {}, payload = Buffer.alloc(0), stage = 'management', requestContext, timeoutMs = stage === 'registration' ? 5000 : 120000) {
  const id = sequence += 2, waiter = Promise.withResolvers(); pending.set(id, waiter)
  schedules.set(id, { epoch: 0, phase: 'running' })
  send({ type: 'call', id, method, params, context: { call_id: id, instance_id: 'test_instance', generation: 1, incarnation, stage, timeout_ms: timeoutMs, resource_stream: false, resource_scope_id: `scope_${id}`, request: requestContext } }, payload)
  return Promise.race([waiter.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Call timeout ${method}: ${errors}`)), 10000).unref())])
}
async function request(path, body, query = '') {
  const reply = await call('management.handle', { method: body === undefined ? 'GET' : 'POST', path, query, content_type: body === undefined ? null : 'application/json', headers: [] }, body === undefined ? Buffer.alloc(0) : body)
  return { status: reply.result.status, value: JSON.parse(reply.payload.toString()) }
}
async function scan() { const s = records.get('scan'); if (s) s.value.nextAtMs = 0; return call('plugin.reconcile', {}, Buffer.alloc(0), 'maintenance') }
const passed = [], check = label => { passed.push(label); console.log(`PASS ${label}`) }
try {
  await start()
  const registrationReply = await call('management.register', {}, Buffer.alloc(0), 'registration')
  const registration = JSON.parse(registrationReply.payload.toString()); assert.equal(registration.pages[0].entry, 'web/index.html'); assert.equal(registration.routes.length, 8)
  check('SDK RPC v7 handshake, default stage budgets and management v2 registration')
  const largeHeaders = [{ name: 'x-test', value: Buffer.from('x'.repeat(70000)).toString('base64') }, { name: 'x-test', value: Buffer.from([0, 128, 255]).toString('base64') }]
  const contextual = await call('management.handle', { method: 'GET', path: 'api/settings', query: '', content_type: null, headers: [] }, Buffer.alloc(0), 'management', { method: 'GET', uri: '/api/plugins/mock/api/settings', http_version: 'HTTP/1.1', headers: largeHeaders, peer_addr: '127.0.0.1:1234', client_ip: '127.0.0.1' })
  assert.equal(JSON.parse(contextual.payload.toString()).value.automatic, false)
  check('RPC v7 separates large base64 request snapshots from control metadata and JSON body')
  await rejectsHandshake(2, 2)
  await rejectsHandshake(4, 2)
  await rejectsHandshake(5, 2)
  await rejectsHandshake(6, 2)
  check('Old process protocols are rejected before any host operation')
  await rejectsHandshake(7, 1)
  check('Obsolete management v1 is rejected before any host operation')
  const settingsRequest = { method: 'GET', path: 'api/settings', query: '', content_type: null, headers: [] }
  holdResumes = true
  const beforeHeldReads = reads.length, beforeConsumed = consumptionCount
  const held = call('management.handle', settingsRequest), heldId = sequence
  await waitFor(() => heldResumes.has(heldId))
  assert.equal(reads.length, beforeHeldReads + 1)
  assert.equal(consumptionCount, beforeConsumed, 'Receiving a callback result does not consume it')
  assert.ok([...residentCallbacks.values()].includes(heldId))
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(reads.length, beforeHeldReads + 1, 'The handler must wait for host execution admission')
  holdResumes = false; authorizeResume(heldId, heldResumes.get(heldId))
  assert.equal(JSON.parse((await held).payload.toString()).value.automatic, false)
  assert.equal(consumptionCount, beforeConsumed + 2)
  check('RPC v7 pairs suspend/resume epochs and consumes callback results only after Resumed')

  holdResumes = true
  const cancelled = call('management.handle', settingsRequest), cancelledId = sequence
  const cancellation = assert.rejects(cancelled, /cancelled/)
  await waitFor(() => heldResumes.has(cancelledId))
  const cancelledEpoch = heldResumes.get(cancelledId), beforeCancelReads = reads.length
  send({ type: 'cancel', id: cancelledId }); await cancellation
  assert.ok(![...residentCallbacks.values()].includes(cancelledId))
  holdResumes = false; authorizeResume(cancelledId, cancelledEpoch)
  await request('api/settings')
  assert.equal(reads.length, beforeCancelReads + 2, 'Late authorization must not restart a cancelled handler')
  check('Cancellation while awaiting Resumed reclaims callbacks and ignores late authorization')

  holdResumes = true
  const timedOut = call('management.handle', settingsRequest, Buffer.alloc(0), 'management', undefined, 1000), timedOutId = sequence
  const timeout = assert.rejects(timedOut, /timeout/)
  await waitFor(() => heldResumes.has(timedOutId))
  const timedOutEpoch = heldResumes.get(timedOutId)
  await timeout
  assert.ok(![...residentCallbacks.values()].includes(timedOutId))
  holdResumes = false; authorizeResume(timedOutId, timedOutEpoch)
  await request('api/settings')
  check('Ordinary callback recovery waiting consumes the parent budget and timeout leaves the session usable')
  const page = await request('api/accounts'); assert.equal(page.status, 200); assert.equal(page.value.accounts.length, 2); assert.equal(page.value.nextCursor, 'acct_002'); assert.equal(page.value.accounts[0].account.name, accounts[0].name)
  assert.equal(page.value.accounts[0].account.plan_type, 'team'); assert.equal(page.value.accounts[1].account.enabled, false)
  assert.ok(page.value.accounts.every(row=>!row.state.automatic))
  check('Pagination includes complete account ID and name')
  assert.deepEqual(page.value.accounts[0].forecast, forecasts.get('acct_001'))
  assert.equal(page.value.accounts[0].forecastError, null)
  assert.equal(refreshCalls.length, 0); assert.equal(cardQueries, 0); assert.equal(posts.length, 0)
  check('Account snapshots read current local host forecasts without refreshing quota or cards')
  for (const mode of ['failed', 'mismatch', 'invalid']) {
    forecastMode = mode
    const partial = await request('api/accounts')
    assert.equal(partial.status, 200); assert.equal(partial.value.accounts.length, 2)
    assert.equal(partial.value.accounts[0].forecast, null)
    assert.equal(partial.value.accounts[0].forecastError, mode === 'failed' ? '预估查询失败' : '预估响应无效')
    assert.equal(partial.value.accounts[0].state.error, null)
    assert.deepEqual(partial.value.accounts[1].forecast, forecasts.get('acct_002'))
  }
  forecastMode = 'normal'
  check('Unavailable, malformed and wrong-account forecasts cannot hide accounts or affect automation state')
  forecasts.get('acct_001').forecasts[0].estimatedUsd = 0
  forecasts.get('acct_001').forecasts[0].estimatedUsdDisplay = '$0.00'
  const refreshedForecast = await request('api/refresh', { accountId: 'acct_001' })
  assert.equal(refreshedForecast.status, 200)
  assert.equal(refreshedForecast.value.forecast.forecasts[0].estimatedUsd, 0)
  assert.equal(refreshedForecast.value.forecastError, null)
  check('Manual refresh returns the latest host forecast and preserves zero estimates')
  const freePage = await request('api/accounts', undefined, 'cursor=acct_006'); assert.equal(freePage.value.accounts.length, 1); assert.equal(freePage.value.accounts[0].account.account_id, 'acct_008')
  const mixedPage = await request('api/accounts', undefined, 'cursor=acct_005'); assert.equal(mixedPage.value.accounts.length, 0); assert.equal(mixedPage.value.nextCursor, 'acct_007')
  const paidAfterFree = await request('api/accounts', undefined, 'cursor='+mixedPage.value.nextCursor); assert.equal(paidAfterFree.value.accounts[0].account.plan_type, 'plus')
  check('RS plan type excludes Free despite team-like names and preserves empty-page pagination')
  assert.ok(!forecastQueries.some(id => id === 'acct_006' || id === 'acct_007'))
  const beforeFreeQueries = cardQueries, beforeFreePosts = posts.length
  for (const path of ['api/consume','api/refresh','api/policy']) { const blocked=await request(path,{accountId:'acct_006',creditId:'acct_006_early',automatic:true}); assert.equal(blocked.status,400) }
  assert.equal(posts.length,beforeFreePosts); assert.equal(cardQueries,beforeFreeQueries)
  check('Free cannot refresh cards, change automation policy or start redemption')
  await scan(); assert.equal(posts.length, 0); check('Automatic consumption is off by default')
  records.get('scan').value.nextAtMs = 0
  const beforeShortBudget = reads.length
  const beforeScanCursor = records.get('scan').value.cursor
  holdResumes = true
  const shortScan = call('plugin.reconcile', {}, Buffer.alloc(0), 'maintenance', undefined, 18500), shortScanId = sequence
  await waitFor(() => heldResumes.has(shortScanId))
  await new Promise(resolve => setTimeout(resolve, 650))
  holdResumes = false; authorizeResume(shortScanId, heldResumes.get(shortScanId))
  await shortScan
  assert.ok(!reads.slice(beforeShortBudget).includes('host.data.quota.get'))
  assert.equal(records.get('scan').value.cursor, beforeScanCursor)
  assert.ok(records.get('scan').value.nextAtMs > Date.now())
  assert.equal(posts.length, 0)
  check('Maintenance counts prelude/recovery time in its remaining budget and persists its scan cursor')
  const saved = await request('api/settings', { value: { automatic: true, checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }, expectedVersion: null }); assert.equal(saved.status, 200)
  const conflict = await request('api/settings', { value: saved.value.value, expectedVersion: null }); assert.equal(conflict.status, 409); check('Settings reject stale writers')
  const automatic = enabled => request('api/automatic',{enabled,expectedVersion:records.get('settings')?.version??null})
  let policyResult=await request('api/policy',{accountId:'acct_003',automatic:false,expectedVersion:records.get('settings').version});assert.equal(policyResult.status,200);assert.equal(policyResult.value.state.automatic,false)
  let policyPage=await request('api/accounts',undefined,'cursor=acct_002');assert.equal(policyPage.value.accounts[0].state.automatic,false);assert.equal(policyPage.value.accounts[1].state.automatic,true)
  check('Per-account changes preserve other automatic selections')
  let changedSettings=await request('api/settings',{value:{...saved.value.value,checkIntervalSeconds:60},expectedVersion:records.get('settings').version});assert.equal(changedSettings.status,200)
  policyPage=await request('api/accounts',undefined,'cursor=acct_002');assert.equal(policyPage.value.accounts[0].state.automatic,false)
  check('Inline parameter saves preserve account exclusions')
  let off=await automatic(false);assert.equal(off.status,200);policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic))
  await stop();await start();policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic))
  check('Master off clears effective account switches and survives restart')
  policyResult=await request('api/policy',{accountId:'acct_003',automatic:true,expectedVersion:records.get('settings').version});assert.equal(policyResult.value.value.automatic,true)
  policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic));policyPage=await request('api/accounts',undefined,'cursor=acct_002');assert.equal(policyPage.value.accounts[0].state.automatic,true);assert.equal(policyPage.value.accounts[1].state.automatic,false)
  check('Enabling one account while master is off enables only that account')
  let on=await automatic(true);assert.equal(on.status,200);policyPage=await request('api/accounts');assert.equal(policyPage.value.accounts[0].state.automatic,true);assert.equal(policyPage.value.accounts[1].state.automatic,false)
  check('Master on selects applicable accounts while paused accounts remain off')
  failSelectionWrite=true;off=await automatic(false);assert.equal(off.status,400);assert.equal(records.get('settings').value.automatic,false);policyPage=await request('api/accounts');assert.ok(policyPage.value.accounts.every(row=>!row.state.automatic))
  check('Failure clearing selections cannot reopen an already disabled master gate')
  on=await automatic(true);assert.equal(on.status,200)
  const scanState=records.get('scan');scanState.value.cursor='acct_005';scanState.value.nextAtMs=0;const beforeFreeScan=cardQueries;quotas.set('acct_006',quota('acct_006',100));quotas.set('acct_007',quota('acct_007',100));await scan();assert.equal(cardQueries,beforeFreeScan);assert.equal(posts.length,0)
  check('Background scan skips Free even when a weekly limit exists')
  records.get('scan').value.cursor = null; quotas.set('acct_001', quota('acct_001', 100)); quotas.set('acct_002', quota('acct_002', 100))
  await scan(); assert.equal(posts.length, 1); assert.equal(posts[0].creditId, 'acct_001_early'); assert.ok(refreshCalls.includes('acct_001')); assert.equal(accounts[1].enabled, false)
  check('Fresh weekly exhaustion redeems earliest expiry and preserves pause state')
  records.get('account/acct_001').value.awaitingRecovery = true; records.get('account/acct_001').value.lastAttemptAtMs = Date.now() - 120000
  records.get('scan').value.cursor = null; quotas.set('acct_001', quota('acct_001', 100)); await scan(); assert.equal(posts.length, 1)
  check('A reset awaiting recovery cannot consume another card')
  records.get('account/acct_001').value.awaitingRecovery = false
  records.get('scan').value.cursor = null; quotas.set('acct_001', quota('acct_001', 100, 'review:604800s')); await scan(); assert.equal(posts.length, 1)
  check('Model-specific weekly limits and disabled accounts do not redeem')
  quotas.set('acct_001', quota('acct_001', 100, 'codex:18000s', 18000)); records.get('scan').value.cursor = null; await scan(); assert.equal(posts.length, 1)
  check('Five-hour exhaustion does not trigger weekly redemption')
  quotas.set('acct_003', quota('acct_003', 100)); records.get('scan').value.cursor = 'acct_002'; activeMode = 'recovered'; await scan(); assert.equal(posts.length, 1); activeMode = 'normal'
  check('Cached exhaustion is skipped when upstream has recovered')
  activeMode = 'downgraded';const downgradePosts=posts.length;const downgrade=await request('api/consume',{accountId:'acct_003',creditId:'acct_003_early'});assert.equal(downgrade.status,400);assert.equal(posts.length,downgradePosts);assert.equal(records.get('account/acct_003')?.value.pending??null,null);accounts[2].plan='team';activeMode='normal'
  check('A downgrade observed during refresh blocks consumption')
  consumeMode = 'uncertain'; const unknown = await request('api/consume', { accountId: 'acct_004', creditId: 'acct_004_early' }); assert.equal(unknown.status, 200); assert.ok(unknown.value.state.pending)
  const count = posts.length, original = posts.at(-1).redeemRequestId
  const duplicate = await request('api/consume', { accountId: 'acct_004', creditId: 'acct_004_late' }); assert.equal(duplicate.status, 400); assert.equal(posts.length, count)
  check('Unknown result blocks a new card operation')
  accounts[3].plan='free';const downgradedPending=await request('api/accounts',undefined,'cursor=acct_002');assert.ok(!downgradedPending.value.accounts.some(r=>r.account.account_id==='acct_004'));assert.equal(downgradedPending.value.excludedPending[0].state.pending.requestId,original)
  check('Downgraded Free leaves the active list but retains an unresolved original request')
  await stop(); await start(); consumeMode = 'already_redeemed'
  const retry = await request('api/retry', { accountId: 'acct_004', requestId: original }); assert.equal(retry.status, 200); assert.equal(posts.at(-1).redeemRequestId, original); assert.equal(retry.value.state.pending, null); assert.equal(retry.value.state.history[0].code, 'already_redeemed')
  assert.deepEqual(retry.value.forecast, forecasts.get('acct_004'))
  check('Process restart retry reuses the durable original UUID')
  assert.equal(accounts[3].plan,'free');check('An existing uncertain operation can be confirmed after plan downgrade')
  consumeMode = 'invalid'; const invalid = await request('api/consume', { accountId: 'acct_005', creditId: 'acct_005_early' }); assert.ok(invalid.value.state.pending)
  check('HTTP success without a semantic result remains uncertain')
  consumeMode = 'unexpected_code'
  const unexpected = await request('api/retry', { accountId: 'acct_005', requestId: invalid.value.state.pending.requestId }); assert.ok(unexpected.value.state.pending)
  check('Unrecognized upstream result does not clear pending operation')
  consumeMode = 'host_conflict'
  const nativeConflict = await request('api/consume', { accountId: 'acct_008', creditId: 'acct_008_early' })
  const conflictRequest = nativeConflict.value.state.pending.requestId
  assert.equal(nativeConflict.value.state.history.length, 0)
  assert.equal(cards.get('acct_008').availableCount, 2)
  const beforeConflictRetry = posts.length
  assert.equal((await request('api/consume', { accountId: 'acct_008', creditId: 'acct_008_late' })).status, 400)
  assert.equal(posts.length, beforeConflictRetry)
  consumeMode = 'reset'
  const nativeRetry = await request('api/retry', { accountId: 'acct_008', requestId: conflictRequest })
  assert.equal(posts.at(-1).redeemRequestId, conflictRequest)
  assert.equal(posts.at(-1).creditId, 'acct_008_early')
  assert.equal(nativeRetry.value.state.pending, null)
  check('Native automation HTTP 409 retains the original card and request ID until explicit retry')
  consumeMode = 'rate_limited'
  const rateLimited = await request('api/consume', { accountId: 'acct_008', creditId: 'acct_008_late' })
  assert.equal(rateLimited.status, 200)
  const limitedRequest = rateLimited.value.state.pending.requestId, beforeRateRetry = posts.length
  assert.equal(rateLimited.value.state.history.length, 1)
  assert.equal(cards.get('acct_008').availableCount, 1)
  assert.equal((await request('api/consume', { accountId: 'acct_008', creditId: 'acct_008_late' })).status, 400)
  quotas.set('acct_008', quota('acct_008', 100))
  records.get('account/acct_008').value.lastAttemptAtMs = Date.now() - 120000
  records.get('scan').value.cursor = 'acct_007'
  await scan()
  assert.equal(posts.length, beforeRateRetry, 'Inference replay eligibility must not retry card management POSTs')
  consumeMode = 'reset'
  const limitedRetry = await request('api/retry', { accountId: 'acct_008', requestId: limitedRequest })
  assert.equal(posts.at(-1).redeemRequestId, limitedRequest)
  assert.equal(posts.at(-1).creditId, 'acct_008_late')
  assert.equal(limitedRetry.value.state.pending, null)
  check('Management HTTP 429 never auto-replays a card POST and explicit retry preserves the original UUID')

  consumeMode = 'disconnect'
  await assert.rejects(request('api/consume', { accountId: 'acct_003', creditId: 'acct_003_early' }), /Plugin exited/)
  const interrupted = posts.at(-1), beforeReconnect = posts.length
  assert.equal(records.get('account/acct_003').value.pending.requestId, interrupted.redeemRequestId)
  assert.equal(records.get('account/acct_003').value.history.length, 0)
  await start()
  assert.equal((await request('api/consume', { accountId: 'acct_003', creditId: 'acct_003_late' })).status, 400)
  assert.equal(posts.length, beforeReconnect)
  consumeMode = 'already_redeemed'
  const reconnected = await request('api/retry', { accountId: 'acct_003', requestId: interrupted.redeemRequestId })
  assert.equal(posts.at(-1).redeemRequestId, interrupted.redeemRequestId)
  assert.equal(posts.at(-1).creditId, interrupted.creditId)
  assert.equal(reconnected.value.state.pending, null)
  check('Session EOF after dispatch preserves pending state and restart confirms only the original card and UUID')
  consumeMode='reset';on=await automatic(true);assert.equal(on.status,200);records.get('account/acct_001').value.awaitingRecovery=false;records.get('account/acct_001').value.lastAttemptAtMs=Date.now()-120000;quotas.set('acct_001',quota('acct_001',100));records.get('scan').value.cursor=null;activeMode='automation_off';const beforeOffDuringRefresh=posts.length;await scan();assert.equal(posts.length,beforeOffDuringRefresh);assert.equal(records.get('settings').value.automatic,false);activeMode='normal'
  check('Master off observed during upstream refresh prevents a pending automatic redemption')
  assert.ok(!reads.includes('host.auth.get')); assert.ok(!reads.includes('host.auth.save')); check('No credentials are read or account settings modified')
  assert.ok(suspensionCount > 0); assert.ok(consumptionCount > 0)
  assert.equal(schedules.size, 0); assert.equal(residentCallbacks.size, 0)
  await stop(); console.log(JSON.stringify({ passed: passed.length, tests: passed, mockRedemptions: posts.length, productionRequests: 0 }, null, 2))
} catch (e) { child?.kill(); console.error(e); process.exitCode = 1 }
