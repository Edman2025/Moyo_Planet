import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fail = (message) => {
  console.error(`clean data verify failed: ${message}`)
  process.exit(1)
}

const read = (path) => {
  if (!existsSync(path)) fail(`${path} is missing`)
  return readFileSync(path, 'utf8')
}

const requireIncludes = (label, text, values) => {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label} must include ${value}`)
  }
}

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
  if (leakedFiles.length) {
    fail(`local data directory contains files: ${leakedFiles.slice(0, 10).join(', ')}`)
  }
}

requireIncludes('.gitignore', read('.gitignore'), ['data'])
requireIncludes('.dockerignore', read('.dockerignore'), ['data'])

console.log('clean data verify: ok')
