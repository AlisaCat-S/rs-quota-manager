import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '../frontend/node_modules/playwright/index.mjs'
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'

// A fresh local preview owns all state. No real host, credentials or card calls.
const artifacts = fileURLToPath(new URL('./ui-artifacts/', import.meta.url))
const server = await createServer({ root: fileURLToPath(new URL('../frontend', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
let browser, page
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
  await page.screenshot({ path: `${artifacts}/desktop.png`, fullPage: true })
  check('UI 0.6 retains Chinese pagination, default 10 rows and non-Free account count')

  const firstEmail = await page.locator('.account-name').first().textContent()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  assert.notEqual(await page.locator('.account-name').first().textContent(), firstEmail)
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  assert.equal(await page.locator('.account-name').first().textContent(), firstEmail)
  await page.getByRole('textbox', { name: '搜索账号', exact: true }).fill('sample12@example.com')
  await page.getByText('共 1 条', { exact: true }).waitFor()
  check('Pagination and account filtering still update the displayed rows')

  await page.getByRole('button', { name: '重置卡 team+sample12@example.com+2026/10/28+workspace3+region-a', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: '关闭', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('radio').count(), 2)
  await dialog.locator('.card-option').nth(1).click()
  assert.equal(await dialog.getByRole('radio').nth(1).isChecked(), true)
  assert.equal(await dialog.getByRole('radio').nth(0).isChecked(), false)
  assert.equal(await dialog.getByRole('button', { name: '使用所选卡', exact: true }).isDisabled(), true)
  await page.screenshot({ path: `${artifacts}/cards.png`, fullPage: true })
  await dialog.getByText('确认消费一张卡，消费无法撤回', { exact: true }).click()
  assert.equal(await dialog.getByRole('checkbox').isChecked(), true)
  assert.equal(await dialog.getByRole('button', { name: '使用所选卡', exact: true }).isEnabled(), true)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  check('Chinese dialog controls, card selection and explicit consumption confirmation remain intact')

  await page.getByRole('button', { name: '导出筛选账号', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.match(await page.getByRole('textbox', { name: '账号 CSV 数据' }).inputValue(), /sample12@example.com/)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  check('CSV export opens the shared dialog with the filtered account')

  await page.goto(`${origin}?theme=dark`)
  await page.getByText('共 40 条', { exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await page.screenshot({ path: `${artifacts}/dark.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${artifacts}/narrow.png`, fullPage: true })
  const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(width.page <= width.viewport, 'Narrow page must not overflow outside the table scroller')
  check('Dark theme and 390px layout render without page-level horizontal overflow')

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
  await server.close()
}
