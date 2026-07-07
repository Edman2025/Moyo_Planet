import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 5187
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'moyo-verify-'))
const productionDataDir = mkdtempSync(join(tmpdir(), 'moyo-prod-check-'))

let serverOutput = ''
let server
let serverEnvOverrides = {}

const startServer = (envOverrides = {}) => {
  serverOutput = ''
  serverEnvOverrides = envOverrides
  server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })
  server.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })
}

startServer()

const stopServer = async () => {
  if (!server || server.killed) return
  server.kill('SIGTERM')
  await new Promise((resolve) => server.on('exit', resolve))
}

const mutateOnlyUserState = (updater) => {
  const dbPath = join(dataDir, 'moyo-db.json')
  const db = JSON.parse(readFileSync(dbPath, 'utf8'))
  const user = Object.values(db.users)[0]
  if (!user) throw new Error('expected a verification user before mutating isolated db')
  user.state = updater(user.state)
  user.updatedAt = new Date().toISOString()
  writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

const mutateDb = (updater) => {
  const dbPath = join(dataDir, 'moyo-db.json')
  const db = JSON.parse(readFileSync(dbPath, 'utf8'))
  updater(db)
  writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

const cleanup = () => {
  server?.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(productionDataDir, { recursive: true, force: true })
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

const waitForServer = async () => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/session`)
      if (response.status === 401) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`API did not start. Output:\n${serverOutput}`)
}

const restartServer = async (envOverrides = serverEnvOverrides) => {
  await stopServer()
  startServer(envOverrides)
  await waitForServer()
}

const request = async (path, options = {}, expectedStatus = 200) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const payload = await response.json()
  if (response.status !== expectedStatus) {
    throw new Error(`${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

const rawRequest = async (path, options = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
  })

const rawHttpStatus = (path) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end()
  })

const pngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

try {
  const appSource = readFileSync('src/App.tsx', 'utf8')
  if (/正式版|继续接入|TODO|占位|mock|fake|可发布|可发起|加成场景/.test(appSource)) {
    throw new Error('frontend still contains placeholder or future-version copy')
  }

  const missingDataDirCheck = spawn(process.execPath, ['scripts/check-production.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const missingExitCode = await new Promise((resolve) => missingDataDirCheck.on('exit', resolve))
  if (missingExitCode === 0) throw new Error('production check should fail without DATA_DIR')
  const badEnvCheck = spawn(process.execPath, ['scripts/check-production.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATA_DIR: productionDataDir,
      RATE_LIMIT_MAX: 'not-a-number',
      TRUST_PROXY: 'sometimes',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const badEnvExitCode = await new Promise((resolve) => badEnvCheck.on('exit', resolve))
  if (badEnvExitCode === 0) throw new Error('production check should fail with invalid env numbers or flags')

  const badServerConfig = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      DATA_DIR: productionDataDir,
      HOST: '127.0.0.1',
      PORT: 'not-a-port',
      RATE_LIMIT_MAX: '0',
      TRUST_PROXY: 'sometimes',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const badServerExitCode = await new Promise((resolve) => badServerConfig.on('exit', resolve))
  if (badServerExitCode === 0) throw new Error('server should fail fast on invalid direct startup env')

  const productionCheck = spawn(process.execPath, ['scripts/check-production.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: productionDataDir, PORT: '4173' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const productionExitCode = await new Promise((resolve) => productionCheck.on('exit', resolve))
  if (productionExitCode !== 0) throw new Error('production check should pass with writable DATA_DIR')

  await waitForServer()

  await restartServer({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000', TRUST_PROXY: '' })
  const spoofedForwardedAttempt = async () => fetch(`${baseUrl}/api/health`, {
    headers: { 'X-Forwarded-For': `203.0.113.${randomBytes(1)[0]}` },
  })
  await spoofedForwardedAttempt()
  await spoofedForwardedAttempt()
  const rateLimitedAttempt = await spoofedForwardedAttempt()
  if (rateLimitedAttempt.status !== 429) {
    throw new Error('rate limiter trusted spoofed x-forwarded-for without TRUST_PROXY')
  }
  await restartServer({})

  const healthResponse = await rawRequest('/api/health')
  const health = await healthResponse.json()
  if (
    !health.ok ||
    Object.hasOwn(health, 'users') ||
    healthResponse.headers.get('x-content-type-options') !== 'nosniff' ||
    !healthResponse.headers.get('content-security-policy')?.includes("default-src 'self'") ||
    !healthResponse.headers.get('permissions-policy')?.includes('camera=()')
  ) {
    throw new Error(`health check failed: ${JSON.stringify(health)}`)
  }
  const healthHeadResponse = await rawRequest('/api/health', { method: 'HEAD' })
  if (
    healthHeadResponse.status !== 200 ||
    healthHeadResponse.headers.get('content-type') !== 'application/json; charset=utf-8' ||
    healthHeadResponse.headers.get('cache-control') !== 'no-store' ||
    (await healthHeadResponse.text()) !== ''
  ) {
    throw new Error('health HEAD check failed')
  }
  const healthPostResponse = await rawRequest('/api/health', { method: 'POST', body: JSON.stringify({}) })
  if (healthPostResponse.status !== 405 || healthPostResponse.headers.get('allow') !== 'GET, HEAD') {
    throw new Error('health API should advertise GET, HEAD when called with unsupported method')
  }
  if (!readFileSync('index.html', 'utf8').includes('<html lang="zh-CN">')) {
    throw new Error('index.html should declare zh-CN language')
  }

  const traversalResponse = await rawRequest('/%2e%2e/server/index.mjs')
  if (traversalResponse.status !== 404) throw new Error('static file server allowed path traversal')
  if ((await rawHttpStatus('/uploads/..')) !== 404 || (await rawHttpStatus('/uploads/%2e%2e')) !== 404) {
    throw new Error('upload file server should reject directory-like paths')
  }
  const uploadGuessResponse = await rawRequest('/uploads/not-a-real-file.png')
  if (uploadGuessResponse.status !== 404) throw new Error('upload file server should reject non-random file names')
  const generatedGuessResponse = await rawRequest('/generated-pets/not-a-real-file.svg')
  if (generatedGuessResponse.status !== 404) throw new Error('generated pet file server should reject non-random file names')
  const staticPostResponse = await rawRequest('/', { method: 'POST', body: JSON.stringify({ unexpected: true }) })
  if (staticPostResponse.status !== 405 || staticPostResponse.headers.get('allow') !== 'GET, HEAD') {
    throw new Error('static file server should reject non-GET/HEAD methods')
  }
  const registerGetResponse = await rawRequest('/api/register')
  if (registerGetResponse.status !== 405 || registerGetResponse.headers.get('allow') !== 'POST') {
    throw new Error('known API route should reject unsupported methods with Allow header')
  }
  const loginGetResponse = await rawRequest('/api/login')
  if (loginGetResponse.status !== 405 || loginGetResponse.headers.get('allow') !== 'POST') {
    throw new Error('login API should advertise POST when called with unsupported method')
  }
  const sessionPostResponse = await rawRequest('/api/session', { method: 'POST', body: JSON.stringify({}) })
  if (sessionPostResponse.status !== 405 || sessionPostResponse.headers.get('allow') !== 'GET') {
    throw new Error('session API should advertise GET when called with unsupported method')
  }
  const logoutGetResponse = await rawRequest('/api/logout')
  if (logoutGetResponse.status !== 405 || logoutGetResponse.headers.get('allow') !== 'POST') {
    throw new Error('logout API should advertise POST when called with unsupported method')
  }
  const actionGetResponse = await rawRequest('/api/action')
  if (actionGetResponse.status !== 405 || actionGetResponse.headers.get('allow') !== 'POST') {
    throw new Error('action API should advertise POST when called with unsupported method')
  }
  const statePostResponse = await rawRequest('/api/state', { method: 'POST', body: JSON.stringify({}) })
  if (statePostResponse.status !== 405 || statePostResponse.headers.get('allow') !== 'PUT') {
    throw new Error('state API should advertise PUT when called with unsupported method')
  }
  const uploadGetResponse = await rawRequest('/api/upload')
  if (uploadGetResponse.status !== 405 || uploadGetResponse.headers.get('allow') !== 'POST') {
    throw new Error('upload API should advertise POST when called with unsupported method')
  }
  const unknownApiResponse = await rawRequest('/api/not-real')
  if (unknownApiResponse.status !== 404) throw new Error('unknown API routes should remain 404')

  await request('/api/register', {
    method: 'POST',
    body: '{bad json',
  }, 400)
  await request('/api/register', {
    method: 'POST',
    body: 'null',
  }, 400)
  await request('/api/register', {
    method: 'POST',
    body: JSON.stringify([]),
  }, 400)

  await request('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ nickname: '文本请求', petName: '空', password: '123456' }),
  }, 415)
  await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ userCode: 'MOYO-NOPE', password: '123456' }),
  }, 415)

  await request('/api/session', {}, 401)
  await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '', petName: '空', password: '123456' }),
  }, 400)
  await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '联系我13800138000', petName: '空', password: '123456' }),
  }, 400)
  await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '公开名验收', petName: 'www.example.com', password: '123456' }),
  }, 400)
  await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '超长密码', petName: '空', password: 'x'.repeat(129) }),
  }, 400)

  const registration = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '验收\n玩家', petName: '验收\t萌友', password: 'verify123' }),
  }, 201)

  if (!registration.token || !registration.profile.userCode.startsWith('MOYO-')) throw new Error('registration payload missing token or userCode')
  if (registration.profile.nickname !== '验收 玩家' || registration.state.petName !== '验收 萌友') {
    throw new Error('registration text fields should be normalized before persistence')
  }
  if (
    registration.state.friends.length ||
    registration.state.chat.length ||
    Object.values(registration.state.parkingSlots ?? {}).some((slot) => slot.occupied)
  ) {
    throw new Error('new users should not receive seeded friends, chat, or occupied parking data')
  }

  const friendRegistration = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '验收好友', petName: '好友萌友', password: 'verify123' }),
  }, 201)
  if (!friendRegistration.profile.userCode.startsWith('MOYO-')) throw new Error('friend registration did not create a user code')

  await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ userCode: registration.profile.userCode, password: 'wrong-password' }),
  }, 401)
  await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ userCode: registration.profile.userCode, password: 'x'.repeat(129) }),
  }, 400)

  const login = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ userCode: registration.profile.userCode, password: 'verify123' }),
  })
  if (login.profile.userCode !== registration.profile.userCode) throw new Error('login restored wrong user')

  const copiedCodeLogin = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ userCode: `  ${registration.profile.userCode.toLowerCase()}  `, password: 'verify123' }),
  })
  if (copiedCodeLogin.profile.userCode !== registration.profile.userCode) {
    throw new Error('login should accept copied user codes with harmless whitespace and lowercase letters')
  }

  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'care', payload: null }),
  }, 400)
  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'care', payload: [] }),
  }, 400)
  await request('/api/upload', {
    method: 'POST',
    token: login.token,
    body: 'null',
  }, 400)
  await request('/api/upload', {
    method: 'POST',
    token: login.token,
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ fileName: 'bad.png', contentType: 'image/png', dataUrl: pngDataUrl }),
  }, 415)

  let registeredUserId = ''
  mutateOnlyUserState((state) => {
    registeredUserId = state.profile.userCode
    return state
  })
  const authDbAfterRegister = JSON.parse(readFileSync(join(dataDir, 'moyo-db.json'), 'utf8'))
  const registeredUser = Object.values(authDbAfterRegister.users).find((user) => user.profile.userCode === registeredUserId)
  if (registeredUser?.passwordAlgorithm !== 'pbkdf2-sha256' || registeredUser.passwordIterations < 100_000) {
    throw new Error('registered users should store PBKDF2 password hashes')
  }

  const generated = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'generatePet', payload: {} }),
  })
  if (!generated.state.generated || generated.state.gems !== 70 || !generated.state.generatedPetUrl) {
    throw new Error('server generate action did not persist generated pet creation')
  }
  const firstGeneratedPetAsset = await rawRequest(generated.state.generatedPetUrl)
  if (firstGeneratedPetAsset.status !== 200 || !firstGeneratedPetAsset.headers.get('content-type')?.includes('image/svg+xml')) {
    throw new Error('generated pet image was not served as SVG')
  }
  const firstGeneratedSvg = await firstGeneratedPetAsset.text()
  if (!firstGeneratedSvg.includes('@keyframes bob') || !firstGeneratedSvg.includes('shape-rendering="crispEdges"')) {
    throw new Error('generated pet image should be an animated pixel-adjacent companion SVG')
  }

  const tampered = await request('/api/state', {
    method: 'PUT',
    token: login.token,
    body: JSON.stringify({
      state: {
        ...generated.state,
        petStyle: '未来',
        coins: 9_999_999,
        gems: 9_999,
        generatedPetUrl: '/generated-pets/ffffffffffffffffffffffffffffffff.svg',
        states: { ...generated.state.states, hunger: 100 },
        education: { ...generated.state.education, grade: 16, skills: { programming: 100, business: 100, communication: 100 } },
        completedTasks: ['feed', 'work', 'shop', 'city', 'social'],
        runningJob: { jobId: 'coffee', endsAt: Date.now() - 1000 },
      },
    }),
  })
  if (
    tampered.state.petStyle !== '未来' ||
    tampered.state.coins !== generated.state.coins ||
    tampered.state.gems !== generated.state.gems ||
    tampered.state.states.hunger !== generated.state.states.hunger ||
    tampered.state.education.grade !== generated.state.education.grade ||
    tampered.state.completedTasks.length !== 0 ||
    tampered.state.runningJob
  ) {
    throw new Error('client state update was allowed to modify server-authoritative fields')
  }
  await request('/api/state', {
    method: 'PUT',
    token: login.token,
    body: JSON.stringify({ state: { ...tampered.state, petName: '加我微信13800138000' } }),
  }, 400)

  const cared = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'care', payload: { kind: 'feed' } }),
  })
  if (!cared.state.runningCare || cared.state.runningCare.kind !== 'feed' || cared.state.states.hunger !== 68 || cared.state.completedTasks.includes('feed')) {
    throw new Error('server care action should start a timed activity without immediate state/task settlement')
  }
  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'completeCare', payload: {} }),
  }, 400)
  mutateOnlyUserState((state) => ({ ...state, runningCare: { ...state.runningCare, endsAt: Date.now() - 1000 } }))
  await restartServer()
  const completedCare = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'completeCare', payload: {} }),
  })
  if (completedCare.state.runningCare || completedCare.state.states.hunger !== 86 || !completedCare.state.completedTasks.includes('feed')) {
    throw new Error('server timed care completion did not update hunger/task')
  }

  const bought = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'buyItem', payload: { itemId: 'water' } }),
  })
  if (bought.state.coins !== 1260 || bought.state.inventory.water < 3) throw new Error('server buy action did not update inventory')

  const used = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'useItem', payload: { itemId: 'water' } }),
  })
  if (used.state.states.thirst !== 97 || used.state.inventory.water !== bought.state.inventory.water - 1) {
    throw new Error('server use action did not apply item effect')
  }

  const studied = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'studyCourse', payload: { courseId: 'school-grade' } }),
  })
  if (studied.state.education.grade !== 2 || studied.state.coins !== 1180) throw new Error('server study action did not update education')

  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'studyCourse', payload: { courseId: 'programming' } }),
  }, 400)

  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'addFriend', payload: { name: '不存在的好友' } }),
  }, 404)

  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'addFriend', payload: { name: registration.profile.userCode } }),
  }, 400)

  const friended = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'addFriend', payload: { name: friendRegistration.profile.userCode } }),
  })
  const friend = friended.state.friends.find((entry) => entry.userCode === friendRegistration.profile.userCode)
  if (!friend || friend.name !== '验收好友' || !friend.id || !friend.crop.name.includes('好友萌友')) {
    throw new Error('server addFriend action did not add a real registered friend')
  }

  const stolen = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'stealCrop', payload: { friendId: friend.id } }),
  })
  if (stolen.state.coins !== friended.state.coins + friend.crop.reward || stolen.state.stolenCrops.length !== 1) {
    throw new Error('server stealCrop action did not grant reward')
  }

  const gifted = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'sendGift', payload: { name: friend.name } }),
  })
  if (gifted.state.coins !== stolen.state.coins - 50 || !gifted.state.giftsSent.includes(friend.name)) {
    throw new Error('server sendGift action did not update social state')
  }

  const parked = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'parkCar', payload: { slotId: 'a1' } }),
  })
  if (parked.state.parkedSlot !== 'a1' || !parked.state.parkingSlots.a1.occupiedByMe || !parked.state.completedTasks.includes('social')) {
    throw new Error('server parkCar action did not persist parking slot')
  }

  const friendParkingView = await request('/api/session', {
    method: 'GET',
    token: friendRegistration.token,
  })
  if (!friendParkingView.state.parkingSlots.a1.occupied || friendParkingView.state.parkingSlots.a1.occupiedByMe) {
    throw new Error('shared parking slot was not visible as occupied to another user')
  }

  await stopServer()
  const expiredToken = 'expired-session-token'
  mutateDb((db) => {
    db.sessions[expiredToken] = {
      userId: Object.keys(db.users)[0],
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    }
    db.sessions['missing-user-session'] = {
      userId: 'missing-user-id',
      createdAt: new Date().toISOString(),
    }
    db.parkingSlots.b2 = { userId: 'missing-user-id', parkedAt: Date.now() - 60_000 }
  })
  startServer()
  await waitForServer()
  await request('/api/session', {
    method: 'GET',
    token: expiredToken,
  }, 401)
  const cleanedLifecycleView = await request('/api/session', {
    method: 'GET',
    token: friendRegistration.token,
  })
  if (cleanedLifecycleView.state.parkingSlots.b2.occupied) {
    throw new Error('orphan parking slot should be pruned before public state is returned')
  }

  await request('/api/action', {
    method: 'POST',
    token: friendRegistration.token,
    body: JSON.stringify({ action: 'parkCar', payload: { slotId: 'a1' } }),
  }, 400)

  await stopServer()
  let parkedAtBeforeClaim = 0
  let coinsBeforeParkingClaim = 0
  mutateOnlyUserState((state) => {
    parkedAtBeforeClaim = Date.now() - 20_000
    coinsBeforeParkingClaim = state.coins
    return { ...state, parkedAt: parkedAtBeforeClaim }
  })
  startServer()
  await waitForServer()
  const parkingClaim = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'claimParking', payload: {} }),
  })
  if (parkingClaim.state.coins !== coinsBeforeParkingClaim + 20 || parkingClaim.state.parkedAt <= parkedAtBeforeClaim) {
    throw new Error('server claimParking action did not calculate parking reward')
  }

  const chatted = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'sendMessage', payload: { message: '准备\n开工' } }),
  })
  if (!chatted.state.chat.at(-1).startsWith('验收 玩家：准备 开工')) throw new Error('server sendMessage action did not append normalized chat')

  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'sendMessage', payload: { message: '加我 https://example.com 13800138000' } }),
  }, 400)
  const chatAfterRejectedMessage = await request('/api/session', {
    method: 'GET',
    token: login.token,
  })
  if (chatAfterRejectedMessage.state.chat.at(-1) !== chatted.state.chat.at(-1)) {
    throw new Error('rejected public chat message should not pollute global chat')
  }

  const friendSessionAfterChat = await request('/api/session', {
    method: 'GET',
    token: friendRegistration.token,
  })
  if (!friendSessionAfterChat.state.chat.at(-1).startsWith('验收 玩家：准备 开工')) {
    throw new Error('global city chat was not visible to another real user')
  }

  const visited = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'visitVenue', payload: { venueName: '学校' } }),
  })
  if (!visited.state.completedTasks.includes('city')) throw new Error('server visitVenue action did not complete city task')

  const taskClaim = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'claimTask', payload: { taskId: 'feed' } }),
  })
  if (taskClaim.state.coins !== visited.state.coins + 80 || !taskClaim.state.claimedTasks.includes('feed')) {
    throw new Error('server claimTask action did not grant task reward')
  }

  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'startJob', payload: { jobId: 'ai-trainer' } }),
  }, 400)

  await stopServer()
  mutateOnlyUserState((state) => ({
    ...state,
    coins: 10_000,
    states: { ...state.states, energy: 100, health: 100 },
    attrs: { ...state.attrs, skill: 24 },
    education: { ...state.education, grade: 14, skills: { ...state.education.skills, programming: 2 } },
  }))
  startServer()
  await waitForServer()
  await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'startJob', payload: { jobId: 'ai-trainer' } }),
  }, 400)

  const programmingReady = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'studyCourse', payload: { courseId: 'programming' } }),
  })
  if (programmingReady.state.education.skills.programming !== 3 || programmingReady.state.education.grade !== 14) {
    throw new Error('programming course did not raise skill without changing degree grade')
  }

  const highPayJob = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'startJob', payload: { jobId: 'ai-trainer' } }),
  })
  if (highPayJob.state.runningJob?.jobId !== 'ai-trainer' || highPayJob.state.states.energy !== programmingReady.state.states.energy - 36) {
    throw new Error('high-paying job should unlock after required education and programming skill')
  }

  await stopServer()
  mutateOnlyUserState((state) => ({ ...state, runningJob: undefined, states: { ...state.states, energy: 100, health: 100 } }))
  startServer()
  await waitForServer()
  const beforeCoffeeJob = await request('/api/session', {
    method: 'GET',
    token: login.token,
  })

  const startedJob = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'startJob', payload: { jobId: 'coffee' } }),
  })
  if (startedJob.state.runningJob?.jobId !== 'coffee' || startedJob.state.states.energy !== beforeCoffeeJob.state.states.energy - 10) {
    throw new Error('server startJob action did not persist running job')
  }

  await stopServer()
  mutateOnlyUserState((state) => ({ ...state, runningJob: { ...state.runningJob, endsAt: Date.now() - 1000 } }))
  startServer()
  await waitForServer()
  const completedJob = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'completeJob', payload: {} }),
  })
  if (completedJob.state.runningJob || completedJob.state.coins !== startedJob.state.coins + 80 || !completedJob.state.completedTasks.includes('work')) {
    throw new Error('server completeJob action did not settle work reward')
  }

  const dirtyState = {
    ...completedJob.state,
    profile: { nickname: '篡改用户', userCode: 'MOYO-HACKED', createdAt: 'bad' },
    petName: '超长名字'.repeat(20),
    coins: Number.MAX_SAFE_INTEGER,
    gems: -100,
    states: { ...completedJob.state.states, hunger: 999, health: -10 },
    education: { ...completedJob.state.education, grade: 99, skills: { programming: 999, business: -1, communication: 2 } },
    uploadedPreviewUrl: 'https://evil.example/upload.png',
    chat: Array.from({ length: 150 }, (_, index) => `消息-${index}`),
  }
  const cleaned = await request('/api/state', {
    method: 'PUT',
    token: login.token,
    body: JSON.stringify({ state: dirtyState }),
  })
  if (cleaned.state.profile.userCode !== registration.profile.userCode) throw new Error('state sanitizer allowed profile takeover')
  if (cleaned.state.coins !== completedJob.state.coins || cleaned.state.gems !== completedJob.state.gems) throw new Error('client state update changed currency')
  if (cleaned.state.states.hunger !== completedJob.state.states.hunger || cleaned.state.states.health !== completedJob.state.states.health) throw new Error('client state update changed pet states')
  if (cleaned.state.education.grade !== completedJob.state.education.grade || cleaned.state.education.skills.business !== completedJob.state.education.skills.business) throw new Error('client state update changed education')
  if (cleaned.state.uploadedPreviewUrl) throw new Error('state sanitizer accepted an external upload URL')
  if (cleaned.state.chat.length !== completedJob.state.chat.length) throw new Error('client state update changed chat history')
  if (!cleaned.state.chat.at(-1).startsWith('验收 玩家：准备 开工')) throw new Error('client state update polluted global chat')

  await request('/api/upload', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({
      fileName: 'not-really.png',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from('plain text').toString('base64')}`,
    }),
  }, 400)
  await request('/api/upload', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({
      fileName: 'missing-data.png',
      contentType: 'image/png',
      dataUrl: '',
    }),
  }, 400)
  const tooLargePng = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(4 * 1024 * 1024)])
  await request('/api/upload', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({
      fileName: 'too-large.png',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${tooLargePng.toString('base64')}`,
    }),
  }, 400)

  const upload = await request('/api/upload', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({
      fileName: 'pet\nphoto.png',
      contentType: 'image/png',
      dataUrl: pngDataUrl,
    }),
  }, 201)
  if (!upload.url.startsWith('/uploads/') || upload.state.uploadedFileName !== 'pet photo.png') throw new Error('upload did not return normalized persisted URL')
  if (!/^\/uploads\/[a-f0-9]{32}\.png$/.test(upload.url)) throw new Error('upload URL should use a random opaque file name')

  const dbAfterUpload = JSON.parse(readFileSync(join(dataDir, 'moyo-db.json'), 'utf8'))
  if (Object.keys(dbAfterUpload.users).some((userId) => upload.url.includes(userId))) {
    throw new Error('upload URL leaked an internal user id')
  }

  const uploadAsset = await rawRequest(upload.url)
  if (
    uploadAsset.status !== 200 ||
    uploadAsset.headers.get('x-content-type-options') !== 'nosniff' ||
    !uploadAsset.headers.get('content-security-policy')?.includes("img-src 'self' data:")
  ) {
    throw new Error('uploaded asset was not served with expected security headers')
  }
  const uploadHead = await rawRequest(upload.url, { method: 'HEAD' })
  if (uploadHead.status !== 200 || uploadHead.headers.get('content-type') !== 'image/png') {
    throw new Error('uploaded asset HEAD request did not return expected headers')
  }
  const uploadPost = await rawRequest(upload.url, { method: 'POST', body: JSON.stringify({ unexpected: true }) })
  if (uploadPost.status !== 405 || uploadPost.headers.get('allow') !== 'GET, HEAD') {
    throw new Error('uploaded asset should reject non-GET/HEAD methods')
  }
  if (readdirSync(join(dataDir, 'uploads')).length !== 1) throw new Error('first upload file was not written')

  const replacementUpload = await request('/api/upload', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({
      fileName: 'pet-new.png',
      contentType: 'image/png',
      dataUrl: pngDataUrl,
    }),
  }, 201)
  if (replacementUpload.url === upload.url) throw new Error('replacement upload reused the same public URL')
  if ((await rawRequest(upload.url)).status !== 404) throw new Error('old upload file was not removed after replacement upload')
  if (readdirSync(join(dataDir, 'uploads')).length !== 1) throw new Error('replacement upload should leave exactly one upload file')
  if ((await rawRequest(generated.state.generatedPetUrl)).status !== 404) throw new Error('upload replacement should remove the old generated pet image')

  const regenerated = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'generatePet', payload: {} }),
  })
  if (!regenerated.state.generatedPetUrl || regenerated.state.generatedPetUrl === generated.state.generatedPetUrl) {
    throw new Error('photo upload generation should create a fresh generated pet image')
  }
  const regeneratedAsset = await rawRequest(regenerated.state.generatedPetUrl)
  if (regeneratedAsset.status !== 200 || !regeneratedAsset.headers.get('content-type')?.includes('image/svg+xml')) {
    throw new Error('regenerated uploaded-photo pet image was not served as SVG')
  }

  const styleLabels = {
    萌系: 'moe',
    潮玩: 'urban',
    像素: 'pixel',
    国潮: 'guochao',
    未来: 'future',
  }
  const generatedByStyle = new Map()
  let styleState = regenerated.state
  for (const [styleName, styleLabel] of Object.entries(styleLabels)) {
    await request('/api/state', {
      method: 'PUT',
      token: login.token,
      body: JSON.stringify({ state: { ...styleState, petStyle: styleName } }),
    })
    const restyledUpload = await request('/api/upload', {
      method: 'POST',
      token: login.token,
      body: JSON.stringify({
        fileName: `pet-${styleLabel}.png`,
        contentType: 'image/png',
        dataUrl: pngDataUrl,
      }),
    }, 201)
    const restyled = await request('/api/action', {
      method: 'POST',
      token: login.token,
      body: JSON.stringify({ action: 'generatePet', payload: {} }),
    })
    const svgResponse = await rawRequest(restyled.state.generatedPetUrl)
    const svg = await svgResponse.text()
    if (!svg.includes(`data-style="${styleLabel}"`)) {
      throw new Error(`generated ${styleName} pet did not include its distinct style marker`)
    }
    generatedByStyle.set(styleName, svg)
    styleState = restyled.state
    if (!restyledUpload.state.uploadedPreviewUrl) throw new Error(`style upload failed for ${styleName}`)
  }
  if (new Set(generatedByStyle.values()).size !== Object.keys(styleLabels).length) {
    throw new Error('different style selections produced identical generated pet SVGs')
  }

  const resetProgress = await request('/api/action', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({ action: 'resetProgress', payload: {} }),
  })
  if (resetProgress.state.uploadedPreviewUrl || resetProgress.state.uploadedFileName || resetProgress.state.generatedPetUrl) {
    throw new Error('resetProgress should clear uploaded/generated image state')
  }
  if ((await rawRequest(replacementUpload.url)).status !== 404) throw new Error('resetProgress did not remove the current upload file')
  if ((await rawRequest(regenerated.state.generatedPetUrl)).status !== 404) throw new Error('resetProgress did not remove the generated pet file')
  if (readdirSync(join(dataDir, 'uploads')).length !== 0) throw new Error('resetProgress should leave no upload files for the user')
  if (readdirSync(join(dataDir, 'generated-pets')).length !== 0) throw new Error('resetProgress should leave no generated pet files for the user')

  await stopServer()
  const legacyPassword = 'legacy123'
  const legacySalt = randomBytes(16).toString('hex')
  const legacyUserId = randomBytes(16).toString('hex')
  const legacyUserCode = 'MOYO-LEGACY'
  const authDbWithLegacy = JSON.parse(readFileSync(join(dataDir, 'moyo-db.json'), 'utf8'))
  authDbWithLegacy.users[legacyUserId] = {
    id: legacyUserId,
    profile: { nickname: '旧账号', userCode: legacyUserCode, createdAt: new Date().toISOString() },
    passwordSalt: legacySalt,
    passwordHash: createHash('sha256').update(`${legacySalt}:${legacyPassword}`).digest('hex'),
    state: {
      ...upload.state,
      profile: { nickname: '旧账号', userCode: legacyUserCode, createdAt: new Date().toISOString() },
      petName: '旧萌友',
      generated: false,
      uploadedFileName: undefined,
      uploadedPreviewUrl: undefined,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(join(dataDir, 'moyo-db.json'), JSON.stringify(authDbWithLegacy, null, 2))
  startServer()
  await waitForServer()
  await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ userCode: legacyUserCode, password: legacyPassword }),
  })
  const upgradedDb = JSON.parse(readFileSync(join(dataDir, 'moyo-db.json'), 'utf8'))
  if (upgradedDb.users[legacyUserId].passwordAlgorithm !== 'pbkdf2-sha256') {
    throw new Error('legacy sha256 password hash was not upgraded after login')
  }

  await request('/api/logout', {
    method: 'POST',
    token: login.token,
    body: JSON.stringify({}),
  })
  await request('/api/session', { token: login.token }, 401)

  const db = JSON.parse(readFileSync(join(dataDir, 'moyo-db.json'), 'utf8'))
  const users = Object.values(db.users)
  const uploadFiles = readdirSync(join(dataDir, 'uploads'))
  if (users.length !== 3) throw new Error('verification should create exactly three users in isolated data dir')
  if (users.some((user) => user.passwordAlgorithm !== 'pbkdf2-sha256' || !user.passwordHash || user.passwordHash === 'verify123')) {
    throw new Error('password hash was not stored safely')
  }
  if (uploadFiles.length) throw new Error('verification should not leave upload files behind')
  if (!existsSync(join(dataDir, 'moyo-db.backup.json'))) throw new Error('backup database was not created')

  server.kill('SIGTERM')
  await new Promise((resolve) => server.on('exit', resolve))
  writeFileSync(join(dataDir, 'moyo-db.json'), '{broken json')
  startServer()
  await waitForServer()
  const recoveredHealthResponse = await rawRequest('/api/health')
  const recoveredHealth = await recoveredHealthResponse.json()
  const recoveredDb = JSON.parse(readFileSync(join(dataDir, 'moyo-db.json'), 'utf8'))
  if (!recoveredHealth.ok || Object.keys(recoveredDb.users).length !== 3) {
    throw new Error(`backup recovery failed: ${JSON.stringify(recoveredHealth)}`)
  }

  console.log('verify: ok')
} finally {
  cleanup()
}
