import { spawnSync } from 'node:child_process'

const fail = (message) => {
  console.error(`docker build verify failed: ${message}`)
  process.exit(1)
}

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    error: result.error,
  }
}

const compose = run('docker', ['compose', 'config'])
if (compose.error) fail(`docker command is unavailable: ${compose.error.message}`)
if (compose.status !== 0) fail(`docker compose config failed:\n${compose.output}`)

const tag = process.env.DOCKER_VERIFY_TAG || `moyo-planet:verify-${process.pid}`
const build = run('docker', ['build', '-t', tag, '.'])
if (build.error) fail(`docker command is unavailable: ${build.error.message}`)
if (build.status !== 0) {
  if (/docker API|docker daemon|Cannot connect|connect: no such file|permission denied/i.test(build.output)) {
    fail(`Docker daemon is unavailable, so the image build could not be proven on this machine:\n${build.output}`)
  }
  fail(`docker build failed:\n${build.output}`)
}

console.log(`docker build verify: ok (${tag})`)
