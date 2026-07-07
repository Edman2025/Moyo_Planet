import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
    child.on('error', reject)
  })

const waitForHealth = async (baseUrl, serverOutput) => {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      const payload = await response.json()
      if (response.status === 200 && payload.ok && payload.uploadsReady) return payload
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw new Error(`production server did not become healthy:\n${serverOutput()}`)
}

const assetUrlsFromHtml = (html) => {
  const urls = new Set()
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = match[1]
    if (url.startsWith('/assets/') || url.startsWith('/favicon') || url.startsWith('/icons')) urls.add(url)
  }
  return [...urls]
}

const assertNoServerSmokeErrors = (output) => {
  const suspicious = /(?:Unhandled|uncaught|TypeError|ReferenceError|SyntaxError|EADDRINUSE|ECONNREFUSED|listen E|server config failed)/i
  if (suspicious.test(output)) {
    throw new Error(`production server emitted suspicious output during smoke:\n${output}`)
  }
}

const postJson = async (baseUrl, path, body, expectedStatus) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (response.status !== expectedStatus) {
    throw new Error(`production ${path} returned ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

const productionSmoke = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'moyo-release-'))
  let output = ''
  const port = '5193'
  const productionEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: port,
    DATA_DIR: dataDir,
  }
  await run(process.execPath, ['scripts/check-production.mjs'], { env: productionEnv })
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: productionEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  const exited = new Promise((resolve) => child.on('exit', resolve))

  try {
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, () => output)
    const head = await fetch(`${baseUrl}/api/health`, { method: 'HEAD' })
    if (head.status !== 200) throw new Error(`HEAD /api/health returned ${head.status}`)
    const index = await fetch(`${baseUrl}/`)
    const html = await index.text()
    if (index.status !== 200 || !html.includes('萌友星球')) {
      throw new Error(`production index did not render expected app shell: ${index.status}`)
    }
    const assetUrls = assetUrlsFromHtml(html)
    if (!assetUrls.some((url) => url.endsWith('.js')) || !assetUrls.some((url) => url.endsWith('.css'))) {
      throw new Error(`production index did not reference expected JS and CSS assets: ${assetUrls.join(', ')}`)
    }
    for (const assetUrl of assetUrls) {
      const asset = await fetch(`${baseUrl}${assetUrl}`)
      const contentType = asset.headers.get('content-type') ?? ''
      if (asset.status !== 200) throw new Error(`production asset ${assetUrl} returned ${asset.status}`)
      if (asset.headers.get('x-content-type-options') !== 'nosniff') {
        throw new Error(`production asset ${assetUrl} is missing X-Content-Type-Options`)
      }
      if (assetUrl.endsWith('.js') && !contentType.includes('javascript')) {
        throw new Error(`production JS asset ${assetUrl} returned unexpected content-type ${contentType}`)
      }
      if (assetUrl.endsWith('.css') && !contentType.includes('text/css')) {
        throw new Error(`production CSS asset ${assetUrl} returned unexpected content-type ${contentType}`)
      }
    }
    const registered = await postJson(baseUrl, '/api/register', {
      nickname: '生产烟测玩家',
      petName: '生产萌友',
      password: 'prod-smoke-123',
    }, 201)
    if (!registered.token || !/^MOYO-[A-Z0-9]{6}$/.test(registered.profile?.userCode ?? '')) {
      throw new Error(`production registration did not return a real session and invite code: ${JSON.stringify(registered)}`)
    }
    const session = await fetch(`${baseUrl}/api/session`, {
      headers: { Authorization: `Bearer ${registered.token}` },
    })
    const sessionPayload = await session.json()
    if (session.status !== 200 || sessionPayload.profile?.nickname !== '生产烟测玩家') {
      throw new Error(`production session did not restore registered user: ${session.status} ${JSON.stringify(sessionPayload)}`)
    }
    const dbFile = join(dataDir, 'moyo-db.json')
    if (!existsSync(dbFile)) throw new Error('production registration did not create moyo-db.json in DATA_DIR')
    const db = JSON.parse(readFileSync(dbFile, 'utf8'))
    const users = Object.values(db.users ?? {})
    const smokeUser = users.find((user) => user.profile?.userCode === registered.profile.userCode)
    if (!smokeUser || smokeUser.passwordAlgorithm !== 'pbkdf2-sha256' || smokeUser.passwordHash === 'prod-smoke-123') {
      throw new Error('production persisted user is missing or password storage is not hardened')
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    assertNoServerSmokeErrors(output)
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await exited
    rmSync(dataDir, { recursive: true, force: true })
  }
}

try {
  await run(npmCommand, ['run', 'audit:readiness'])
  await run(npmCommand, ['run', 'verify:clean-data'])
  await run(npmCommand, ['run', 'verify:install'])
  await run(npmCommand, ['run', 'verify:secrets'])
  await run(npmCommand, ['run', 'verify:dependencies'])
  await run(npmCommand, ['run', 'lint'])
  await run(npmCommand, ['run', 'build'])
  await run(npmCommand, ['run', 'verify'])
  await run(npmCommand, ['run', 'verify:journey'])
  await run(npmCommand, ['run', 'verify:ui'])
  await run(npmCommand, ['run', 'verify:docker-context'])
  await productionSmoke()
  await run(npmCommand, ['run', 'verify:clean-data'])
  await run(npmCommand, ['run', 'audit:readiness'])
  console.log('release check: ok')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
