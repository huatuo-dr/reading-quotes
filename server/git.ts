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

async function commitsAheadOfOrigin(branch: string): Promise<number> {
  try {
    const { stdout } = await git(['rev-list', '--count', `origin/${branch}..HEAD`])
    const n = Number.parseInt(stdout.trim(), 10)
    return Number.isFinite(n) ? n : 0
  } catch {
    // origin/<branch> 可能尚不存在：保守视为有待推送
    try {
      const { stdout } = await git(['rev-parse', 'HEAD'])
      return stdout.trim() ? 1 : 0
    } catch {
      return 0
    }
  }
}

async function pushHead(token: string, branch: string): Promise<void> {
  let remote = process.env.GIT_REMOTE_URL?.trim()
  if (!remote) {
    const { stdout } = await git(['remote', 'get-url', 'origin'])
    remote = stdout.trim()
  }
  const authed = remote.replace(/^https:\/\//, `https://x-access-token:${token}@`)
  await git(['-c', 'http.version=HTTP/1.1', 'push', authed, `HEAD:${branch}`])
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
      const hasChanges = Boolean(status.stdout.trim())

      if (hasChanges) {
        await git(['commit', '-m', `chore(quotes): ${action} ${id}`])
      } else {
        const ahead = await commitsAheadOfOrigin(branch)
        if (ahead <= 0) {
          lastFailure = null
          return { ok: true, message: 'nothing to commit' }
        }
        // 工作区干净但本地仍领先远端：继续 push（覆盖先前 push 失败留下的 commit）
      }

      if (!token) {
        lastFailure = {
          at: new Date().toISOString(),
          message: hasChanges
            ? 'committed locally but GIT_TOKEN is empty; push skipped'
            : 'local commits ahead of origin but GIT_TOKEN is empty; push skipped',
        }
        return { ok: false, message: lastFailure.message }
      }

      await pushHead(token, branch)
      lastFailure = null
      return { ok: true, message: hasChanges ? 'pushed' : 'pushed pending commits' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      lastFailure = { at: new Date().toISOString(), message }
      return { ok: false, message }
    }
  })
}
