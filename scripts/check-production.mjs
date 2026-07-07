import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const isProduction = process.env.NODE_ENV === 'production'
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : ''
const distDir = resolve('dist')

const fail = (message) => {
  console.error(`production check failed: ${message}`)
  process.exit(1)
}

const positiveNumber = (name, fallback) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${name} must be a positive number.`)
  return parsed
}

const booleanFlag = (name) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return false
  if (!['0', '1', 'true', 'false', 'yes', 'no'].includes(raw.toLowerCase())) {
    fail(`${name} must be 0/1, true/false, yes/no, or empty.`)
  }
  return ['1', 'true', 'yes'].includes(raw.toLowerCase())
}

if (!existsSync(join(distDir, 'index.html'))) {
  fail('dist/index.html is missing. Run npm run build before npm run start.')
}

if (isProduction && !dataDir) {
  fail('DATA_DIR is required when NODE_ENV=production.')
}

if (dataDir) {
  mkdirSync(join(dataDir, 'uploads'), { recursive: true })
  const probe = join(dataDir, `.write-check-${Date.now()}`)
  try {
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
  } catch {
    fail(`DATA_DIR is not writable: ${dataDir}`)
  }
}

const port = Number(process.env.PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65_535) fail('PORT must be between 1 and 65535.')
positiveNumber('SESSION_TTL_DAYS', 30)
positiveNumber('RATE_LIMIT_MAX', 180)
positiveNumber('RATE_LIMIT_WINDOW_MS', 60_000)
booleanFlag('TRUST_PROXY')

console.log('production check: ok')
