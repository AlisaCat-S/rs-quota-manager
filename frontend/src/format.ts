import type { Card, Row } from './types'

export function time(value: string | number | null | undefined): string {
  if (value == null) return '未知'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) : '未知'
}
export const weeks = (row: Row) => row.quota?.windows.filter(w => w.window_seconds === 604800) ?? []
export const isFree = (row: Row) => row.account.plan_type?.trim().toLowerCase() === 'free'
export const planKey = (row: Row) => row.account.plan_type?.trim().toLowerCase() || 'unknown'
export const planLabel = (value: string) => ({ team: 'Team', plus: 'Plus', pro: 'Pro', prolite: 'ProLite', promax: 'ProMax', business: 'Business', enterprise: 'Enterprise', edu: 'Edu', go: 'Go', unknown: '未知套餐' }[value] || value)
export const canReset = (row: Row) => row.account.provider_id === 'openai' && row.account.authentication_kind === 'oauth' && !isFree(row)
export const week = (row: Row) => weeks(row).find(w => w.key.split(':')[0]?.toLowerCase() === 'codex') ?? weeks(row)[0]
export const weeklyForecast = (row: Row) => row.forecast?.forecasts.find(f => f.period === 'weekly')
export function forecastTitle(row: Row): string {
  if (row.forecastError) return `${row.forecastError}，可读取最新快照重试`
  const f = weeklyForecast(row)
  if (!f) return '宿主暂无周限预估'
  return [f.unavailableReason, f.estimatedUsd == null && !f.unavailableReason ? '暂无金额预估' : null, f.extrapolated ? `${f.targetDays} 天折算金额（USD）` : '本周期预估总金额（USD）', f.lowSample ? '样本较少，初步预估' : null, f.incompleteCost ? '费用记录不完整' : null, `预估时间 ${time(row.forecast?.generatedAt)}`].filter(Boolean).join('\n')
}
export const isLimited = (row: Row) => (week(row)?.used_percent ?? -1) >= 100 && (week(row)?.reset_at_ms ?? 0) > Date.now()
export const isAutomaticEligible = (row: Row) => canReset(row) && row.account.enabled
export const available = (card: Card, now = Date.now()) => card.status === 'available' && (!card.expiresAt || new Date(card.expiresAt).getTime() > now)
export const selectable = (row: Row) => row.state.cards?.credits.filter(c => available(c)).sort((a, b) => (a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity) - (b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity)) ?? []
export function status(row: Row): string {
  if (row.state.pending) return '结果待确认'
  if (!row.account.enabled) return '已停用'
  if (row.state.awaitingRecovery) return '等待额度回读'
  if (isLimited(row)) return '周限已满'
  if (row.state.error) return '检查异常'
  if (!week(row)) return '无周限数据'
  return '正常'
}

export function visualIndex(text: string, size: number) { return Array.from(text).reduce((sum, c) => sum + (c.codePointAt(0) || 0), 0) % size }
export function avatarTone(id: string) { return ['blue', 'green', 'orange', 'cyan'][visualIndex(id, 4)] }
export function csv(rows: Row[]): string {
  const cell = (value: unknown) => { let s = String(value ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"` }
  const data = [['账号ID', '完整名称', '邮箱', '启用', '周限已用%', '周限刷新时间', '周限观测时间', '卡张数', '卡到期时间', '卡观测时间', '自动使用', '状态', '周预估金额USD', '周预估说明'],
    ...rows.map(r => [r.account.account_id, r.account.name, r.account.email, r.account.enabled, week(r)?.used_percent, time(week(r)?.reset_at_ms), time(r.quota?.observed_at_ms), r.state.cards?.availableCount, selectable(r).map(c => `${c.id}: ${time(c.expiresAt)}`).join(' | '), time(r.state.cardsObservedAtMs), r.state.automatic, status(r), weeklyForecast(r)?.estimatedUsd, forecastTitle(r)])]
  return '\uFEFF' + data.map(r => r.map(cell).join(',')).join('\r\n')
}
