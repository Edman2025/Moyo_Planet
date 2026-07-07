import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fail = (message) => {
  console.error(`secret verify failed: ${message}`)
  process.exit(1)
}

const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'data', 'coverage'])
const ignoredFiles = new Set(['package-lock.json'])

const patterns = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
  { name: 'OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe live key', pattern: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
]

const isBinary = (buffer) => buffer.includes(0)

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (dir === '.' && ignoredDirs.has(entry)) continue
    const path = dir === '.' ? entry : join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry)) walk(path)
      continue
    }
    if (!stat.isFile() || ignoredFiles.has(entry)) continue
    files.push(path)
  }
}

walk('.')

const findings = []
for (const file of files) {
  const buffer = readFileSync(file)
  if (isBinary(buffer)) continue
  const text = buffer.toString('utf8')
  for (const { name, pattern } of patterns) {
    const match = pattern.exec(text)
    if (match) findings.push(`${file}: ${name}`)
  }
}

if (findings.length) fail(`possible committed secrets found:\n${findings.join('\n')}`)
if (!existsSync('.env.example')) fail('.env.example is missing')

console.log('secret verify: ok')
