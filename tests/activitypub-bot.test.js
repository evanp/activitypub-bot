import { describe, it } from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = resolve(__dirname, '..', 'bin', 'activitypub-bot.js')
const TEST_PORT = 9099
const TEST_ORIGIN = `http://localhost:${TEST_PORT}`

function runScript (args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, NODE_ENV: 'test', ...env }
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
    proc.on('error', reject)
  })
}

async function waitForServer (port, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/livez`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Server did not start in time')
}

describe('activitypub-bot CLI', () => {
  describe('--help', () => {
    let result = null

    it('should run without error', async () => {
      result = await runScript(['--help'])
    })

    it('should exit with code 0', () => {
      assert.strictEqual(result.exitCode, 0)
    })

    it('should output usage information', () => {
      assert.match(result.stdout, /Usage:/)
    })

    it('should list all options', () => {
      assert.match(result.stdout, /--database-url/)
      assert.match(result.stdout, /--origin/)
      assert.match(result.stdout, /--port/)
      assert.match(result.stdout, /--bots-config-file/)
      assert.match(result.stdout, /--log-level/)
      assert.match(result.stdout, /--delivery/)
      assert.match(result.stdout, /--distribution/)
      assert.match(result.stdout, /--index-file/)
    })
  })

  describe('-h shorthand', () => {
    let result = null

    it('should run without error', async () => {
      result = await runScript(['-h'])
    })

    it('should exit with code 0', () => {
      assert.strictEqual(result.exitCode, 0)
    })

    it('should output usage information', () => {
      assert.match(result.stdout, /Usage:/)
    })
  })

  describe('server startup and shutdown', () => {
    let proc = null

    it('should start and respond to health checks', async () => {
      proc = spawn(process.execPath, [BIN, '--port', String(TEST_PORT), '--origin', TEST_ORIGIN], {
        env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info' }
      })
      proc.stderr.on('data', () => {})
      await waitForServer(TEST_PORT)
      const res = await fetch(`http://localhost:${TEST_PORT}/livez`)
      assert.strictEqual(res.status, 200)
    })

    it('should respond to readyz', async () => {
      const res = await fetch(`http://localhost:${TEST_PORT}/readyz`)
      assert.strictEqual(res.status, 200)
    })

    it('should shut down gracefully on SIGTERM', async () => {
      const exitPromise = new Promise((resolve) => proc.on('close', resolve))
      proc.kill('SIGTERM')
      const exitCode = await exitPromise
      assert.strictEqual(exitCode, 0)
      proc = null
    })
  })
})
