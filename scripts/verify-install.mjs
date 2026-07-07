import { spawnSync } from 'node:child_process'

const result = spawnSync('npm', ['ci', '--dry-run', '--ignore-scripts'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (result.status !== 0) {
  console.error('install verify failed: package-lock.json is not cleanly installable with npm ci')
  process.stderr.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

console.log('install verify: ok')
