export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}格式无效`)
  return value
}
export function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  return value
}
export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}格式无效`)
  return value
}
export function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}格式无效`)
  return value
}
export function nonNegativeInteger(value: unknown, label: string): number {
  const result = number(value, label)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label}格式无效`)
  return result
}
export function nullable<T>(value: unknown, parse: (value: unknown, label: string) => T, label: string): T | null {
  return value === null ? null : parse(value, label)
}
export function array<T>(value: unknown, parse: (value: unknown) => T, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}格式无效`)
  return value.map(parse)
}
