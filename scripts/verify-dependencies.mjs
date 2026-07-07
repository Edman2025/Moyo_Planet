import { spawnSync } from 'node:child_process'

const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (result.status !== 0) {
  console.error('dependency verify failed: production dependency audit found high or critical issues')
  process.stderr.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

process.stdout.write(result.stdout)
if (!result.stdout.includes('found 0 vulnerabilities')) {
  console.log('dependency verify: ok')
}
