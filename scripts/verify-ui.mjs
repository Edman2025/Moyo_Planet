import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const port = 5196
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'moyo-ui-'))
let output = ''

if (!existsSync('dist/index.html')) {
  rmSync(dataDir, { recursive: true, force: true })
  throw new Error('dist/index.html is missing; run npm run build before npm run verify:ui')
}

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

server.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  output += chunk.toString()
})

const cleanup = async (browser) => {
  if (browser) await browser.close().catch(() => {})
  if (server.exitCode === null) server.kill('SIGTERM')
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve()
    else server.once('exit', resolve)
  })
  rmSync(dataDir, { recursive: true, force: true })
}

process.on('exit', () => {
  server.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
})

const waitForServer = async () => {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      const payload = await response.json()
      if (response.status === 200 && payload.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw new Error(`ui verification server did not start:\n${output}`)
}

const launchBrowser = async () => {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  if (executablePath) return chromium.launch({ headless: true, executablePath })
  const channel = process.env.PLAYWRIGHT_CHANNEL || 'chrome'
  try {
    return await chromium.launch({ headless: true, channel })
  } catch (error) {
    throw new Error(
      `ui verification requires a local Chrome-compatible browser. Set PLAYWRIGHT_CHANNEL or PLAYWRIGHT_EXECUTABLE_PATH. ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

const waitForText = (page, expected) =>
  page.waitForFunction((text) => document.body.innerText.includes(text), expected, { timeout: 10_000 })

const request = async (path, body, expectedStatus = 201) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (response.status !== expectedStatus) {
    throw new Error(`${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

const clickNav = async (page, name, expectedText) => {
  const labeled = page.locator(`button[aria-label="${name}"]`)
  if (await labeled.count()) {
    await labeled.evaluate((button) => button.click())
  } else {
    await page.locator('button').filter({ hasText: new RegExp(`^${name}$`) }).last().click({ force: true })
  }
  if (expectedText) {
    try {
      await waitForText(page, expectedText)
    } catch {
      const body = await page.locator('body').innerText()
      throw new Error(`ui did not navigate to ${name}. Body:\n${body}`)
    }
  }
}

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
)

let browser

try {
  await waitForServer()
  const friend = await request('/api/register', {
    nickname: '界面好友',
    petName: '好友萌友',
    password: 'uiabcd',
  })
  browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const authText = await page.locator('body').innerText()
  if (!authText.includes('创建玩家资料') || !authText.includes('创建并进入')) {
    throw new Error('ui did not render the real registration screen')
  }

  await page.locator('input').nth(0).fill('界面验收玩家')
  await page.locator('input').nth(1).fill('界面萌友')
  await page.locator('input').nth(2).fill('uiabcd')
  await page.locator('button').filter({ hasText: '创建并进入' }).click()
  await waitForText(page, '去工作赚钱')
  const registeredHomeText = await page.locator('body').innerText()
  const userCodeMatch = /MOYO-[A-Z0-9]{6}/.exec(registeredHomeText)
  if (!userCodeMatch) throw new Error('ui registration did not expose a player invite/login code')
  const playerUserCode = userCodeMatch[0]

  await page.locator('button').filter({ hasText: /^生成$/ }).click({ force: true })
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 10_000 })
  await page.locator('input[type=file]').setInputFiles({ name: 'ui-upload.png', mimeType: 'image/png', buffer: pngBytes })
  await waitForText(page, '已上传并保存')
  const uploadText = await page.locator('body').innerText()
  if (!uploadText.includes('ui-upload.png') || !uploadText.includes('用上传照片生成')) {
    throw new Error('ui upload did not show a persistent success state and next action')
  }

  await page.locator('button').filter({ hasText: '用上传照片生成' }).click({ force: true })
  await waitForText(page, '去工作赚钱')
  const generatedText = await page.locator('body').innerText()
  if (!generatedText.includes('动态伙伴') || !generatedText.includes('去工作赚钱')) {
    throw new Error('ui photo generation did not return to the home pet with generated photo-pet state')
  }
  const generatedPetVisible = await page.locator('.generated-pet-image').evaluate((image) => {
    const img = image
    return img instanceof HTMLImageElement &&
      img.complete &&
      img.naturalWidth > 0 &&
      (img.src.includes('/generated-pets/') || img.src.includes('/generated-pet-animations/'))
  })
  if (!generatedPetVisible) throw new Error('ui did not render a real generated pet image')
  await page.getByRole('button', { name: '喂食' }).click({ force: true })
  await waitForText(page, '喂食进行中')
  const timedCareText = await page.locator('body').innerText()
  if (!timedCareText.includes('完成前不会结算状态')) {
    throw new Error('ui care action did not show a timed in-progress state')
  }

  await clickNav(page, '商店')
  await waitForText(page, '矿泉水')
  const waterCard = page.locator('.shop-card').filter({ hasText: '矿泉水' })
  await waterCard.getByRole('button', { name: '购买' }).click({ force: true })
  await waitForText(page, '已购买 矿泉水')
  await waterCard.getByRole('button', { name: '使用' }).click({ force: true })
  await waitForText(page, '矿泉水已使用')

  await clickNav(page, '任务', '购买任意商品')
  const shopTask = page.locator('.task-row').filter({ hasText: '购买任意商品' })
  await shopTask.getByRole('button', { name: '领取' }).click({ force: true })
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.task-row')).some((row) => row.textContent?.includes('购买任意商品') && row.textContent.includes('已领')),
    null,
    { timeout: 10_000 },
  )

  await clickNav(page, '城市')
  await waitForText(page, '公共城市频道')
  await page.getByPlaceholder('和附近玩家打个招呼').fill('界面验证开工')
  await page.getByLabel('发送消息').click({ force: true })
  await waitForText(page, '界面验证开工')
  await page.getByLabel('进入学校').click({ force: true })
  await waitForText(page, '学校')

  await clickNav(page, '社交')
  await waitForText(page, '添加好友')
  await page.getByPlaceholder('输入好友邀请码').fill(friend.profile.userCode.toLowerCase())
  await page.getByRole('button', { name: '添加' }).click({ force: true })
  await waitForText(page, friend.profile.userCode)
  await page.locator('.crop-list button').filter({ hasText: '界面好友' }).click({ force: true })
  await waitForText(page, '收获')
  await page.locator('.friend-actions button').filter({ hasText: '赠礼' }).first().click({ force: true })
  await waitForText(page, '已送给')
  await page.locator('.slot-list button').filter({ hasText: '好友车位 A1' }).click({ force: true })
  await waitForText(page, '我的车位')

  await clickNav(page, '工作')
  await waitForText(page, '学历与技能')
  const workBefore = await page.locator('body').innerText()
  if (
    !workBefore.includes('年级 1/16') ||
    !workBefore.includes('已解锁岗位') ||
    !workBefore.includes('1/6') ||
    !workBefore.includes('下一个高薪岗位')
  ) {
    throw new Error('ui work page did not show initial education and high-paying-job gates')
  }

  await page.getByRole('button', { name: /文化课升级/ }).click({ force: true })
  await page.waitForFunction(
    () => document.body.innerText.includes('年级 2/16') && document.body.innerText.includes('2/6'),
    null,
    { timeout: 10_000 },
  )
  const workAfter = await page.locator('body').innerText()
  if (!workAfter.includes('外卖跑腿') || !workAfter.includes('开始')) {
    throw new Error('ui education progression did not unlock the next real job')
  }

  await page.locator('.work-card').filter({ hasText: '外卖跑腿' }).getByRole('button', { name: '开始' }).click({ force: true })
  await waitForText(page, '外卖跑腿进行中')

  await page.getByLabel('退出登录').click({ force: true })
  await waitForText(page, '创建玩家资料')
  await page.getByRole('button', { name: '登录' }).click({ force: true })
  await waitForText(page, '登录玩家账号')
  await page.getByPlaceholder('例如 MOYO-1A2B3C').fill(playerUserCode.toLowerCase())
  await page.locator('input[type=password]').fill('uiabcd')
  await page.getByRole('button', { name: '登录并进入' }).click({ force: true })
  await waitForText(page, playerUserCode)
  const reloginText = await page.locator('body').innerText()
  if (!reloginText.includes('界面验收玩家') || !reloginText.includes('外卖跑腿')) {
    throw new Error('ui login did not restore the real player session and saved progress')
  }

  page.once('dialog', async (dialog) => {
    if (!dialog.message().includes('确认重置游戏进度')) throw new Error(`unexpected reset dialog: ${dialog.message()}`)
    await dialog.dismiss()
  })
  await page.getByLabel('重新开始').click({ force: true })
  await waitForText(page, '已取消重置')
  const afterCancelledResetText = await page.locator('body').innerText()
  if (!afterCancelledResetText.includes('外卖跑腿')) {
    throw new Error('ui reset cancellation should preserve current progress')
  }

  page.once('dialog', async (dialog) => {
    if (!dialog.message().includes('确认重置游戏进度')) throw new Error(`unexpected reset dialog: ${dialog.message()}`)
    await dialog.accept()
  })
  await page.getByLabel('重新开始').click({ force: true })
  await waitForText(page, '进度已重置')
  await waitForText(page, '去工作赚钱')
  const resetText = await page.locator('body').innerText()
  if (
    !resetText.includes('潮玩 · 默认形象') ||
    resetText.includes('动态伙伴') ||
    resetText.includes('外卖跑腿进行中') ||
    resetText.includes('我的车位')
  ) {
    throw new Error('ui reset did not return the player to a clean playable home state')
  }

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (horizontalOverflow) throw new Error('mobile UI has horizontal overflow')
  if (consoleErrors.length) throw new Error(`ui emitted console errors: ${consoleErrors.join('; ')}`)

  console.log('ui verify: ok')
} finally {
  await cleanup(browser)
}
