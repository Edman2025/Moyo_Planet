import { spawn } from 'node:child_process'

const processes = [
  spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: process.env.API_PORT ?? '4173' },
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    env: { ...process.env },
    stdio: 'inherit',
  }),
]

const shutdown = () => {
  for (const child of processes) child.kill('SIGTERM')
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

for (const child of processes) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown()
      process.exit(code)
    }
  })
}
