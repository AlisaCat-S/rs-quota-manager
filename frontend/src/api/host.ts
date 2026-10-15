import type { Bridge } from '../types'

export function getHost(): Bridge {
  const host = window.codexProxyPlugin
  if (!host || host.version !== 2) throw new Error('宿主桥不可用，请从网关插件页面打开')
  return host
}
