import { getHost } from './host'
import { isRecord } from './validation'

// Follow the official workbench bridge boundary; business decoders own response types.
export async function request(method: 'GET' | 'POST', path: string, data?: unknown, query?: string): Promise<unknown> {
  if (!/^api\/[a-z-]+$/.test(path)) throw new Error('插件管理路径必须是已注册的相对路径')
  const reply = await getHost().request({
    method, path,
    ...(query ? { query } : {}),
    ...(data === undefined ? {} : { contentType: 'application/json', body: JSON.stringify(data) }),
  })
  if (reply.contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
    throw new Error('插件返回了不支持的内容类型')
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(reply.body)) }
  catch (cause) { throw new Error('插件返回了无效 JSON', { cause }) }
  if (reply.status < 200 || reply.status >= 300) {
    const message = isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string'
      ? value.error.message : `插件请求失败（HTTP ${reply.status}）`
    throw new Error(message)
  }
  return value
}
