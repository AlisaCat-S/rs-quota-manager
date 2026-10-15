import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import { canReset, isAutomaticEligible, isFree, isLimited, planKey, planLabel, selectable, status, week } from './format'
import type { Row, Settings, SettingsResult } from './types'

type Parameters = Omit<Settings, 'automatic'>
const parameters = ({ checkIntervalSeconds, cardsRefreshSeconds, batchSize }: Settings): Parameters => ({ checkIntervalSeconds, cardsRefreshSeconds, batchSize })
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败'

export function useQuotaManager() {
  const rows = ref<Row[]>([]), excludedPending = ref<Row[]>([])
  const loading = ref(false), refreshing = ref(false), busy = ref(''), error = ref(''), notice = ref('')
  const search = ref(''), filter = ref('all'), membership = ref('all'), order = ref('name'), page = ref(1), pageSize = ref(10)
  const settings = ref<SettingsResult>({ value: { automatic: false, checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }, version: null })
  const draft = ref<Parameters>(parameters(settings.value.value)), draftVersion = ref<number | null>(null)
  const baseline = ref(JSON.stringify(draft.value))
  const parametersEditing = ref(false)
  const dirty = computed(() => parametersEditing.value || JSON.stringify(draft.value) !== baseline.value)
  const showCards = ref(false), selectedId = ref(''), selectedCard = ref(''), confirmed = ref(false), consuming = ref(false)
  const bulk = ref(false), stopBulk = ref(false), bulkDone = ref(0), bulkTotal = ref(0), failures = ref<string[]>([])
  const selected = computed(() => [...rows.value, ...excludedPending.value].find(row => row.account.account_id === selectedId.value))
  const blocked = computed(() => !!busy.value || bulk.value || consuming.value)
  const known = computed(() => rows.value.filter(row => row.state.cards !== null).length)
  const totalCards = computed(() => rows.value.reduce((sum, row) => sum + (row.state.cards?.availableCount ?? 0), 0))
  const limited = computed(() => rows.value.filter(isLimited).length)
  const pending = computed(() => rows.value.filter(row => row.state.pending).length + excludedPending.value.length)
  const automaticCount = computed(() => rows.value.filter(row => settings.value.value.automatic && row.state.automatic && isAutomaticEligible(row)).length)
  const planOptions = computed(() => {
    const counts = new Map<string, number>()
    for (const row of rows.value) counts.set(planKey(row), (counts.get(planKey(row)) ?? 0) + 1)
    return [{ label: '全部会员', value: 'all' }, ...Array.from(counts).sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, label: `${planLabel(value)} (${count})` }))]
  })
  const filtered = computed(() => {
    const query = search.value.trim().toLowerCase()
    return rows.value.filter(row => `${row.account.name} ${row.account.account_id} ${row.account.email ?? ''}`.toLowerCase().includes(query)
      && (membership.value === 'all' || planKey(row) === membership.value)
      && (filter.value === 'all' || (filter.value === 'limited' && isLimited(row)) || (filter.value === 'cards' && (row.state.cards?.availableCount ?? 0) > 0)
        || (filter.value === 'pending' && !!row.state.pending) || (filter.value === 'unknown' && !row.state.cards) || (filter.value === 'error' && !!row.state.error)
        || (filter.value === 'disabled' && !row.account.enabled) || (filter.value === 'automatic' && row.state.automatic && settings.value.value.automatic)))
      .sort((a, b) => order.value === 'used' ? (week(b)?.used_percent ?? -1) - (week(a)?.used_percent ?? -1)
        : order.value === 'expiry' ? (Date.parse(selectable(a)[0]?.expiresAt || '') || Infinity) - (Date.parse(selectable(b)[0]?.expiresAt || '') || Infinity)
          : a.account.name.localeCompare(b.account.name))
  })
  const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
  const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
  const cardOptions = computed(() => selected.value ? selectable(selected.value) : [])
  const countOnly = computed(() => !!selected.value?.state.cards && selected.value.state.cards.availableCount > 0 && selected.value.state.cards.credits.length === 0)
  const filteredActive = computed(() => !!search.value || filter.value !== 'all' || membership.value !== 'all')
  let mutation = 0, stopped = false, poll: ReturnType<typeof setInterval> | undefined

  function acceptSettings(result: SettingsResult, reset = false) {
    const preserveDraft = dirty.value && !reset
    settings.value = result
    if (!preserveDraft) {
      draft.value = parameters(result.value)
      baseline.value = JSON.stringify(draft.value)
      draftVersion.value = result.version
      parametersEditing.value = false
    }
    else if (JSON.stringify(parameters(result.value)) === baseline.value) draftVersion.value = result.version
  }
  function resetDraft() { acceptSettings(settings.value, true) }
  function clearFilters() { search.value = ''; filter.value = 'all'; membership.value = 'all' }
  function applyRow(row: Row, result: { state: Row['state']; quota?: Row['quota'] }) {
    row.state = result.state
    if ('quota' in result) row.quota = result.quota ?? null
    row.state.automatic = settings.value.value.automatic && row.state.automatic && isAutomaticEligible(row)
  }
  async function load(silent = false) {
    if (loading.value || refreshing.value || blocked.value || showCards.value) return
    if (silent) refreshing.value = true
    else { loading.value = true; error.value = '' }
    const started = mutation
    try {
      const found: Row[] = [], excluded: Row[] = [], cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const result = await api.accounts(cursor)
        found.push(...result.accounts.filter(row => !isFree(row)))
        excluded.push(...result.excludedPending)
        cursor = result.nextCursor ?? undefined
        if (cursor && cursors.has(cursor)) throw new Error('账号分页重复，请重新加载')
        if (cursor) cursors.add(cursor)
      } while (cursor && !stopped)
      const current = await api.settings()
      // 后台读回不能覆盖读期间发生的开关修改
      if (!stopped && started === mutation && !blocked.value) {
        rows.value = found
        excludedPending.value = excluded
        acceptSettings(current)
      }
    } catch (cause) { error.value = message(cause) }
    finally { loading.value = false; refreshing.value = false }
  }
  async function refresh(row: Row, report = true): Promise<boolean> {
    mutation++; busy.value = row.account.account_id
    if (report) { error.value = ''; notice.value = '' }
    try {
      applyRow(row, await api.refresh(row.account.account_id))
      if (report) notice.value = '额度与卡片已更新'
      return true
    } catch (cause) {
      if (report) error.value = message(cause)
      else failures.value.push(`${row.account.name}：${message(cause)}`)
      return false
    } finally { busy.value = '' }
  }
  async function refreshAll() {
    if (blocked.value) return
    bulk.value = true; stopBulk.value = false; error.value = ''; notice.value = ''; failures.value = []; bulkDone.value = 0
    const targets = filtered.value.filter(canReset)
    bulkTotal.value = targets.length
    try {
      for (const row of targets) {
        if (stopBulk.value || stopped) break
        await refresh(row, false)
        bulkDone.value++
        if (bulkDone.value < targets.length) await new Promise(resolve => setTimeout(resolve, 1000))
      }
      notice.value = `已更新 ${bulkDone.value}/${bulkTotal.value} 个账号${failures.value.length ? `，失败 ${failures.value.length} 个` : ''}`
    } finally { bulk.value = false }
  }
  async function toggleAutomatic(enabled: boolean) {
    if (blocked.value) return
    mutation++; busy.value = 'automatic'; error.value = ''; notice.value = ''
    try {
      acceptSettings(await api.automatic(enabled, settings.value.version))
      for (const row of rows.value) row.state.automatic = enabled && isAutomaticEligible(row)
      notice.value = enabled ? '自动使用已开启' : '所有账号的自动使用已关闭'
    } catch (cause) { error.value = message(cause) }
    finally { busy.value = '' }
    if (error.value) await load(true)
  }
  async function policy(row: Row, enabled: boolean) {
    if (blocked.value) return
    mutation++; busy.value = row.account.account_id; error.value = ''; notice.value = ''
    try {
      const result = await api.policy(row.account.account_id, enabled, settings.value.version)
      acceptSettings(result)
      applyRow(row, result)
    } catch (cause) { error.value = message(cause) }
    finally { busy.value = '' }
    if (error.value) await load(true)
  }
  async function saveSettings() {
    if (blocked.value || !dirty.value) return
    mutation++; busy.value = 'settings'; error.value = ''; notice.value = ''
    try {
      acceptSettings(await api.saveSettings({ ...draft.value, automatic: settings.value.value.automatic }, draftVersion.value), true)
      notice.value = '检测设置已保存'
    } catch (cause) { error.value = message(cause) }
    finally { busy.value = '' }
  }
  function openCards(row: Row) {
    selectedId.value = row.account.account_id
    selectedCard.value = selectable(row)[0]?.id ?? ''
    confirmed.value = false; showCards.value = true
  }
  async function consume() {
    const row = selected.value
    if (!row || !confirmed.value || consuming.value) return
    mutation++; consuming.value = true; error.value = ''; notice.value = ''
    try {
      applyRow(row, row.state.pending ? await api.retry(row.account.account_id, row.state.pending.requestId) : await api.consume(row.account.account_id, selectedCard.value || null))
      if (row.state.pending) notice.value = '结果待确认，自动使用已暂停'
      else {
        notice.value = row.state.error ?? '重置已完成'
        showCards.value = false
        if (isFree(row)) excludedPending.value = excludedPending.value.filter(item => item.account.account_id !== row.account.account_id)
      }
    } catch (cause) {
      error.value = message(cause)
      // 不确定时先回读原操作，避免下一次点击成为新消费
      try {
        let cursor: string | undefined
        const seen = new Set<string>()
        do {
          const result = await api.accounts(cursor)
          const found = [...result.accounts, ...result.excludedPending].find(item => item.account.account_id === row.account.account_id)
          if (found) { applyRow(row, found); break }
          cursor = result.nextCursor ?? undefined
          if (cursor && seen.has(cursor)) throw new Error('分页重复')
          if (cursor) seen.add(cursor)
        } while (cursor)
      } catch { notice.value = '请重新加载账号记录，确认原操作结果' }
    } finally { consuming.value = false; confirmed.value = false }
  }
  watch(cardOptions, options => { if (selectedCard.value && !options.some(card => card.id === selectedCard.value)) { selectedCard.value = options[0]?.id ?? ''; confirmed.value = false } })
  watch([search, filter, membership, order, pageSize], () => { page.value = 1 })
  watch(pages, count => { page.value = Math.min(page.value, count) })
  onMounted(() => { void load(); poll = setInterval(() => { if (!document.hidden) void load(true) }, 30000) })
  onUnmounted(() => { stopped = true; stopBulk.value = true; clearInterval(poll) })
  return { rows, loading, refreshing, busy, error, notice, excludedPending, search, filter, membership, order, page, pageSize, settings, draft, dirty, parametersEditing,
    showCards, selectedCard, confirmed, consuming, bulk, stopBulk, bulkDone, bulkTotal, failures, selected, blocked, known, totalCards, limited, pending, automaticCount,
    planOptions, filtered, visible, cardOptions, countOnly, filteredActive, resetDraft, clearFilters, load, refresh, refreshAll, toggleAutomatic, policy, saveSettings, openCards, consume }
}
