import type { Card, Event, ForecastReport, ForecastResult, Page, Pending, Quota, Row, SettingsResult, State } from '../../types'
import { array, boolean, nonNegativeInteger as integer, nullable, number, record, string } from '../validation'

export function parseSettings(input: unknown): SettingsResult {
  const v = record(input, '检测设置'), s = record(v.value, '设置值')
  return {
    value: { automatic: boolean(s.automatic, '自动使用'), checkIntervalSeconds: integer(s.checkIntervalSeconds, '检测间隔'), cardsRefreshSeconds: integer(s.cardsRefreshSeconds, '卡片更新间隔'), batchSize: integer(s.batchSize, '批次大小') },
    version: nullable(v.version, integer, '设置版本'),
    ...(v.scan === undefined ? {} : { scan: { checkedAtMs: nullable(record(v.scan, '巡检').checkedAtMs, integer, '巡检时间') } }),
  }
}
function parseCard(input: unknown): Card {
  const v = record(input, '重置卡')
  return { id: string(v.id, '卡片标识'), status: nullable(v.status, string, '卡片状态'), title: nullable(v.title, string, '卡片标题'), expiresAt: nullable(v.expiresAt, string, '卡片到期时间'), expiresAtDisplay: nullable(v.expiresAtDisplay, string, '到期显示'), resetType: nullable(v.resetType, string, '重置类型') }
}
function parsePending(input: unknown): Pending {
  const v = record(input, '未决操作')
  return { requestId: string(v.requestId, '请求标识'), creditId: nullable(v.creditId, string, '卡片标识'), startedAtMs: integer(v.startedAtMs, '发起时间'), automatic: boolean(v.automatic, '自动操作') }
}
function parseEvent(input: unknown): Event {
  const v = record(input, '消费记录')
  return { atMs: integer(v.atMs, '消费时间'), requestId: string(v.requestId, '请求标识'), creditId: nullable(v.creditId, string, '卡片标识'), automatic: boolean(v.automatic, '自动操作'), code: string(v.code, '业务结果') }
}
export function parseState(input: unknown): State {
  const v = record(input, '账号状态')
  const cards = v.cards === null ? null : record(v.cards, '卡片库存')
  return {
    automatic: boolean(v.automatic, '自动使用'),
    cards: cards === null ? null : { availableCount: integer(cards.availableCount, '卡片数量'), credits: array(cards.credits, parseCard, '卡片列表') },
    cardsObservedAtMs: nullable(v.cardsObservedAtMs, integer, '卡片观测时间'), cardsCheckedAtMs: nullable(v.cardsCheckedAtMs, integer, '卡片检查时间'),
    error: nullable(v.error, string, '检查错误'), pending: nullable(v.pending, parsePending, '未决操作'),
    awaitingRecovery: boolean(v.awaitingRecovery, '等待回读'), lastAttemptAtMs: nullable(v.lastAttemptAtMs, integer, '上次发起时间'), history: array(v.history, parseEvent, '消费记录'),
  }
}
function parseQuota(input: unknown): Quota {
  const v = record(input, '额度')
  return { account_id: string(v.account_id, '额度账号'), observed_at_ms: nullable(v.observed_at_ms, integer, '额度观测时间'), windows: array(v.windows, input => {
    const w = record(input, '额度窗口')
    return { key: string(w.key, '窗口标识'), window_seconds: nullable(w.window_seconds, integer, '窗口时长'), used_percent: nullable(w.used_percent, number, '用量比例'), reset_at_ms: nullable(w.reset_at_ms, integer, '额度刷新时间') }
  }, '额度窗口') }
}
function parseForecast(input: unknown): ForecastReport {
  const v = record(input, '容量预估')
  return { accountId: string(v.accountId, '预估账号'), generatedAt: string(v.generatedAt, '预估时间'), forecasts: array(v.forecasts, input => {
    const f = record(input, '周期预估')
    return {
      period: string(f.period, '预估周期'), targetDays: number(f.targetDays, '预估天数'), extrapolated: boolean(f.extrapolated, '周期折算'),
      unavailableReason: nullable(f.unavailableReason, string, '预估不可用原因'), lowSample: boolean(f.lowSample, '初步预估'), incompleteCost: boolean(f.incompleteCost, '费用记录不完整'),
      estimatedUsd: nullable(f.estimatedUsd, number, '预估美元'), estimatedUsdDisplay: string(f.estimatedUsdDisplay, '预估美元显示'),
    }
  }, '周期预估') }
}
function parseForecastResult(v: Record<string, unknown>): ForecastResult {
  return { forecast: nullable(v.forecast, parseForecast, '容量预估'), forecastError: nullable(v.forecastError, string, '预估查询错误') }
}
function parseRow(input: unknown): Row {
  const v = record(input, '账号'), a = record(v.account, '账号信息')
  return {
    account: { account_id: string(a.account_id, '账号标识'), provider_id: string(a.provider_id, '提供方'), name: string(a.name, '账号名称'), email: nullable(a.email, string, '账号邮箱'), enabled: boolean(a.enabled, '启用状态'), authentication_kind: string(a.authentication_kind, '认证类型'), plan_type: nullable(a.plan_type, string, '会员标识') },
    quota: nullable(v.quota, parseQuota, '额度'), state: parseState(v.state), ...parseForecastResult(v),
  }
}
export function parsePage(input: unknown): Page {
  const v = record(input, '账号分页')
  return { accounts: array(v.accounts, parseRow, '账号列表'), excludedPending: array(v.excludedPending, parseRow, '已排除未决账号'), nextCursor: nullable(v.nextCursor, string, '分页游标'), generatedAtMs: integer(v.generatedAtMs, '快照时间') }
}
export function parseUpdate(input: unknown): { state: State; quota: Quota | null } & ForecastResult {
  const v = record(input, '更新结果')
  return { state: parseState(v.state), quota: nullable(v.quota, parseQuota, '额度'), ...parseForecastResult(v) }
}
export function parsePolicy(input: unknown): SettingsResult & { state: State } {
  return { ...parseSettings(input), state: parseState(record(input, '账号策略').state) }
}
