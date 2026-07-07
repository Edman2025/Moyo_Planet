import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 5195
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'moyo-journey-'))
let output = ''
let server

const startServer = () => {
  output = ''
  server = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  server.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  server.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
}

startServer()

const stopServer = async () => {
  if (!server || server.killed) return
  server.kill('SIGTERM')
  await new Promise((resolve) => server.on('exit', resolve))
}

const cleanup = () => {
  server?.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

const waitForServer = async () => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/session`)
      if (response.status === 401) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`journey server did not start:\n${output}`)
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

const rawRequest = (path, options = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
  })

const mutateUserState = (userCode, updater) => {
  const dbPath = join(dataDir, 'moyo-db.json')
  const db = JSON.parse(readFileSync(dbPath, 'utf8'))
  const user = Object.values(db.users).find((entry) => entry.profile.userCode === userCode)
  if (!user) throw new Error(`missing user ${userCode}`)
  user.state = updater(user.state)
  user.updatedAt = new Date().toISOString()
  writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

const pngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

try {
  await waitForServer()

  const player = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '旅程玩家', petName: '旅程萌友', password: 'journey123' }),
  }, 201)
  const friend = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: '旅程好友', petName: '好友萌友', password: 'journey123' }),
  }, 201)

  if (player.state.friends.length || player.state.chat.length || Object.values(player.state.parkingSlots).some((slot) => slot.occupied)) {
    throw new Error('fresh player journey started with seeded social data')
  }

  const upload = await request('/api/upload', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ fileName: 'journey.png', contentType: 'image/png', dataUrl: pngDataUrl }),
  }, 201)
  if (!upload.state.uploadedPreviewUrl || !(await rawRequest(upload.url)).ok) throw new Error('photo upload journey failed')

  const generated = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'generatePet', payload: {} }),
  })
  if (!generated.state.generated || generated.state.gems !== 70 || !generated.state.generatedPetUrl) throw new Error('pet generation journey failed')
  const generatedImage = await rawRequest(generated.state.generatedPetUrl)
  if (!generatedImage.ok || !generatedImage.headers.get('content-type')?.includes('image/svg+xml')) {
    throw new Error('photo-based pet generation did not create a served SVG image')
  }

  const fed = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'care', payload: { kind: 'feed' } }),
  })
  if (!fed.state.runningCare || fed.state.completedTasks.includes('feed')) throw new Error('care journey should start a timed action before task completion')
  mutateUserState(player.profile.userCode, (state) => ({
    ...state,
    runningCare: { ...state.runningCare, endsAt: Date.now() - 1000 },
  }))
  await stopServer()
  startServer()
  await waitForServer()
  const completedCare = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'completeCare', payload: {} }),
  })
  if (completedCare.state.runningCare || !completedCare.state.completedTasks.includes('feed')) throw new Error('care journey did not complete feed task after time passed')

  const bought = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'buyItem', payload: { itemId: 'water' } }),
  })
  const used = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'useItem', payload: { itemId: 'water' } }),
  })
  if (used.state.inventory.water !== bought.state.inventory.water - 1) throw new Error('shop inventory journey failed')

  const studied = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'studyCourse', payload: { courseId: 'school-grade' } }),
  })
  if (studied.state.education.grade !== 2 || studied.state.education.credits !== 18) throw new Error('education journey failed')

  const startedJob = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'startJob', payload: { jobId: 'runner' } }),
  })
  if (startedJob.state.runningJob?.jobId !== 'runner') throw new Error('unlocked job journey failed')
  mutateUserState(player.profile.userCode, (state) => ({
    ...state,
    runningJob: { ...state.runningJob, endsAt: Date.now() - 1000 },
  }))
  await stopServer()
  startServer()
  await waitForServer()
  const completedJob = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'completeJob', payload: {} }),
  })
  if (completedJob.state.runningJob || !completedJob.state.completedTasks.includes('work')) throw new Error('job completion journey failed')

  const chatted = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'sendMessage', payload: { message: '第一天开工' } }),
  })
  if (!chatted.state.chat.at(-1).includes('第一天开工')) throw new Error('city chat journey failed')

  const friended = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'addFriend', payload: { name: friend.profile.userCode.toLowerCase() } }),
  })
  const addedFriend = friended.state.friends.find((entry) => entry.userCode === friend.profile.userCode)
  if (!addedFriend) throw new Error('real invite-code friend journey failed')

  const harvested = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'stealCrop', payload: { friendId: addedFriend.id } }),
  })
  if (harvested.state.stolenCrops.length !== 1) throw new Error('friend farm journey failed')

  const gifted = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'sendGift', payload: { name: addedFriend.name } }),
  })
  if (!gifted.state.giftsSent.includes(addedFriend.name)) throw new Error('gift journey failed')

  const parked = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'parkCar', payload: { slotId: 'a1' } }),
  })
  if (!parked.state.parkingSlots.a1.occupiedByMe) throw new Error('parking journey failed')
  const friendView = await request('/api/session', { method: 'GET', token: friend.token })
  if (!friendView.state.parkingSlots.a1.occupied || friendView.state.parkingSlots.a1.occupiedByMe) {
    throw new Error('shared parking was not visible to another real player')
  }

  const claimed = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'claimTask', payload: { taskId: 'feed' } }),
  })
  if (!claimed.state.claimedTasks.includes('feed')) throw new Error('task reward journey failed')

  const reset = await request('/api/action', {
    method: 'POST',
    token: player.token,
    body: JSON.stringify({ action: 'resetProgress', payload: {} }),
  })
  if (reset.state.friends.length || reset.state.uploadedPreviewUrl || reset.state.generatedPetUrl || reset.state.parkedSlot) {
    throw new Error(`reset journey did not clear user progress, upload, and parking: ${JSON.stringify({
      friends: reset.state.friends.length,
      uploadedPreviewUrl: reset.state.uploadedPreviewUrl,
      generatedPetUrl: reset.state.generatedPetUrl,
      parkedSlot: reset.state.parkedSlot,
    })}`)
  }
  if (readdirSync(join(dataDir, 'uploads')).length) throw new Error('journey reset left uploaded files behind')
  if (readdirSync(join(dataDir, 'generated-pets')).length) throw new Error('journey reset left generated pet files behind')

  console.log('journey verify: ok')
} finally {
  cleanup()
}
