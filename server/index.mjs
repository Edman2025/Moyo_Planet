import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(rootDir, 'data')
const uploadsDir = join(dataDir, 'uploads')
const generatedPetsDir = join(dataDir, 'generated-pets')
const dbPath = join(dataDir, 'moyo-db.json')
const backupDbPath = join(dataDir, 'moyo-db.backup.json')
const distDir = join(rootDir, 'dist')
const maxJsonBytes = 6 * 1024 * 1024
const minimaxApiKey = process.env.MINIMAX_API_KEY || ''
const minimaxApiUrl = process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/v1/image_generation'
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')

const failConfig = (message) => {
  console.error(`server config failed: ${message}`)
  process.exit(1)
}

const positiveNumber = (name, fallback) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) failConfig(`${name} must be a positive number.`)
  return parsed
}

const portNumber = (name, fallback) => {
  const raw = process.env[name]
  const parsed = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    failConfig(`${name} must be between 1 and 65535.`)
  }
  return parsed
}

const booleanFlag = (name) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return false
  const normalized = raw.toLowerCase()
  if (!['0', '1', 'true', 'false', 'yes', 'no'].includes(normalized)) {
    failConfig(`${name} must be 0/1, true/false, yes/no, or empty.`)
  }
  return ['1', 'true', 'yes'].includes(normalized)
}

const port = portNumber('PORT', 4173)
const host = process.env.HOST || '127.0.0.1'
const rateWindowMs = positiveNumber('RATE_LIMIT_WINDOW_MS', 60_000)
const maxRequestsPerWindow = positiveNumber('RATE_LIMIT_MAX', 180)
const trustProxy = booleanFlag('TRUST_PROXY')
const sessionTtlMs = positiveNumber('SESSION_TTL_DAYS', 30) * 24 * 60 * 60 * 1000

mkdirSync(uploadsDir, { recursive: true })
mkdirSync(generatedPetsDir, { recursive: true })

const defaultDb = {
  users: {},
  sessions: {},
  globalChat: [],
  parkingSlots: {},
}

const normalizeText = (value) =>
  Array.from(String(value ?? ''))
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

const cleanStringList = (value, maxItems = 100, maxLength = 80) =>
  Array.isArray(value)
    ? value
        .map((entry) => normalizeText(entry).slice(0, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : []

const itemDefs = {
  riceball: { name: '普通饭团', priceCoin: 30, priceGem: 0, effect: { hunger: 20 } },
  bento: { name: '营养便当', priceCoin: 90, priceGem: 0, effect: { hunger: 45, health: 3 } },
  water: { name: '矿泉水', priceCoin: 20, priceGem: 0, effect: { thirst: 25 } },
  energy: { name: '活力饮料', priceCoin: 120, priceGem: 0, effect: { thirst: 20, energy: 20 } },
  pill: { name: '小药丸', priceCoin: 150, priceGem: 0, effect: { health: 25 } },
  plush: { name: '毛绒玩具', priceCoin: 180, priceGem: 0, effect: { mood: 30, social: 8 } },
  jacket: { name: '街区外套', priceCoin: 800, priceGem: 0, effect: { charm: 5 } },
  lamp: { name: '星球台灯', priceCoin: 0, priceGem: 36, effect: { mood: 10, clean: 8 } },
}

const courseDefs = {
  'school-grade': { name: '文化课升级', coinCost: 80, energyCost: 8, gradeGain: 1, creditGain: 18, attrGain: { intelligence: 2 } },
  communication: { name: '沟通训练', coinCost: 120, energyCost: 10, creditGain: 16, skillGain: { communication: 1 }, attrGain: { charm: 3 } },
  programming: { name: '编程技能', coinCost: 240, energyCost: 14, creditGain: 24, skillGain: { programming: 1 }, attrGain: { skill: 4, intelligence: 2 }, minGrade: 7 },
  business: { name: '商业管理', coinCost: 360, energyCost: 18, creditGain: 30, skillGain: { business: 1 }, attrGain: { wealthLevel: 1, charm: 2 }, minGrade: 10 },
}

const jobDefs = {
  coffee: { name: '咖啡店帮工', duration: 20, energyCost: 10, rewardCoin: 80, rewardExp: 20, attr: 'charm', minAttr: 0 },
  runner: { name: '外卖跑腿', duration: 35, energyCost: 18, rewardCoin: 150, rewardExp: 35, attr: 'strength', minAttr: 10, minGrade: 2 },
  office: { name: '办公室临时工', duration: 55, energyCost: 25, rewardCoin: 320, rewardExp: 70, attr: 'intelligence', minAttr: 18, minGrade: 6 },
  creator: { name: '内容创作', duration: 80, energyCost: 30, rewardCoin: 650, rewardExp: 130, attr: 'charm', minAttr: 25, minGrade: 9, minSkills: { communication: 2 } },
  'ai-trainer': { name: 'AI 训练师', duration: 90, energyCost: 36, rewardCoin: 1_200, rewardExp: 220, attr: 'skill', minAttr: 24, minGrade: 14, minSkills: { programming: 3 } },
  'business-consultant': { name: '商业顾问', duration: 120, energyCost: 44, rewardCoin: 2_200, rewardExp: 360, attr: 'wealthLevel', minAttr: 2, minGrade: 15, minSkills: { business: 4, communication: 3 } },
}

const taskDefs = {
  feed: { title: '完成一次喂食', reward: 80 },
  drink: { title: '给宠物补水', reward: 60 },
  work: { title: '完成一份工作', reward: 160 },
  shop: { title: '购买任意商品', reward: 120 },
  city: { title: '进入城市场景', reward: 100 },
  social: { title: '拜访好友或互动', reward: 140 },
}

const slotDefs = {
  a1: { name: '好友车位 A1', rate: 60 },
  b2: { name: '商场热区 B2', rate: 72 },
  c3: { name: '公园路边 C3', rate: 45 },
}

const careDefs = {
  feed: { label: '喂食', duration: 20, patch: { hunger: 18, mood: 3 }, task: 'feed' },
  drink: { label: '喝水', duration: 12, patch: { thirst: 22 }, task: 'drink' },
  sleep: { label: '睡觉', duration: 120, patch: { sleep: 26, energy: 28, mood: 4 } },
  heal: { label: '看病', duration: 90, patch: { health: 24 } },
  study: { label: '学习', duration: 60, patch: { energy: -8, mood: -2 } },
  play: { label: '娱乐', duration: 45, patch: { mood: 20, social: 8, energy: -5 } },
  bath: { label: '洗澡', duration: 50, patch: { clean: 30, mood: 4 } },
}

const parseDbFile = (path) => {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return {
    ...defaultDb,
    ...parsed,
    users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
    sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
    globalChat: cleanStringList(parsed.globalChat, 100, 160),
    parkingSlots: parsed.parkingSlots && typeof parsed.parkingSlots === 'object' ? parsed.parkingSlots : {},
  }
}

const loadDb = () => {
  if (!existsSync(dbPath)) return defaultDb
  try {
    return parseDbFile(dbPath)
  } catch {
    if (existsSync(backupDbPath)) {
      try {
        const recovered = parseDbFile(backupDbPath)
        writeFileSync(dbPath, JSON.stringify(recovered, null, 2))
        return recovered
      } catch {
        return defaultDb
      }
    }
    return defaultDb
  }
}

let db = loadDb()
const rateBuckets = new Map()

const pruneDatabase = (now = Date.now()) => {
  for (const [token, session] of Object.entries(db.sessions)) {
    const createdAt = Date.parse(session?.createdAt)
    if (!db.users[session?.userId] || (Number.isFinite(createdAt) && now - createdAt > sessionTtlMs)) {
      delete db.sessions[token]
    }
  }
  for (const [slotId, occupancy] of Object.entries(db.parkingSlots)) {
    const user = db.users[occupancy?.userId]
    if (!slotDefs[slotId] || !user || user.state?.parkedSlot !== slotId) {
      delete db.parkingSlots[slotId]
    }
  }
}

pruneDatabase()

const saveDb = () => {
  pruneDatabase()
  if (existsSync(dbPath)) copyFileSync(dbPath, backupDbPath)
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(db, null, 2))
  renameSync(tmpPath, dbPath)
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const json = (res, status, body) => {
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const emptyJson = (res, status) => {
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end()
}

const readJson = async (req) => {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.includes('application/json')) throw new Error('请求类型必须是 application/json')
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxJsonBytes) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('JSON 请求体无效')
  }
}

const readJsonObject = async (req) => {
  const body = await readJson(req)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON 请求体必须是对象')
  return body
}

const passwordIterations = 210_000
const minPasswordLength = 6
const maxPasswordLength = 128

const validatePasswordLength = (password) => {
  const length = String(password).length
  if (length < minPasswordLength) return '密码至少 6 位'
  if (length > maxPasswordLength) return '密码不能超过 128 位'
  return ''
}

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => {
  const hash = pbkdf2Sync(String(password), salt, passwordIterations, 32, 'sha256').toString('hex')
  return { algorithm: 'pbkdf2-sha256', iterations: passwordIterations, salt, hash }
}

const legacyHashPassword = (password, salt) => createHash('sha256').update(`${salt}:${password}`).digest('hex')

const constantTimeHexEqual = (left, right) => {
  const attempt = Buffer.from(String(left), 'hex')
  const saved = Buffer.from(String(right), 'hex')
  return attempt.length === saved.length && timingSafeEqual(attempt, saved)
}

const verifyPassword = (password, user) => {
  if (user.passwordAlgorithm === 'pbkdf2-sha256') {
    const rawIterations = Number(user.passwordIterations)
    const iterations = Number.isInteger(rawIterations) && rawIterations >= 100_000 && rawIterations <= 1_000_000 ? rawIterations : passwordIterations
    const attempt = pbkdf2Sync(String(password), user.passwordSalt, iterations, 32, 'sha256').toString('hex')
    return constantTimeHexEqual(attempt, user.passwordHash)
  }
  return constantTimeHexEqual(legacyHashPassword(String(password), user.passwordSalt), user.passwordHash)
}

const upgradePasswordHash = (password, user) => {
  if (user.passwordAlgorithm === 'pbkdf2-sha256' && user.passwordIterations >= passwordIterations) return false
  const { algorithm, iterations, salt, hash } = hashPassword(password)
  user.passwordAlgorithm = algorithm
  user.passwordIterations = iterations
  user.passwordSalt = salt
  user.passwordHash = hash
  return true
}

const createUserCode = () => {
  let code = ''
  do {
    code = `MOYO-${randomBytes(3).toString('hex').toUpperCase()}`
  } while (Object.values(db.users).some((user) => user.profile.userCode === code))
  return code
}

const createInitialGameState = (profile, petName) => ({
  profile,
  petName: petName || '萌友',
  petStyle: '潮玩',
  generated: false,
  uploadedFileName: undefined,
  uploadedPreviewUrl: undefined,
  generatedPetUrl: undefined,
  level: 1,
  exp: 40,
  coins: 1280,
  gems: 80,
  states: {
    hunger: 68,
    thirst: 72,
    sleep: 64,
    health: 82,
    mood: 76,
    energy: 78,
    clean: 70,
    social: 55,
  },
  attrs: {
    intelligence: 18,
    strength: 12,
    charm: 20,
    skill: 8,
    wealthLevel: 1,
  },
  education: {
    grade: 1,
    credits: 0,
    skills: {
      programming: 0,
      business: 0,
      communication: 0,
    },
  },
  inventory: {
    riceball: 2,
    water: 2,
    plush: 1,
  },
  completedTasks: [],
  claimedTasks: [],
  stolenCrops: [],
  friends: [],
  friendsAdded: [],
  giftsSent: [],
  runningCare: undefined,
  runningJob: undefined,
  chat: [],
})

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

const cleanString = (value, fallback, maxLength = 40) => {
  const text = normalizeText(value ?? fallback)
  return (text || fallback).slice(0, maxLength)
}

const hasUnsafePublicText = (value) => {
  const text = String(value ?? '').toLowerCase()
  return /https?:\/\/|www\.|@|微信|vx|qq|电话|手机|\d{7,}/i.test(text)
}

const publicTextOrFallback = (value, fallback, maxLength = 24) => {
  const text = cleanString(value, fallback, maxLength)
  return hasUnsafePublicText(text) ? fallback : text
}

const cleanStringArray = (value, maxItems = 100, maxLength = 80) => cleanStringList(value, maxItems, maxLength)

const cleanInventory = (inventory) => {
  const source = inventory && typeof inventory === 'object' ? inventory : {}
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [cleanString(key, '', 40), clampNumber(value, 0, 999, 0)])
      .filter(([key]) => key),
  )
}

const cleanFriends = (friends) =>
  (Array.isArray(friends) ? friends : []).slice(0, 100).map((friend) => {
    const id = cleanString(friend?.id, randomBytes(8).toString('hex'), 80)
    return {
      id,
      name: cleanString(friend?.name, '好友', 24),
      userCode: cleanString(friend?.userCode, '', 24),
      addedAt: cleanString(friend?.addedAt, new Date().toISOString(), 40),
      crop: {
        id: cleanString(friend?.crop?.id, randomBytes(8).toString('hex'), 80),
        name: cleanString(friend?.crop?.name, '小麦', 20),
        reward: clampNumber(friend?.crop?.reward, 0, 500, 25),
        ready: Boolean(friend?.crop?.ready),
      },
    }
  })

const cleanUploadUrl = (value, fallback) => {
  const url = typeof value === 'string' ? value : ''
  if (/^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(url)) return url
  return fallback
}

const cleanGeneratedPetUrl = (value, fallback) => {
  const url = typeof value === 'string' ? value : ''
  if (/^\/generated-pets\/[a-f0-9]{32}\.(svg|png|jpg|jpeg|webp)$/.test(url)) return url
  return fallback
}

const removeUploadByUrl = (url) => {
  if (!/^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(String(url ?? ''))) return
  try {
    unlinkSync(join(uploadsDir, basename(url)))
  } catch {
    // Missing old uploads are harmless; the database state remains authoritative.
  }
}

const removeGeneratedPetByUrl = (url) => {
  if (!/^\/generated-pets\/[a-f0-9]{32}\.(svg|png|jpg|jpeg|webp)$/.test(String(url ?? ''))) return
  try {
    unlinkSync(join(generatedPetsDir, basename(url)))
  } catch {
    // Missing generated images are harmless; state is still cleaned by the caller.
  }
}

const generatedPetSvg = ({ hash, style }) => {
  const bytes = Buffer.from(hash, 'hex')
  const styleConfig = {
    萌系: {
      palette: ['#fff7fb', '#ff8fab', '#ffd6e0', '#8bd3dd', '#ffeef5'],
      ears: 'round',
      body: 'round',
      accessory: 'bow',
      eye: 'dot',
      label: 'moe',
    },
    潮玩: {
      palette: ['#f9fff3', '#2ec4b6', '#f9c74f', '#ff6b6b', '#d8fff4'],
      ears: 'cat',
      body: 'capsule',
      accessory: 'bolt',
      eye: 'cool',
      label: 'urban',
    },
    像素: {
      palette: ['#f2fbff', '#4dabf7', '#b197fc', '#ffd166', '#e7f0ff'],
      ears: 'square',
      body: 'block',
      accessory: 'blocks',
      eye: 'square',
      label: 'pixel',
    },
    国潮: {
      palette: ['#fff5f2', '#e63946', '#f9c74f', '#2ec4b6', '#ffe4dc'],
      ears: 'fan',
      body: 'round',
      accessory: 'cloud',
      eye: 'arc',
      label: 'guochao',
    },
    未来: {
      palette: ['#f8fff4', '#6c63ff', '#2ec4b6', '#ffca3a', '#e7ffd7'],
      ears: 'antenna',
      body: 'visor',
      accessory: 'circuit',
      eye: 'visor',
      label: 'future',
    },
  }[style] ?? {
    palette: ['#f9fff3', '#2ec4b6', '#f9c74f', '#ff8fab', '#d8fff4'],
    ears: 'cat',
    body: 'capsule',
    accessory: 'bolt',
    eye: 'dot',
    label: 'default',
  }
  const palette = styleConfig.palette
  const cheek = bytes[2] % 2 ? '#ffcfd9' : '#ffd6a5'
  const ears = {
    round: `<rect x="28" y="16" width="24" height="24" rx="8" fill="#263238"/><rect x="34" y="20" width="16" height="16" rx="6" fill="${palette[2]}"/><rect x="76" y="16" width="24" height="24" rx="8" fill="#263238"/><rect x="78" y="20" width="16" height="16" rx="6" fill="${palette[2]}"/>`,
    cat: `<rect x="30" y="24" width="20" height="12" fill="#263238"/><rect x="34" y="12" width="20" height="20" fill="#263238"/><rect x="38" y="16" width="12" height="16" fill="${palette[2]}"/><rect x="78" y="24" width="20" height="12" fill="#263238"/><rect x="74" y="12" width="20" height="20" fill="#263238"/><rect x="78" y="16" width="12" height="16" fill="${palette[2]}"/>`,
    square: `<rect x="28" y="18" width="24" height="24" fill="#263238"/><rect x="36" y="26" width="8" height="8" fill="${palette[2]}"/><rect x="76" y="18" width="24" height="24" fill="#263238"/><rect x="84" y="26" width="8" height="8" fill="${palette[2]}"/>`,
    fan: `<rect x="24" y="20" width="32" height="20" fill="#263238"/><rect x="28" y="16" width="24" height="20" fill="${palette[2]}"/><rect x="72" y="20" width="32" height="20" fill="#263238"/><rect x="76" y="16" width="24" height="20" fill="${palette[2]}"/>`,
    antenna: `<rect x="36" y="18" width="8" height="24" fill="#263238"/><rect x="32" y="10" width="16" height="12" fill="${palette[1]}"/><rect x="84" y="18" width="8" height="24" fill="#263238"/><rect x="80" y="10" width="16" height="12" fill="${palette[1]}"/>`,
  }[styleConfig.ears]
  const body = {
    round: `<rect x="30" y="40" width="68" height="60" rx="16" fill="${palette[0]}"/>`,
    capsule: `<rect x="30" y="40" width="68" height="60" rx="10" fill="${palette[0]}"/>`,
    block: `<rect x="28" y="40" width="72" height="60" fill="${palette[0]}"/>`,
    visor: `<rect x="28" y="40" width="72" height="60" rx="6" fill="${palette[0]}"/>`,
  }[styleConfig.body]
  const forehead = style === '国潮' ? '#e63946' : palette[2]
  const accessory = {
    bow: `<rect x="50" y="30" width="10" height="10" fill="${palette[3]}"/><rect x="68" y="30" width="10" height="10" fill="${palette[3]}"/><rect x="60" y="33" width="8" height="6" fill="#263238"/>`,
    bolt: `<rect x="60" y="24" width="12" height="12" fill="${forehead}"/><rect x="56" y="36" width="12" height="8" fill="${forehead}"/><rect x="64" y="44" width="8" height="8" fill="${forehead}"/>`,
    blocks: `<rect x="48" y="28" width="8" height="8" fill="${palette[1]}"/><rect x="60" y="28" width="8" height="8" fill="${palette[2]}"/><rect x="72" y="28" width="8" height="8" fill="${palette[3]}"/>`,
    cloud: `<rect x="44" y="30" width="40" height="8" fill="${forehead}"/><rect x="52" y="22" width="24" height="8" fill="${palette[2]}"/><rect x="56" y="38" width="16" height="8" fill="${palette[2]}"/>`,
    circuit: `<rect x="48" y="30" width="32" height="6" fill="${palette[1]}"/><rect x="56" y="22" width="6" height="18" fill="${palette[2]}"/><rect x="70" y="22" width="6" height="18" fill="${palette[2]}"/>`,
  }[styleConfig.accessory]
  const eyeDx = 20 + (bytes[4] % 6)
  const eyes = {
    dot: `<rect class="eye" x="${64 - eyeDx - 5}" y="64" width="10" height="18" fill="#263238"/><rect class="eye" x="${64 + eyeDx - 5}" y="64" width="10" height="18" fill="#263238"/><rect x="${64 - eyeDx - 2}" y="66" width="4" height="4" fill="#fff"/><rect x="${64 + eyeDx - 2}" y="66" width="4" height="4" fill="#fff"/>`,
    cool: `<rect x="${64 - eyeDx - 8}" y="66" width="16" height="8" fill="#263238"/><rect x="${64 + eyeDx - 8}" y="66" width="16" height="8" fill="#263238"/><rect x="${64 - eyeDx - 4}" y="66" width="6" height="3" fill="${palette[1]}"/><rect x="${64 + eyeDx - 4}" y="66" width="6" height="3" fill="${palette[1]}"/>`,
    square: `<rect class="eye" x="${64 - eyeDx - 6}" y="64" width="12" height="12" fill="#263238"/><rect class="eye" x="${64 + eyeDx - 6}" y="64" width="12" height="12" fill="#263238"/><rect x="${64 - eyeDx - 2}" y="66" width="4" height="4" fill="#fff"/><rect x="${64 + eyeDx - 2}" y="66" width="4" height="4" fill="#fff"/>`,
    arc: `<rect x="${64 - eyeDx - 8}" y="68" width="16" height="4" fill="#263238"/><rect x="${64 - eyeDx - 4}" y="64" width="8" height="4" fill="#263238"/><rect x="${64 + eyeDx - 8}" y="68" width="16" height="4" fill="#263238"/><rect x="${64 + eyeDx - 4}" y="64" width="8" height="4" fill="#263238"/>`,
    visor: `<rect x="38" y="62" width="52" height="16" fill="#263238"/><rect x="42" y="66" width="44" height="6" fill="${palette[1]}"/><rect x="54" y="66" width="10" height="6" fill="#fff" opacity=".75"/>`,
  }[styleConfig.eye]
  const mouth = bytes[5] % 2
    ? `<rect x="60" y="86" width="8" height="4" fill="#263238"/><rect x="56" y="90" width="4" height="4" fill="#263238"/><rect x="68" y="90" width="4" height="4" fill="#263238"/>`
    : `<rect x="56" y="86" width="16" height="4" fill="#263238"/><rect x="60" y="90" width="8" height="4" fill="#263238"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 138" role="img" aria-label="${styleConfig.label} Codex风格生成萌宠" data-style="${styleConfig.label}" shape-rendering="crispEdges">
  <style>
    @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @keyframes blink { 0%,88%,100% { transform: scaleY(1); } 92%,96% { transform: scaleY(.15); } }
    @keyframes wave { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-2px,-5px); } }
    .pet { animation: bob 1.8s steps(2,end) infinite; transform-origin: 64px 72px; }
    .eye { animation: blink 3.2s steps(1,end) infinite; transform-origin: center; }
    .paw-r { animation: wave 1.4s steps(2,end) infinite; }
    @media (prefers-reduced-motion: reduce) { .pet,.eye,.paw-r { animation: none; } }
  </style>
  <rect width="128" height="138" fill="none"/>
  <g class="pet">
    <rect x="28" y="112" width="72" height="8" fill="${palette[1]}" opacity=".18"/>
    ${ears}
    <rect x="30" y="36" width="68" height="12" fill="#263238"/>
    <rect x="22" y="48" width="84" height="52" fill="#263238"/>
    ${body}
    <rect x="22" y="60" width="8" height="32" fill="#263238"/>
    <rect x="98" y="60" width="8" height="32" fill="#263238"/>
    <rect x="34" y="96" width="60" height="12" fill="#263238"/>
    <rect x="42" y="44" width="44" height="8" fill="${palette[4]}"/>
    ${accessory}
    ${eyes}
    <rect x="36" y="84" width="14" height="8" fill="${cheek}"/>
    <rect x="78" y="84" width="14" height="8" fill="${cheek}"/>
    <rect x="60" y="80" width="8" height="6" fill="#263238"/>
    ${mouth}
    <rect x="14" y="82" width="20" height="4" fill="#263238"/>
    <rect x="16" y="92" width="18" height="4" fill="#263238"/>
    <rect x="94" y="82" width="20" height="4" fill="#263238"/>
    <rect x="94" y="92" width="18" height="4" fill="#263238"/>
    <rect x="28" y="104" width="22" height="22" fill="#263238"/>
    <rect x="34" y="108" width="18" height="14" fill="#fff"/>
    <g class="paw-r">
      <rect x="78" y="104" width="22" height="22" fill="#263238"/>
      <rect x="76" y="106" width="18" height="14" fill="#fff"/>
    </g>
    <rect x="48" y="106" width="32" height="8" fill="${palette[1]}" opacity=".28"/>
    <rect x="56" y="110" width="16" height="8" fill="${palette[1]}" opacity=".38"/>
  </g>
</svg>`
}

const petGenerationPrompt = (state) =>
  [
    'Create one cute Codex-style digital companion pet inspired by the uploaded reference image.',
    'Do not make a portrait or caricature. Transform the reference into a small friendly mascot.',
    'Style: compact chibi digital pet, pixel-art-adjacent, chunky readable silhouette, thick dark outline, limited palette, flat cel shading.',
    'Keep it suitable as an in-game pet avatar. No text, no symbols, no realistic face, no political imagery.',
    `Selected style: ${state.petStyle}.`,
    'If the reference is a person, only borrow broad color and personality cues, not their exact face.',
  ].join(' ')

const extractMinimaxImage = (payload) => {
  const candidates = [
    ...(Array.isArray(payload?.data?.image_urls) ? payload.data.image_urls : []),
    ...(Array.isArray(payload?.data?.images) ? payload.data.images : []),
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
  ]
  for (const item of candidates) {
    if (typeof item === 'string') return { url: item }
    if (item?.b64_json) return { b64: item.b64_json }
    if (item?.base64) return { b64: item.base64 }
    if (item?.url) return { url: item.url }
    if (item?.image_url) return { url: item.image_url }
  }
  if (Array.isArray(payload?.data?.image_base64) && payload.data.image_base64[0]) return { b64: payload.data.image_base64[0] }
  if (payload?.data?.image_base64) return { b64: payload.data.image_base64 }
  if (payload?.image_base64) return { b64: payload.image_base64 }
  return {}
}

const extensionForGeneratedImage = (buffer) => {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp'
  return ''
}

const fetchMinimaxImage = async (state, publicImageUrl) => {
  const response = await fetch(minimaxApiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${minimaxApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'image-01',
      prompt: petGenerationPrompt(state),
      aspect_ratio: '1:1',
      response_format: 'base64',
      n: 1,
      prompt_optimizer: true,
      subject_reference: [
        {
          type: 'character',
          image_file: publicImageUrl,
        },
      ],
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.base_resp?.status_msg || payload?.error?.message || `MiniMax 生成失败：${response.status}`)
  }
  if (payload?.base_resp?.status_code && payload.base_resp.status_code !== 0) {
    throw new Error(payload.base_resp.status_msg || `MiniMax 生成失败：${payload.base_resp.status_code}`)
  }
  const image = extractMinimaxImage(payload)
  if (image.b64) return Buffer.from(String(image.b64).replace(/^data:image\/\w+;base64,/, ''), 'base64')
  if (image.url) {
    const imageResponse = await fetch(image.url)
    if (!imageResponse.ok) throw new Error(`MiniMax 图片下载失败：${imageResponse.status}`)
    return Buffer.from(await imageResponse.arrayBuffer())
  }
  throw new Error('MiniMax 没有返回可用图片')
}

const generatePetImage = async (state) => {
  const uploadUrl = cleanUploadUrl(state.uploadedPreviewUrl, '')
  const sourcePath = uploadUrl ? join(uploadsDir, basename(uploadUrl)) : ''
  if (minimaxApiKey && uploadUrl && publicBaseUrl) {
    const buffer = await fetchMinimaxImage(state, `${publicBaseUrl}${uploadUrl}`)
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw new Error('MiniMax 返回图片无效')
    const extension = extensionForGeneratedImage(buffer)
    if (!extension) throw new Error('MiniMax 返回图片格式无效')
    const imageName = `${randomBytes(16).toString('hex')}${extension}`
    writeFileSync(join(generatedPetsDir, imageName), buffer)
    return `/generated-pets/${imageName}`
  }
  const source = sourcePath && existsSync(sourcePath) ? readFileSync(sourcePath) : Buffer.from(`${state.petName}:${state.petStyle}:${Date.now()}`)
  const hash = createHash('sha256').update(source).update(String(state.petStyle)).digest('hex')
  const imageName = `${randomBytes(16).toString('hex')}.svg`
  writeFileSync(join(generatedPetsDir, imageName), generatedPetSvg({ hash, style: state.petStyle }))
  return `/generated-pets/${imageName}`
}

const sanitizeGameState = (input, user) => {
  const current = user.state ?? createInitialGameState(user.profile, '萌友')
  const state = input && typeof input === 'object' ? input : {}
  return {
    ...current,
    profile: user.profile,
    petName: cleanString(state.petName, current.petName, 16),
    petStyle: cleanString(state.petStyle, current.petStyle, 16),
    generated: Boolean(state.generated),
    uploadedFileName: state.uploadedFileName === null
      ? undefined
      : state.uploadedFileName ? cleanString(state.uploadedFileName, current.uploadedFileName ?? '', 120) : current.uploadedFileName,
    uploadedPreviewUrl: state.uploadedPreviewUrl === null ? undefined : cleanUploadUrl(state.uploadedPreviewUrl, current.uploadedPreviewUrl),
    generatedPetUrl: state.generatedPetUrl === null ? undefined : cleanGeneratedPetUrl(state.generatedPetUrl, current.generatedPetUrl),
    level: clampNumber(state.level, 1, 200, current.level),
    exp: clampNumber(state.exp, 0, 10_000_000, current.exp),
    coins: clampNumber(state.coins, 0, 10_000_000, current.coins),
    gems: clampNumber(state.gems, 0, 1_000_000, current.gems),
    states: {
      hunger: clampNumber(state.states?.hunger, 0, 100, current.states.hunger),
      thirst: clampNumber(state.states?.thirst, 0, 100, current.states.thirst),
      sleep: clampNumber(state.states?.sleep, 0, 100, current.states.sleep),
      health: clampNumber(state.states?.health, 0, 100, current.states.health),
      mood: clampNumber(state.states?.mood, 0, 100, current.states.mood),
      energy: clampNumber(state.states?.energy, 0, 100, current.states.energy),
      clean: clampNumber(state.states?.clean, 0, 100, current.states.clean),
      social: clampNumber(state.states?.social, 0, 100, current.states.social),
    },
    attrs: {
      intelligence: clampNumber(state.attrs?.intelligence, 0, 999, current.attrs.intelligence),
      strength: clampNumber(state.attrs?.strength, 0, 999, current.attrs.strength),
      charm: clampNumber(state.attrs?.charm, 0, 999, current.attrs.charm),
      skill: clampNumber(state.attrs?.skill, 0, 999, current.attrs.skill),
      wealthLevel: clampNumber(state.attrs?.wealthLevel, 0, 999, current.attrs.wealthLevel),
    },
    education: {
      grade: clampNumber(state.education?.grade, 1, 16, current.education.grade),
      credits: clampNumber(state.education?.credits, 0, 1_000_000, current.education.credits),
      skills: {
        programming: clampNumber(state.education?.skills?.programming, 0, 100, current.education.skills.programming),
        business: clampNumber(state.education?.skills?.business, 0, 100, current.education.skills.business),
        communication: clampNumber(state.education?.skills?.communication, 0, 100, current.education.skills.communication),
      },
    },
    inventory: cleanInventory(state.inventory),
    completedTasks: cleanStringArray(state.completedTasks, 200, 60),
    claimedTasks: cleanStringArray(state.claimedTasks, 200, 60),
    stolenCrops: cleanStringArray(state.stolenCrops, 500, 140),
    friends: cleanFriends(state.friends),
    friendsAdded: cleanStringArray(state.friendsAdded, 100, 24),
    giftsSent: cleanStringArray(state.giftsSent, 200, 24),
    parkedSlot: state.parkedSlot ? cleanString(state.parkedSlot, '', 40) : undefined,
    parkedAt: state.parkedAt ? clampNumber(state.parkedAt, 0, 9_999_999_999_999, current.parkedAt ?? 0) : undefined,
    runningCare: state.runningCare?.kind && state.runningCare?.endsAt
      ? {
          kind: cleanString(state.runningCare.kind, '', 40),
          endsAt: clampNumber(state.runningCare.endsAt, 0, 9_999_999_999_999, 0),
        }
      : undefined,
    runningJob: state.runningJob?.jobId && state.runningJob?.endsAt
      ? {
          jobId: cleanString(state.runningJob.jobId, '', 40),
          endsAt: clampNumber(state.runningJob.endsAt, 0, 9_999_999_999_999, 0),
        }
      : undefined,
    chat: cleanStringArray(state.chat, 100, 160),
  }
}

const mergeClientStateUpdate = (input, user) => {
  const current = sanitizeGameState(user.state, user)
  const state = input && typeof input === 'object' ? input : {}
  return sanitizeGameState({
    ...current,
    petName: state.petName,
    petStyle: state.petStyle,
  }, user)
}

const withGlobalChat = (state) => ({
  ...state,
  chat: cleanStringArray(db.globalChat, 100, 160),
})

const publicParkingSlots = (userId) =>
  Object.fromEntries(
    Object.entries(slotDefs).map(([slotId]) => {
      const occupancy = db.parkingSlots[slotId]
      const occupiedByMe = occupancy?.userId === userId
      return [
        slotId,
        {
          occupied: Boolean(occupancy?.userId),
          occupiedByMe,
          occupiedByName: occupancy?.userId && !occupiedByMe
            ? publicTextOrFallback(db.users[occupancy.userId]?.profile?.nickname, '其他玩家')
            : undefined,
        },
      ]
    }),
  )

const decoratePublicState = (state, user) => ({
  ...withGlobalChat(state),
  parkingSlots: publicParkingSlots(user.id),
})

const updatePetStates = (states, patch) => {
  const next = { ...states }
  for (const [key, value] of Object.entries(patch)) {
    next[key] = clampNumber((next[key] ?? 0) + value, 0, 100, next[key] ?? 0)
  }
  return next
}

const addTask = (state, taskId) => ({
  ...state,
  completedTasks: Array.from(new Set([...(state.completedTasks ?? []), taskId])),
})

const calculateParkingPending = (state) => {
  const slot = slotDefs[state.parkedSlot]
  if (!slot || !state.parkedAt) return 0
  return Math.min(360, Math.floor((Date.now() - state.parkedAt) / 10_000) * Math.max(1, Math.round(slot.rate / 6)))
}

const meetsSkills = (education, minSkills = {}) =>
  Object.entries(minSkills).every(([key, value]) => (education.skills[key] ?? 0) >= value)

const friendSnapshot = (friendUser) => {
  const level = clampNumber(friendUser.state?.level, 1, 200, 1)
  const friendName = publicTextOrFallback(friendUser.profile.nickname, '好友')
  const petName = publicTextOrFallback(friendUser.state?.petName, friendName, 16)
  return {
    id: friendUser.id,
    name: friendName,
    userCode: friendUser.profile.userCode,
    addedAt: new Date().toISOString(),
    crop: {
      id: `${friendUser.id}:${new Date().toISOString().slice(0, 10)}`,
      name: `${petName}的星球作物`,
      reward: Math.min(500, 25 + level * 5),
      ready: true,
    },
  }
}

const applyEffect = (state, effect) => {
  const stateKeys = new Set(['hunger', 'thirst', 'sleep', 'health', 'mood', 'energy', 'clean', 'social'])
  const next = { ...state, states: { ...state.states }, attrs: { ...state.attrs } }
  for (const [key, value] of Object.entries(effect)) {
    if (stateKeys.has(key)) next.states = updatePetStates(next.states, { [key]: value })
    else next.attrs[key] = clampNumber((next.attrs[key] ?? 0) + value, 0, 999, next.attrs[key] ?? 0)
  }
  return next
}

const runAction = async (user, action, payload = {}) => {
  let state = sanitizeGameState(user.state, user)

  if (action === 'generatePet') {
    if (state.generated && state.generatedPetUrl) return { state, message: `${state.petName} 已经上线` }
    if (state.gems < 10) return { status: 400, error: '星钻不足，暂时不能生成宠物' }
    removeGeneratedPetByUrl(state.generatedPetUrl)
    try {
      state = { ...state, generated: true, generatedPetUrl: await generatePetImage(state), gems: state.gems - 10 }
    } catch (error) {
      return { status: 502, error: error instanceof Error ? error.message : '图片生成失败，请稍后再试' }
    }
    return { state, message: `宠物生成完成，欢迎 ${state.petName} 上线` }
  }

  if (action === 'resetProgress') {
    if (state.parkedSlot && db.parkingSlots[state.parkedSlot]?.userId === user.id) delete db.parkingSlots[state.parkedSlot]
    removeUploadByUrl(state.uploadedPreviewUrl)
    removeGeneratedPetByUrl(state.generatedPetUrl)
    state = {
      ...createInitialGameState(user.profile, state.petName),
      uploadedFileName: null,
      uploadedPreviewUrl: null,
      generatedPetUrl: null,
    }
    return { state, message: '进度已重置，玩家资料已保留' }
  }

  if (action === 'care') {
    const care = careDefs[payload.kind]
    if (!care) return { status: 400, error: '未知照顾动作' }
    if (state.runningCare) return { status: 400, error: '已经有日常行动在进行，等完成后再安排下一件事' }
    state = {
      ...state,
      runningCare: { kind: payload.kind, endsAt: Date.now() + care.duration * 1000 },
    }
    return { state, message: `${care.label}开始了，需要 ${care.duration} 秒` }
  }

  if (action === 'completeCare') {
    if (!state.runningCare) return { status: 400, error: '没有进行中的日常行动' }
    const care = careDefs[state.runningCare.kind]
    if (!care) return { status: 400, error: '日常行动不存在' }
    if (Date.now() < state.runningCare.endsAt) return { status: 400, error: '这件事还没有完成，需要继续等待' }
    state = { ...state, states: updatePetStates(state.states, care.patch) }
    if (care.task) state = addTask(state, care.task)
    state.runningCare = undefined
    return { state, message: `${care.label}完成` }
  }

  if (action === 'buyItem') {
    const item = itemDefs[payload.itemId]
    if (!item) return { status: 400, error: '商品不存在' }
    if (state.coins < item.priceCoin || state.gems < item.priceGem) return { status: 400, error: '资源不足，先去工作赚一点' }
    state = {
      ...addTask(state, 'shop'),
      coins: state.coins - item.priceCoin,
      gems: state.gems - item.priceGem,
      inventory: { ...state.inventory, [payload.itemId]: (state.inventory[payload.itemId] ?? 0) + 1 },
    }
    return { state, message: `已购买 ${item.name}` }
  }

  if (action === 'useItem') {
    const item = itemDefs[payload.itemId]
    if (!item) return { status: 400, error: '道具不存在' }
    if ((state.inventory[payload.itemId] ?? 0) <= 0) return { status: 400, error: '背包里还没有这个道具' }
    state = applyEffect(state, item.effect)
    state.inventory = { ...state.inventory, [payload.itemId]: Math.max(0, (state.inventory[payload.itemId] ?? 0) - 1) }
    return { state, message: `${item.name}已使用` }
  }

  if (action === 'studyCourse') {
    const course = courseDefs[payload.courseId]
    if (!course) return { status: 400, error: '课程不存在' }
    if (state.coins < course.coinCost) return { status: 400, error: '金币不足，先完成工作再学习' }
    if (state.states.energy < course.energyCost) return { status: 400, error: '精力不足，先睡觉恢复' }
    if ((course.minGrade ?? 1) > state.education.grade) return { status: 400, error: '年级不足' }
    if (!meetsSkills(state.education, course.minSkills)) return { status: 400, error: '技能不足，先学习前置课程' }
    if (course.gradeGain && state.education.grade >= 16) return { status: 400, error: '已达到最高学历' }
    state = {
      ...state,
      coins: state.coins - course.coinCost,
      exp: state.exp + course.creditGain,
      attrs: { ...state.attrs },
      education: {
        grade: Math.min(16, state.education.grade + (course.gradeGain ?? 0)),
        credits: state.education.credits + course.creditGain,
        skills: { ...state.education.skills },
      },
      states: updatePetStates(state.states, { energy: -course.energyCost, mood: -2 }),
    }
    for (const [key, value] of Object.entries(course.attrGain ?? {})) state.attrs[key] = clampNumber((state.attrs[key] ?? 0) + value, 0, 999, state.attrs[key] ?? 0)
    for (const [key, value] of Object.entries(course.skillGain ?? {})) state.education.skills[key] = clampNumber((state.education.skills[key] ?? 0) + value, 0, 100, state.education.skills[key] ?? 0)
    return { state, message: `${course.name}完成，学历/技能成长已更新` }
  }

  if (action === 'startJob') {
    const job = jobDefs[payload.jobId]
    if (!job) return { status: 400, error: '工作不存在' }
    if (state.runningJob) return { status: 400, error: '已经有工作在进行' }
    if (state.states.health < 30 || state.states.energy < job.energyCost) return { status: 400, error: '状态不足，先休息或治疗' }
    if ((state.attrs[job.attr] ?? 0) < job.minAttr) return { status: 400, error: '属性还不够，先学习提升' }
    if ((job.minGrade ?? 1) > state.education.grade) return { status: 400, error: '学历不足，先完成课程升年级' }
    if (!meetsSkills(state.education, job.minSkills)) return { status: 400, error: '技能不足，先学习对应技能' }
    state = {
      ...state,
      states: updatePetStates(state.states, { energy: -job.energyCost, hunger: -6, thirst: -7, sleep: -4 }),
      runningJob: { jobId: payload.jobId, endsAt: Date.now() + job.duration * 1000 },
    }
    return { state, message: `${job.name}开始了` }
  }

  if (action === 'completeJob') {
    if (!state.runningJob) return { status: 400, error: '没有进行中的工作' }
    const job = jobDefs[state.runningJob.jobId]
    if (!job) return { status: 400, error: '工作不存在' }
    if (Date.now() < state.runningJob.endsAt) return { status: 400, error: '工作还没有完成' }
    const exp = state.exp + job.rewardExp
    state = addTask({
      ...state,
      coins: state.coins + job.rewardCoin,
      exp,
      level: exp >= state.level * 160 ? state.level + 1 : state.level,
      states: updatePetStates(state.states, { mood: 4, social: 3 }),
      runningJob: undefined,
    }, 'work')
    return { state, message: `${job.name}完成，金币 +${job.rewardCoin}` }
  }

  if (action === 'addFriend') {
    const userCode = normalizeUserCode(cleanString(payload.name ?? payload.userCode, '', 24))
    if (!userCode) return { status: 400, error: '请输入好友邀请码' }
    const friendUser = findUserByCode(userCode)
    if (!friendUser) return { status: 404, error: '没有找到这个玩家邀请码' }
    if (friendUser.id === user.id) return { status: 400, error: '不能添加自己为好友' }
    if (state.friends.some((friend) => friend.id === friendUser.id || friend.userCode === friendUser.profile.userCode)) {
      return { status: 400, error: `${friendUser.profile.nickname} 已经是好友` }
    }
    const snapshot = friendSnapshot(friendUser)
    state = addTask({
      ...state,
      friends: [...state.friends, snapshot],
      friendsAdded: Array.from(new Set([...state.friendsAdded, snapshot.userCode])),
    }, 'social')
    return { state, message: `已添加 ${snapshot.name} 为好友` }
  }

  if (action === 'stealCrop') {
    const savedFriend = state.friends.find((entry) => entry.id === payload.friendId)
    const friendUser = savedFriend ? db.users[savedFriend.id] : undefined
    const friend = friendUser ? { ...friendSnapshot(friendUser), addedAt: savedFriend.addedAt } : savedFriend
    const cropKey = friend ? `${friend.id}:${friend.crop.id}` : ''
    if (!friend || !friend.crop.ready || state.stolenCrops.includes(cropKey)) return { status: 400, error: '这块地暂时不能收获' }
    state = addTask({
      ...state,
      friends: state.friends.map((entry) => (entry.id === friend.id ? friend : entry)),
      coins: state.coins + friend.crop.reward,
      stolenCrops: [...state.stolenCrops, cropKey],
    }, 'social')
    return { state, message: `从 ${friend.name} 的农场收获 ${friend.crop.reward} 金币` }
  }

  if (action === 'sendGift') {
    const name = cleanString(payload.name, '', 24)
    if (!name) return { status: 400, error: '请选择赠礼对象' }
    if (state.coins < 50) return { status: 400, error: '金币不足，暂时不能赠礼' }
    state = addTask({
      ...state,
      coins: state.coins - 50,
      giftsSent: [...state.giftsSent, name],
      states: updatePetStates(state.states, { social: 8, mood: 4 }),
    }, 'social')
    return { state, message: `已送给 ${name} 一份小礼物` }
  }

  if (action === 'visitVenue') {
    const name = cleanString(payload.venueName, '城市场景', 24)
    state = addTask(state, 'city')
    return { state, message: `进入${name}` }
  }

  if (action === 'sendMessage') {
    const text = cleanString(payload.message, '', 160)
    if (!text) return { status: 400, error: '请输入聊天内容' }
    if (hasUnsafePublicText(text)) return { status: 400, error: '聊天内容不能包含链接或联系方式' }
    const senderName = publicTextOrFallback(user.profile.nickname, '玩家')
    db.globalChat = [...cleanStringArray(db.globalChat, 100, 160), `${senderName}：${text}`].slice(-100)
    state = addTask({
      ...state,
      chat: db.globalChat,
    }, 'social')
    return { state, message: '消息已发送' }
  }

  if (action === 'parkCar') {
    const slot = slotDefs[payload.slotId]
    if (!slot) return { status: 400, error: '车位不存在' }
    const occupied = db.parkingSlots[payload.slotId]
    if (occupied?.userId && occupied.userId !== user.id) return { status: 400, error: '这个车位已经被占了' }
    if (state.parkedSlot && state.parkedSlot !== payload.slotId && db.parkingSlots[state.parkedSlot]?.userId === user.id) {
      delete db.parkingSlots[state.parkedSlot]
    }
    db.parkingSlots[payload.slotId] = { userId: user.id, parkedAt: Date.now() }
    state = addTask({
      ...state,
      parkedSlot: payload.slotId,
      parkedAt: db.parkingSlots[payload.slotId].parkedAt,
    }, 'social')
    return { state, message: `${slot.name}停车成功，收益开始累计` }
  }

  if (action === 'claimParking') {
    const pending = calculateParkingPending(state)
    if (pending <= 0) return { status: 400, error: '停车收益还在累计中' }
    state = {
      ...state,
      coins: state.coins + pending,
      parkedAt: Date.now(),
    }
    return { state, message: `停车收益领取成功，金币 +${pending}` }
  }

  if (action === 'claimTask') {
    const task = taskDefs[payload.taskId]
    if (!task) return { status: 400, error: '任务不存在' }
    if (!state.completedTasks.includes(payload.taskId)) return { status: 400, error: '任务还没有完成' }
    if (state.claimedTasks.includes(payload.taskId)) return { status: 400, error: '任务奖励已经领取' }
    state = {
      ...state,
      coins: state.coins + task.reward,
      claimedTasks: [...state.claimedTasks, payload.taskId],
    }
    return { state, message: `任务奖励已领取，金币 +${task.reward}` }
  }

  return { status: 400, error: '未知动作' }
}

const normalizeUserCode = (userCode) => normalizeText(userCode).toUpperCase()

const findUserByCode = (userCode) => {
  const normalized = normalizeUserCode(userCode)
  return Object.values(db.users).find((user) => user.profile.userCode.toUpperCase() === normalized)
}

const getBearerToken = (req) => {
  const authorization = req.headers.authorization ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

const getSessionUser = (req) => {
  const token = getBearerToken(req)
  const session = db.sessions[token]
  if (!session) return undefined
  const createdAt = Date.parse(session.createdAt)
  if (Number.isFinite(createdAt) && Date.now() - createdAt > sessionTtlMs) {
    delete db.sessions[token]
    saveDb()
    return undefined
  }
  return db.users[session.userId]
}

const destroySession = (req) => {
  const token = getBearerToken(req)
  if (!token || !db.sessions[token]) return false
  delete db.sessions[token]
  saveDb()
  return true
}

const publicUserPayload = (token, user) => ({
  token,
  profile: user.profile,
  state: decoratePublicState(sanitizeGameState(user.state, user), user),
})

const extensionForImage = (contentType) => {
  if (contentType === 'image/png') return '.png'
  if (contentType === 'image/jpeg') return '.jpg'
  if (contentType === 'image/webp') return '.webp'
  if (contentType === 'image/gif') return '.gif'
  return ''
}

const hasImageSignature = (buffer, contentType) => {
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  if (contentType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (contentType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
  if (contentType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

const apiRouteMethods = new Map([
  ['/api/health', ['GET', 'HEAD']],
  ['/api/register', ['POST']],
  ['/api/login', ['POST']],
  ['/api/session', ['GET']],
  ['/api/logout', ['POST']],
  ['/api/action', ['POST']],
  ['/api/state', ['PUT']],
  ['/api/upload', ['POST']],
])

const handleApi = async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const allowedMethods = apiRouteMethods.get(url.pathname)
    if (allowedMethods && !allowedMethods.includes(req.method ?? '')) {
      return methodNotAllowed(res, allowedMethods.join(', '))
    }

    if (['GET', 'HEAD'].includes(req.method ?? '') && url.pathname === '/api/health') {
      if (req.method === 'HEAD') return emptyJson(res, 200)
      return json(res, 200, {
        ok: true,
        uploadsReady: existsSync(uploadsDir),
        backupReady: existsSync(backupDbPath),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/register') {
      const { nickname = '', password = '', petName = '' } = await readJsonObject(req)
      const cleanNickname = cleanString(nickname, '', 16)
      const cleanPetName = cleanString(petName, '', 16)
      const passwordError = validatePasswordLength(password)
      if (!cleanNickname || cleanNickname.length > 16) return json(res, 400, { error: '昵称需为 1-16 个字符' })
      if (hasUnsafePublicText(cleanNickname) || (cleanPetName && hasUnsafePublicText(cleanPetName))) {
        return json(res, 400, { error: '昵称和宠物名不能包含链接或联系方式' })
      }
      if (passwordError) return json(res, 400, { error: passwordError })

      const userId = randomBytes(16).toString('hex')
      const profile = {
        nickname: cleanNickname,
        userCode: createUserCode(),
        createdAt: new Date().toISOString(),
      }
      const { algorithm, iterations, salt, hash } = hashPassword(String(password))
      const user = {
        id: userId,
        profile,
        passwordAlgorithm: algorithm,
        passwordIterations: iterations,
        passwordSalt: salt,
        passwordHash: hash,
        state: createInitialGameState(profile, cleanPetName),
        createdAt: profile.createdAt,
        updatedAt: profile.createdAt,
      }
      const token = randomBytes(24).toString('hex')
      db.users[userId] = user
      db.sessions[token] = { userId, createdAt: new Date().toISOString() }
      saveDb()
      return json(res, 201, publicUserPayload(token, user))
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const { userCode = '', password = '' } = await readJsonObject(req)
      const passwordError = validatePasswordLength(password)
      if (passwordError) return json(res, 400, { error: passwordError })
      const user = findUserByCode(userCode)
      if (!user || !verifyPassword(String(password), user)) return json(res, 401, { error: '邀请码或密码不正确' })
      const passwordUpgraded = upgradePasswordHash(String(password), user)
      const token = randomBytes(24).toString('hex')
      db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() }
      if (passwordUpgraded) user.updatedAt = new Date().toISOString()
      saveDb()
      return json(res, 200, publicUserPayload(token, user))
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const user = getSessionUser(req)
      if (!user) return json(res, 401, { error: '登录已失效，请重新登录' })
      return json(res, 200, publicUserPayload(getBearerToken(req), user))
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      destroySession(req)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const user = getSessionUser(req)
      if (!user) return json(res, 401, { error: '登录已失效，请重新登录' })
      const { action = '', payload = {} } = await readJsonObject(req)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json(res, 400, { error: '动作参数必须是对象' })
      }
      const result = await runAction(user, String(action), payload)
      if (result.error) return json(res, result.status ?? 400, { error: result.error })
      user.state = sanitizeGameState(result.state, user)
      user.updatedAt = new Date().toISOString()
      saveDb()
      return json(res, 200, { ok: true, state: decoratePublicState(user.state, user), message: result.message })
    }

    if (req.method === 'PUT' && url.pathname === '/api/state') {
      const user = getSessionUser(req)
      if (!user) return json(res, 401, { error: '登录已失效，请重新登录' })
      const { state } = await readJsonObject(req)
      if (!state || typeof state !== 'object') return json(res, 400, { error: '存档内容无效' })
      const requestedPetName = state.petName === undefined ? '' : cleanString(state.petName, '', 16)
      if (requestedPetName && hasUnsafePublicText(requestedPetName)) {
        return json(res, 400, { error: '宠物名不能包含链接或联系方式' })
      }
      user.state = mergeClientStateUpdate(state, user)
      user.updatedAt = new Date().toISOString()
      saveDb()
      return json(res, 200, { ok: true, state: decoratePublicState(user.state, user) })
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const user = getSessionUser(req)
      if (!user) return json(res, 401, { error: '登录已失效，请重新登录' })
      const { fileName = 'upload', contentType = '', dataUrl = '' } = await readJsonObject(req)
      const ext = extensionForImage(String(contentType))
      if (!ext || !String(dataUrl).startsWith(`data:${contentType};base64,`)) {
        return json(res, 400, { error: '请上传 png、jpg、webp 或 gif 图片' })
      }
      const base64 = String(dataUrl).split(',')[1] ?? ''
      const buffer = Buffer.from(base64, 'base64')
      if (!buffer.length || buffer.length > 4 * 1024 * 1024) return json(res, 400, { error: '图片需小于 4MB' })
      if (!hasImageSignature(buffer, String(contentType))) return json(res, 400, { error: '图片内容与格式不匹配' })
      const uploadName = `${randomBytes(16).toString('hex')}${ext}`
      writeFileSync(join(uploadsDir, uploadName), buffer)
      const publicUrl = `/uploads/${uploadName}`
      removeUploadByUrl(user.state?.uploadedPreviewUrl)
      removeGeneratedPetByUrl(user.state?.generatedPetUrl)
      user.state = {
        ...user.state,
        generated: false,
        uploadedFileName: cleanString(fileName, 'upload', 120),
        uploadedPreviewUrl: publicUrl,
        generatedPetUrl: undefined,
      }
      user.updatedAt = new Date().toISOString()
      saveDb()
      return json(res, 201, {
        fileName: user.state.uploadedFileName,
        url: publicUrl,
        state: decoratePublicState(user.state, user),
      })
    }

    return json(res, 404, { error: '接口不存在' })
  } catch (error) {
    console.error(error)
    if (error instanceof Error && error.message === '请求体过大') return json(res, 413, { error: '请求体过大' })
    if (error instanceof Error && error.message === '请求类型必须是 application/json') return json(res, 415, { error: error.message })
    if (error instanceof Error && error.message === 'JSON 请求体无效') return json(res, 400, { error: error.message })
    if (error instanceof Error && error.message === 'JSON 请求体必须是对象') return json(res, 400, { error: error.message })
    return json(res, 500, { error: '服务器处理失败' })
  }
}

const serveFile = (req, res, filePath) => {
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  if (!existsSync(filePath)) return false
  try {
    if (!statSync(filePath).isFile()) return false
  } catch {
    return false
  }
  res.writeHead(200, {
    ...securityHeaders,
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  })
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  createReadStream(filePath).pipe(res)
  return true
}

const methodNotAllowed = (res, allow = 'GET, HEAD') => {
  res.writeHead(405, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Allow: allow,
  })
  res.end(JSON.stringify({ error: '请求方法不允许' }))
}

const isInsideDir = (parent, child) => {
  const path = relative(parent, child)
  return path && !path.startsWith('..') && !path.startsWith('/') && !path.includes('..\\')
}

const resolveStaticPath = (pathname) => {
  if (pathname === '/') return join(distDir, 'index.html')
  try {
    return resolve(distDir, `.${decodeURIComponent(pathname)}`)
  } catch {
    return undefined
  }
}

const isRateLimited = (req) => {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : ''
  const key = forwarded || req.socket.remoteAddress || 'local'
  const now = Date.now()
  for (const [bucketKey, bucket] of rateBuckets.entries()) {
    if (now - bucket.startedAt > rateWindowMs) rateBuckets.delete(bucketKey)
  }
  const bucket = rateBuckets.get(key)
  if (!bucket || now - bucket.startedAt > rateWindowMs) {
    rateBuckets.set(key, { count: 1, startedAt: now })
    return false
  }
  bucket.count += 1
  return bucket.count > maxRequestsPerWindow
}

const server = http.createServer((req, res) => {
  if (isRateLimited(req)) {
    json(res, 429, { error: '请求过于频繁，请稍后再试' })
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...securityHeaders,
      'Cache-Control': 'no-store',
    })
    res.end()
    return
  }
  const rawPath = String(req.url ?? '/').split('?')[0]
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (url.pathname.startsWith('/api/')) {
    void handleApi(req, res)
    return
  }
  if (!['GET', 'HEAD'].includes(req.method ?? '')) {
    methodNotAllowed(res)
    return
  }
  if (rawPath.startsWith('/uploads/')) {
    if (!/^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(rawPath)) {
      json(res, 404, { error: '文件不存在' })
      return
    }
    const uploadPath = join(uploadsDir, basename(rawPath))
    if (!serveFile(req, res, uploadPath)) json(res, 404, { error: '文件不存在' })
    return
  }
  if (rawPath.startsWith('/generated-pets/')) {
    if (!/^\/generated-pets\/[a-f0-9]{32}\.(svg|png|jpg|jpeg|webp)$/.test(rawPath)) {
      json(res, 404, { error: '文件不存在' })
      return
    }
    const petPath = join(generatedPetsDir, basename(rawPath))
    if (!serveFile(req, res, petPath)) json(res, 404, { error: '文件不存在' })
    return
  }
  const staticPath = resolveStaticPath(url.pathname)
  if (!staticPath || !isInsideDir(distDir, staticPath)) {
    json(res, 404, { error: '文件不存在' })
    return
  }
  if (serveFile(req, res, staticPath)) return
  if (extname(staticPath)) {
    json(res, 404, { error: '文件不存在' })
    return
  }
  if (existsSync(join(distDir, 'index.html'))) {
    serveFile(req, res, join(distDir, 'index.html'))
    return
  }
  json(res, 200, { ok: true, service: 'Moyo Planet API' })
})

server.listen(port, host, () => {
  console.log(`Moyo Planet server listening on http://${host}:${port}`)
})
