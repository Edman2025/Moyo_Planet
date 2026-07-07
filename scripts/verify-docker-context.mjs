import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fail = (message) => {
  console.error(`docker context verify failed: ${message}`)
  process.exit(1)
}

if (!existsSync('.dockerignore')) fail('.dockerignore is missing')

const tarPath = join(tmpdir(), `moyo-context-${process.pid}-${Date.now()}.tar`)
const create = spawnSync('tar', ['--exclude-from=.dockerignore', '-cf', tarPath, '.'], {
  encoding: 'utf8',
})
if (create.status !== 0) {
  rmSync(tarPath, { force: true })
  fail(`tar creation failed: ${create.stderr || create.stdout}`)
}

const list = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8' })
rmSync(tarPath, { force: true })
if (list.status !== 0) fail(`tar listing failed: ${list.stderr || list.stdout}`)

const entries = list.stdout.split('\n').filter(Boolean)
const normalized = entries.map((entry) => entry.replace(/^\.\//, ''))

const forbidden = [
  /^node_modules(?:\/|$)/,
  /^dist(?:\/|$)/,
  /^data(?:\/|$)/,
  /^\.git(?:\/|$)/,
  /^progress\.md$/,
  /^\.env$/,
]

for (const entry of normalized) {
  if (forbidden.some((pattern) => pattern.test(entry))) {
    fail(`forbidden path included in Docker context: ${entry}`)
  }
}

const required = [
  'package.json',
  'package-lock.json',
  'src/App.tsx',
  'server/index.mjs',
  'scripts/check-production.mjs',
  'Dockerfile',
  'compose.yaml',
]

for (const path of required) {
  if (!normalized.includes(path)) fail(`required path missing from Docker context: ${path}`)
}

console.log('docker context verify: ok')
