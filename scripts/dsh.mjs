import { execFileSync, spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(projectRoot, 'integrations/deepseek-harness')
const nodeVersion = '22.19.0'
const dshVersion = '0.1.0-rc.6'

function resolveCommand(command, args) {
  return execFileSync(command, args, {
    cwd: harnessRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
}

const compatibleNode = resolveCommand('npx', ['--yes', `node@${nodeVersion}`, '-p', 'process.execPath'])
const dshBin = resolveCommand('npx', ['--yes', '-p', `@deepseek-ai/dsh@${dshVersion}`, 'sh', '-c', 'command -v dsh'])
const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node scripts/dsh.mjs <dsh command...>')
  process.exit(1)
}

console.log(`[dsh] Node ${nodeVersion} · DSH ${dshVersion} · cwd integrations/deepseek-harness`)
const child = spawn(compatibleNode, [dshBin, ...args], {
  cwd: harnessRoot,
  env: process.env,
  stdio: 'inherit',
})

child.on('error', error => {
  console.error(`[dsh] Không thể khởi động: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
