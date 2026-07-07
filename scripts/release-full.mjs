import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${npmCommand} ${args.join(' ')} exited with ${code}`))
    })
    child.on('error', reject)
  })

try {
  await run(['run', 'release:check'])
  await run(['run', 'verify:docker-build'])
  await run(['run', 'verify:docker-runtime'])
  await run(['run', 'verify:clean-data'])
  console.log('full release check: ok')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
