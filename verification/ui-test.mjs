import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '../frontend/node_modules/playwright/index.mjs'
import { createServer, preview } from '../frontend/node_modules/vite/dist/node/index.js'

// A fresh local preview owns all state. No real host, credentials or card calls.
const artifacts = fileURLToPath(new URL('./ui-artifacts/', import.meta.url))
const server = await createServer({ root: fileURLToPath(new URL('../frontend', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
let browser, page, production
const passed = [], errors = [], externalRequests = []
const check = name => { passed.push(name); console.log(`PASS ${name}`) }
try {
  await mkdir(artifacts, { recursive: true })
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue()
    externalRequests.push(route.request().url())
    return route.abort()
  })
  await page.goto(origin)
  await page.getByText('共 40 条', { exact: true }).waitFor()
  await page.locator('button[aria-label="导出筛选账号"]:not([disabled])').waitFor()
  assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isEnabled(), true)
  await page.getByText('10 条/页', { exact: true }).waitFor()
  const headers = await page.getByRole('columnheader').allTextContents()
  assert.ok(headers.indexOf('周预估金额') === headers.indexOf('周限') + 1)
  assert.ok(headers.indexOf('周限刷新时间') === headers.indexOf('周预估金额') + 1)
  assert.equal(await page.locator('.forecast-cell').count(), 10)
  await page.locator('.forecast-value').first().waitFor()
  assert.match(await page.locator('.forecast-cell').first().textContent(), /≈\$/)
  assert.doesNotMatch(await page.locator('.forecast-cell').allTextContents().then(values => values.join(' ')), /Token|5小时|暂不支持/)
  check('Weekly monetary estimate sits between usage and reset time without five-hour or token output')
  await page.screenshot({ path: `${artifacts}/desktop.png`, fullPage: true })
  check('UI 0.8.0 retains Chinese pagination, default 10 rows and non-Free account count')

  const firstEmail = await page.locator('.account-name').first().textContent()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  assert.notEqual(await page.locator('.account-name').first().textContent(), firstEmail)
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  assert.equal(await page.locator('.account-name').first().textContent(), firstEmail)
  await page.getByRole('textbox', { name: '搜索账号', exact: true }).fill('sample12@example.com')
  await page.getByText('共 1 条', { exact: true }).waitFor()
  check('Pagination and account filtering still update the displayed rows')

  await page.evaluate(() => {
    const bridge = window.codexProxyPlugin, request = bridge.request.bind(bridge)
    window.testForecastUsd = 151.25
    bridge.request = async input => {
      const response = await request(input)
      if (input.path !== 'api/refresh') return response
      const body = JSON.parse(new TextDecoder().decode(response.body))
      body.forecast.forecasts[0].estimatedUsd = window.testForecastUsd
      body.forecast.forecasts[0].estimatedUsdDisplay = window.testForecastUsd === null ? '—' : `$${window.testForecastUsd.toFixed(2)}`
      body.forecast.forecasts[0].estimatedTokens = 2500000
      body.forecast.forecasts[0].estimatedTokensDisplay = '2.50M'
      return { ...response, body: new TextEncoder().encode(JSON.stringify(body)).buffer }
    }
  })
  await page.getByRole('button', { name: '更新 team+sample12@example.com+2026/10/28+workspace3+region-a', exact: true }).click()
  await page.getByText('≈$151.25', { exact: true }).waitFor()
  check('Refreshing an account updates its capacity estimate immediately')

  await page.getByRole('button', { name: '重置卡 team+sample12@example.com+2026/10/28+workspace3+region-a', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: '关闭', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('radio').count(), 2)
  await dialog.locator('.card-option').nth(1).click()
  assert.equal(await dialog.getByRole('radio').nth(1).isChecked(), true)
  assert.equal(await dialog.getByRole('radio').nth(0).isChecked(), false)
  assert.equal(await dialog.getByRole('button', { name: '使用所选卡', exact: true }).isDisabled(), true)
  await page.screenshot({ path: `${artifacts}/cards.png`, fullPage: true, animations: 'disabled' })
  await dialog.getByText('确认消费一张卡，消费无法撤回', { exact: true }).click()
  assert.equal(await dialog.getByRole('checkbox').isChecked(), true)
  assert.equal(await dialog.getByRole('button', { name: '使用所选卡', exact: true }).isEnabled(), true)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  check('Chinese dialog controls, card selection and explicit consumption confirmation remain intact')

  await page.getByRole('button', { name: '导出筛选账号', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.match(await page.getByRole('textbox', { name: '账号 CSV 数据' }).inputValue(), /sample12@example.com/)
  assert.match(await page.getByRole('textbox', { name: '账号 CSV 数据' }).inputValue(), /151\.25/)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  check('CSV export opens the shared dialog with the filtered account')

  await page.evaluate(() => { window.testForecastUsd = 0 })
  await page.getByRole('button', { name: '更新 team+sample12@example.com+2026/10/28+workspace3+region-a', exact: true }).click()
  await page.getByText('≈$0.00', { exact: true }).waitFor()
  await page.evaluate(() => { window.testForecastUsd = null })
  await page.getByRole('button', { name: '更新 team+sample12@example.com+2026/10/28+workspace3+region-a', exact: true }).click()
  await page.getByText('暂无预估', { exact: true }).waitFor()
  assert.doesNotMatch(await page.locator('.forecast-cell').textContent(), /Token|2\.50M/)
  assert.match(await page.locator('.forecast-cell').getAttribute('title'), /暂无金额预估/)
  check('Zero USD remains visible and token-only forecasts are not presented as monetary estimates')

  await page.getByRole('textbox', { name: '搜索账号', exact: true }).fill('sample42@example.com')
  await page.getByText('暂无预估', { exact: true }).waitFor()
  assert.match(await page.locator('.forecast-cell').getAttribute('title'), /不足 5 个百分点/)
  await page.getByRole('textbox', { name: '搜索账号', exact: true }).fill('sample43@example.com')
  await page.getByText('预估查询失败', { exact: true }).waitFor()
  assert.equal(await page.locator('.account-name').count(), 1)
  check('Insufficient samples and forecast query failures leave the account visible with an explicit reason')

  await page.goto(`${origin}?theme=dark`)
  await page.getByText('共 40 条', { exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await page.screenshot({ path: `${artifacts}/dark.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${artifacts}/narrow.png`, fullPage: true })
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(width.page <= width.viewport, 'Narrow page must not overflow outside the table scroller')
  check('Dark theme and 390px layout render without page-level horizontal overflow')

  // Exercise the new width-aware pager through the real app, using mock rows only.
  await page.evaluate(() => {
    const bridge = window.codexProxyPlugin, request = bridge.request.bind(bridge)
    bridge.request = async input => {
      const response = await request(input)
      if (input.path !== 'api/accounts') return response
      const body = JSON.parse(new TextDecoder().decode(response.body))
      const templates = body.accounts
      body.accounts = Array.from({ length: 10000 }, (_, index) => {
        const row = structuredClone(templates[index % templates.length])
        const id = `pager_${String(index).padStart(5, '0')}`
        row.account = { ...row.account, account_id: id, name: id, email: `${id}@example.com` }
        if (row.quota) row.quota.account_id = id
        if (row.forecast) row.forecast.accountId = id
        return row
      })
      body.nextCursor = null
      return { ...response, body: new TextEncoder().encode(JSON.stringify(body)).buffer }
    }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '读取最新快照', exact: true }).click()
  await page.getByText('共 10000 条', { exact: true }).waitFor()
  const pager = page.getByRole('navigation', { name: '分页', exact: true })
  await pager.getByRole('button', { name: '1000', exact: true }).click()
  await page.getByText('pager_09990@example.com', { exact: true }).waitFor()
  assert.equal(await page.locator('.account-name').count(), 10)
  const activePage = pager.locator('[aria-current="page"]:visible')
  assert.equal(await activePage.textContent(), '1000')
  assert.ok(await activePage.evaluate(button => button.scrollWidth <= button.clientWidth), 'Four-digit page must not be clipped')
  await page.screenshot({ path: `${artifacts}/pagination-desktop.png`, fullPage: true })
  check('Four-digit page numbers fit and navigate to the correct account slice')

  await page.setViewportSize({ width: 390, height: 844 })
  // At 390px the selector can still fit. A tighter embedded container must
  // remove it rather than hiding the current page or either navigation button.
  await page.locator('footer').evaluate(element => { element.style.width = '220px' })
  await page.getByRole('combobox', { name: '每页条数', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await activePage.textContent(), '1000')
  await pager.getByRole('button', { name: '上一页', exact: true }).click()
  await page.getByText('pager_09980@example.com', { exact: true }).waitFor()
  await pager.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByText('pager_09990@example.com', { exact: true }).waitFor()
  const pagerWidth = await pager.evaluate(element => {
    const { left, right } = element.getBoundingClientRect()
    return { left, right, viewport: innerWidth }
  })
  assert.ok(pagerWidth.left >= 0 && pagerWidth.right <= pagerWidth.viewport, 'Narrow pager controls must remain on-screen')
  await page.screenshot({ path: `${artifacts}/pagination-narrow.png`, fullPage: true })
  await page.locator('footer').evaluate(element => { element.style.width = '' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('combobox', { name: '每页条数', exact: true }).waitFor()
  check('A 220px pager container hides page-size selection, retains navigation and restores it on resize')

  // Exercise the built page without the development-only theme initializer.
  production = await preview({ root: fileURLToPath(new URL('../frontend', import.meta.url)), preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  const productionOrigin = production.resolvedUrls.local[0]
  const hostPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page = hostPage
  hostPage.on('pageerror', error => errors.push(error.message))
  await hostPage.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(productionOrigin).origin) return route.continue()
    externalRequests.push(route.request().url())
    return route.abort()
  })
  await hostPage.addInitScript(() => {
    let scheme = 'light'
    window.codexProxyPlugin = {
      version: 2, get theme() { return scheme },
      async request(input) {
        if (input.method !== 'GET') throw new Error('Theme checks must remain read-only')
        const body = input.path === 'api/settings'
          ? { value: { automatic: false, checkIntervalSeconds: 30, cardsRefreshSeconds: 3600, batchSize: 20 }, version: null }
          : { accounts: [], excludedPending: [], nextCursor: null, generatedAtMs: Date.now() }
        return { status: 200, contentType: 'application/json', body: new TextEncoder().encode(JSON.stringify(body)).buffer }
      },
    }
    window.testHostTheme = (legacy, theme) => {
      scheme = theme.scheme
      const root = document.documentElement
      const prefix = document.querySelector('meta[name="codex-proxy-ui-theme-prefix"]')?.content ?? 'z'
      // v3.33–v3.36 use --cp-* wire names; v3.37 uses semantic names and page metadata.
      for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(legacy ? `--cp-${name}` : `--${prefix}-${name}`, value)
      root.dataset.theme = scheme
      window.dispatchEvent(new CustomEvent('codex-proxy-themechange', { detail: { theme: scheme } }))
    }
  })
  const { createTheme } = await server.ssrLoadModule('@codex-proxy/ui/theme')
  for (const legacy of [true, false]) {
    await hostPage.goto(productionOrigin)
    await hostPage.getByText('暂无账号', { exact: true }).waitFor()
    assert.equal(await hostPage.locator('meta[name="codex-proxy-ui-theme-prefix"]').getAttribute('content'), 'cp')
    assert.equal(await hostPage.locator('.preview, [data-z-runtime-theme]').count(), 0)
    for (const scheme of ['light', 'dark']) {
      const theme = createTheme({ scheme })
      theme.tokens['color-bg-container'] = scheme === 'dark' ? 'rgb(29, 36, 44)' : 'rgb(247, 248, 249)'
      theme.tokens['card-bg'] = theme.tokens['color-bg-container']
      theme.tokens['color-text'] = scheme === 'dark' ? 'rgb(230, 231, 232)' : 'rgb(35, 36, 37)'
      await hostPage.evaluate(({ legacy, theme }) => window.testHostTheme(legacy, theme), { legacy, theme })
      assert.equal(await hostPage.locator('html').getAttribute('data-theme'), scheme)
      assert.equal(await hostPage.locator('.quota-manager').evaluate(element => getComputedStyle(element).color), theme.tokens['color-text'])
      for (const selector of ['.work-area', '.metric']) assert.equal(await hostPage.locator(selector).first().evaluate(element => getComputedStyle(element).backgroundColor), theme.tokens['color-bg-container'])
    }
    check(`Production UI follows ${legacy ? 'v3.33–v3.36 prefixed' : 'v3.37 semantic'} host tokens and theme changes without local theme defaults`)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(externalRequests, [])
  console.log(JSON.stringify({ passed: passed.length, tests: passed, productionRequests: 0, artifacts }, null, 2))
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true })
    console.error(await page.locator('body').ariaSnapshot())
  }
  throw error
} finally {
  await browser?.close()
  await production?.close()
  await server.close()
}
