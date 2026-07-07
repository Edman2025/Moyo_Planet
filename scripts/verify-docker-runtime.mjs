import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fail = (message) => {
  console.error(`docker runtime verify failed: ${message}`)
  process.exit(1)
}

const runSync = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) fail(`${command} is unavailable: ${result.error.message}`)
  if (result.status !== 0) {
    if (/docker API|docker daemon|Cannot connect|connect: no such file|permission denied/i.test(output)) {
      fail(`Docker daemon is unavailable, so the container runtime could not be proven on this machine:\n${output}`)
    }
    fail(`${command} ${args.join(' ')} failed:\n${output}`)
  }
  return output
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('could not allocate a local port'))
      })
    })
    server.on('error', reject)
  })

const waitForHealth = async (baseUrl, output) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      const payload = await response.json()
      if (response.status === 200 && payload.ok && payload.uploadsReady) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`container did not become healthy:\n${output()}`)
}

const postJson = async (baseUrl, path, body, expectedStatus) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (response.status !== expectedStatus) {
    throw new Error(`${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

const tag = process.env.DOCKER_VERIFY_TAG || `moyo-planet:runtime-${process.pid}`
const name = `moyo-planet-runtime-${process.pid}`
const dataDir = mkdtempSync(join(tmpdir(), 'moyo-docker-runtime-'))
const port = await freePort()
let output = ''
let child

try {
  runSync('docker', ['compose', 'config'])
  runSync('docker', ['build', '-t', tag, '.'])

  child = spawn('docker', [
    'run',
    '--name',
    name,
    '--rm',
    '-p',
    `127.0.0.1:${port}:4173`,
    '-v',
    `${dataDir}:/data`,
    '-e',
    'NODE_ENV=production',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=4173',
    '-e',
    'DATA_DIR=/data',
    tag,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exited = new Promise((resolve) => child.on('exit', resolve))
  child.on('error', (error) => fail(`docker run failed to start: ${error.message}`))

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHealth(baseUrl, () => output)
  const index = await fetch(`${baseUrl}/`)
  const html = await index.text()
  if (index.status !== 200 || !html.includes('萌友星球')) {
    throw new Error(`container did not serve the production app shell: ${index.status}`)
  }
  const registered = await postJson(baseUrl, '/api/register', {
    nickname: '容器验收玩家',
    petName: '容器萌友',
    password: 'docker-runtime-123',
  }, 201)
  const session = await fetch(`${baseUrl}/api/session`, {
    headers: { Authorization: `Bearer ${registered.token}` },
  })
  const sessionPayload = await session.json()
  if (session.status !== 200 || sessionPayload.profile?.nickname !== '容器验收玩家') {
    throw new Error(`container session restore failed: ${session.status} ${JSON.stringify(sessionPayload)}`)
  }
  const dbPath = join(dataDir, 'moyo-db.json')
  if (!existsSync(dbPath)) throw new Error('container did not persist moyo-db.json to the mounted DATA_DIR')
  const db = JSON.parse(readFileSync(dbPath, 'utf8'))
  const user = Object.values(db.users ?? {}).find((entry) => entry.profile?.userCode === registered.profile.userCode)
  if (!user || user.passwordAlgorithm !== 'pbkdf2-sha256') {
    throw new Error('container persisted user is missing or password storage is not hardened')
  }

  child.kill('SIGTERM')
  await exited
  console.log(`docker runtime verify: ok (${tag})`)
} catch (error) {
  if (child?.exitCode === null) {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
  }
  fail(error instanceof Error ? error.message : String(error))
} finally {
  if (child?.exitCode === null) {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
  }
  rmSync(dataDir, { recursive: true, force: true })
}
