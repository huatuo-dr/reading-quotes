import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export type GitSyncResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

let lastFailure: { at: string; message: string } | null = null
let chain: Promise<unknown> = Promise.resolve()

export function getGitStatus() {
  return { lastFailure }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function git(args: string[], env?: NodeJS.ProcessEnv) {
  return execFileAsync('git', args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024,
  })
}

export function syncQuotesToRemote(action: 'add' | 'update' | 'delete', id: string): Promise<GitSyncResult> {
  return enqueue(async () => {
    if (process.env.GIT_ENABLED === 'false') {
      lastFailure = null
      return { ok: true, message: 'git sync disabled' }
    }

    const token = process.env.GIT_TOKEN?.trim()
    const branch = process.env.GIT_BRANCH || 'main'
    const name = process.env.GIT_USER_NAME || 'reading-quotes-bot'
    const email = process.env.GIT_USER_EMAIL || 'bot@users.noreply.github.com'

    try {
      await git(['config', 'user.name', name])
      await git(['config', 'user.email', email])
      await git(['add', 'data/quotes.json'])
      const status = await git(['status', '--porcelain', 'data/quotes.json'])
      if (!status.stdout.trim()) {
        lastFailure = null
        return { ok: true, message: 'nothing to commit' }
      }
      await git(['commit', '-m', `chore(quotes): ${action} ${id}`])

      if (!token) {
        lastFailure = {
          at: new Date().toISOString(),
          message: 'committed locally but GIT_TOKEN is empty; push skipped',
        }
        return { ok: false, message: lastFailure.message }
      }

      let remote = process.env.GIT_REMOTE_URL?.trim()
      if (!remote) {
        const { stdout } = await git(['remote', 'get-url', 'origin'])
        remote = stdout.trim()
      }
      const authed = remote.replace(
        /^https:\/\//,
        `https://x-access-token:${token}@`,
      )
      await git(['push', authed, `HEAD:${branch}`])
      lastFailure = null
      return { ok: true, message: 'pushed' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      lastFailure = { at: new Date().toISOString(), message }
      return { ok: false, message }
    }
  })
}
