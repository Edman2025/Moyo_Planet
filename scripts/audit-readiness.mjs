import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fail = (message) => {
  console.error(`readiness audit failed: ${message}`)
  process.exit(1)
}

const read = (path) => {
  if (!existsSync(path)) fail(`${path} is missing`)
  return readFileSync(path, 'utf8')
}

const requireIncludes = (label, text, values) => {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label} must mention ${value}`)
  }
}

const requireMatch = (label, text, pattern) => {
  if (!pattern.test(text)) fail(`${label} does not match ${pattern}`)
}

const requiredFiles = [
  'src/App.tsx',
  'src/App.css',
  'server/index.mjs',
  'scripts/verify.mjs',
  'scripts/verify-journey.mjs',
  'scripts/verify-ui.mjs',
  'scripts/verify-docker-context.mjs',
  'scripts/verify-docker-build.mjs',
  'scripts/verify-docker-runtime.mjs',
  'scripts/verify-secrets.mjs',
  'scripts/verify-dependencies.mjs',
  'scripts/verify-install.mjs',
  'scripts/verify-clean-data.mjs',
  'scripts/check-production.mjs',
  'scripts/release-check.mjs',
  'scripts/release-full.mjs',
  'Dockerfile',
  'compose.yaml',
  '.dockerignore',
  '.gitignore',
  '.env.example',
  '.github/workflows/release-check.yml',
  'README.md',
  'docs/release-requirements.json',
  'docs/release-readiness.md',
]

for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`${file} is missing`)
}

const packageJson = JSON.parse(read('package.json'))
for (const script of ['lint', 'build', 'verify', 'verify:journey', 'verify:ui', 'verify:docker-context', 'verify:docker-build', 'verify:docker-runtime', 'verify:secrets', 'verify:dependencies', 'verify:install', 'verify:clean-data', 'start', 'release:check', 'release:full', 'audit:readiness']) {
  if (!packageJson.scripts?.[script]) fail(`package.json is missing ${script} script`)
}

const appSource = read('src/App.tsx')
const serverSource = read('server/index.mjs')
const readme = read('README.md')
const dockerfile = read('Dockerfile')
const compose = read('compose.yaml')
const dockerignore = read('.dockerignore')
const gitignore = read('.gitignore')
const envExample = read('.env.example')
const githubWorkflow = read('.github/workflows/release-check.yml')
const releaseRequirements = JSON.parse(read('docs/release-requirements.json'))
const releaseReadiness = read('docs/release-readiness.md')
const releaseCheckSource = read('scripts/release-check.mjs')
const releaseFullSource = read('scripts/release-full.mjs')

const placeholderPattern = /正式版|继续接入|TODO|占位|mock|fake|可发布|可发起|加成场景/
if (placeholderPattern.test(appSource)) fail('frontend source contains placeholder or future-version copy')

const seedDataPattern = /seed|demo|sample|mock|fake|fixture|测试用户|示例用户|假用户/
if (seedDataPattern.test(serverSource) || seedDataPattern.test(appSource)) {
  fail('source contains seed/demo/mock/fake user-data language')
}

requireIncludes('README', readme, [
  '玩家注册/登录',
  '上传照片生成宠物',
  '学习升年级',
  '技能养成',
  '高薪工作随学历和技能解锁',
  '真实玩家邀请码',
  'DATA_DIR',
  'npm run release:check',
])

if (!Array.isArray(releaseRequirements.requirements) || releaseRequirements.requirements.length < 8) {
  fail('release requirements manifest must describe the core release requirements')
}

const requiredRequirementIds = [
  'real-registration-login',
  'server-authoritative-progress',
  'photo-upload-pet-generation',
  'learning-job-progression',
  'social-real-users-only',
  'no-test-or-fake-data',
  'production-hardening',
  'release-gate',
]
for (const id of requiredRequirementIds) {
  const requirement = releaseRequirements.requirements.find((entry) => entry.id === id)
  if (!requirement) fail(`release requirements manifest is missing ${id}`)
  if (!Array.isArray(requirement.evidence) || !requirement.evidence.length) {
    fail(`release requirement ${id} is missing evidence commands`)
  }
  for (const command of requirement.evidence) {
    const match = /^npm run ([a-z:-]+)$/.exec(command)
    if (!match) fail(`release requirement ${id} has unsupported evidence command: ${command}`)
    const scriptName = match[1]
    if (!packageJson.scripts?.[scriptName]) {
      fail(`release requirement ${id} references missing package script: ${scriptName}`)
    }
  }
}

for (const requiredGate of ['audit:readiness', 'verify:clean-data', 'verify:install', 'verify:secrets', 'verify:dependencies', 'lint', 'build', 'verify', 'verify:journey', 'verify:ui', 'verify:docker-context']) {
  requireIncludes('release-check gate', releaseCheckSource, [`'${requiredGate}'`])
}
requireIncludes('release-check production smoke', releaseCheckSource, [
  '/api/register',
  '/api/session',
  'moyo-db.json',
  'pbkdf2-sha256',
])
requireIncludes('full release gate', releaseFullSource, [
  'release:check',
  'verify:docker-build',
  'verify:docker-runtime',
  'verify:clean-data',
])

requireIncludes('server', serverSource, [
  'pbkdf2-sha256',
  'DATA_DIR',
  '/api/register',
  '/api/login',
  '/api/upload',
  '/api/health',
  'HEAD',
  'randomBytes(16).toString',
])
requireMatch('server upload validation', serverSource, /buffer\.length > 4 \* 1024 \* 1024/)
requireMatch('server strict upload URL validation', serverSource, /\/uploads\\\/\[a-f0-9\]\{32\}\\\.\(png\|jpg\|webp\|gif\)/)
requireMatch('server authoritative state', serverSource, /mergeClientStateUpdate/)
requireMatch('server public text hardening', serverSource, /hasUnsafePublicText/)
requireMatch('server password max length', serverSource, /maxPasswordLength = 128/)
requireMatch('server empty user database', serverSource, /const defaultDb = \{\s*users: \{\},\s*sessions: \{\},\s*globalChat: \[\],\s*parkingSlots: \{\},\s*\}/s)
requireMatch('server empty initial social state', serverSource, /friends: \[\],\s*friendsAdded: \[\],\s*giftsSent: \[\],\s*runningCare: undefined,\s*runningJob: undefined,\s*chat: \[\]/s)
requireMatch('frontend empty initial social state', appSource, /friends: \[\],\s*friendsAdded: \[\],\s*giftsSent: \[\],\s*runningCare: undefined,\s*runningJob: undefined,\s*chat: \[\]/s)
requireMatch('frontend API status errors', appSource, /class ApiError extends Error/)
requireMatch('frontend expired session cleanup', appSource, /error instanceof ApiError && error\.status === 401/)
requireMatch('frontend password max length', appSource, /MAX_PASSWORD_LENGTH = 128/)

requireIncludes('Dockerfile', dockerfile, ['NODE_ENV=production', 'DATA_DIR=/data', 'npm", "run", "start'])
requireIncludes('compose.yaml', compose, ['DATA_DIR: /data', 'moyo_data:/data', '4173:4173'])
for (const ignored of ['node_modules', 'dist', 'data', '.git', 'progress.md']) {
  requireIncludes('.dockerignore', dockerignore, [ignored])
}
requireIncludes('Dockerfile runtime scripts', dockerfile, ['COPY scripts/check-production.mjs ./scripts/check-production.mjs'])
for (const ignored of ['node_modules', 'dist', 'data']) {
  requireIncludes('.gitignore', gitignore, [ignored])
}
requireIncludes('.env.example', envExample, ['DATA_DIR=', 'SESSION_TTL_DAYS=', 'RATE_LIMIT_MAX=', 'TRUST_PROXY=', 'PUBLIC_BASE_URL=', 'MINIMAX_API_KEY='])
requireIncludes('GitHub release workflow', githubWorkflow, [
  'actions/checkout@v4',
  'actions/setup-node@v4',
  'node-version: 24',
  'npm ci',
  'npm run release:check',
  'npm run verify:docker-build',
  'npm run verify:docker-runtime',
])
requireIncludes('release readiness checklist', releaseReadiness, [
  'npm run release:check',
  'npm run verify:docker-build',
  'npm run verify:docker-runtime',
  'DATA_DIR',
  'moyo_data',
  'TRUST_PROXY=1',
  'data/',
  'GitHub Actions',
])

if (existsSync('data')) {
  const leakedFiles = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else leakedFiles.push(path)
    }
  }
  walk('data')
  if (leakedFiles.length) fail(`local data directory contains files: ${leakedFiles.slice(0, 5).join(', ')}`)
}

console.log('readiness audit: ok')
