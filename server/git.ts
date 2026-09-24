import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const GIT_SYNC_LOG = path.join(ROOT, 'logs', 'git-sync.log')

export type GitSyncResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

export type GitSyncSource = 'web-sync' | 'retry'

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

function redactSecrets(text: string): string {
  let out = text
  const token = process.env.GIT_TOKEN?.trim()
  if (token) {
    out = out.split(token).join('[REDACTED]')
  }
  out = out
    .replace(/https:\/\/[^/\s]*:[^@/\s]+@/gi, 'https://[REDACTED]@')
    .replace(/x-access-token:[^@\s]+@/gi, 'x-access-token:[REDACTED]@')
    .replace(/ghp_[A-Za-z0-9]+/g, 'ghp_[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_[REDACTED]')
  return out
}

async function appendGitSyncLog(entry: {
  source: string
  action: string
  result: 'success' | 'fail'
  sha?: string
  reason?: string
}): Promise<void> {
  const parts = [
    new Date().toISOString(),
    `source=${entry.source}`,
    `action=${entry.action}`,
    `result=${entry.result}`,
  ]
  if (entry.sha) parts.push(`sha=${entry.sha}`)
  if (entry.reason) {
    parts.push(`reason=${redactSecrets(entry.reason).replace(/\s+/g, ' ').trim()}`)
  }
  try {
    await fs.mkdir(path.dirname(GIT_SYNC_LOG), { recursive: true })
    await fs.appendFile(GIT_SYNC_LOG, `${parts.join(' ')}\n`, 'utf8')
  } catch {
    // logging must never break sync
  }
}

async function git(args: string[], env?: NodeJS.ProcessEnv) {
  return execFileAsync('git', args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function shortHead(): Promise<string> {
  const { stdout } = await git(['rev-parse', '--short', 'HEAD'])
  return stdout.trim()
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

/** After successful push of HEAD:branch, refresh origin/<branch> without writing token into remotes. */
async function refreshOriginTracking(branch: string, source: string): Promise<void> {
  await git(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'])
  const sha = await shortHead()
  await appendGitSyncLog({
    source,
    action: 'update-ref',
    result: 'success',
    sha,
    reason: `refs/remotes/origin/${branch} -> HEAD`,
  })
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

export function syncQuotesToRemote(
  action: 'add' | 'update' | 'delete',
  id: string,
  source: GitSyncSource = id === 'retry' ? 'retry' : 'web-sync',
): Promise<GitSyncResult> {
  return enqueue(async () => {
    if (process.env.GIT_ENABLED === 'false') {
      lastFailure = null
      await appendGitSyncLog({
        source,
        action: 'skip',
        result: 'success',
        reason: 'GIT_ENABLED=false',
      })
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
        const sha = await shortHead()
        await appendGitSyncLog({
          source,
          action: 'commit',
          result: 'success',
          sha,
          reason: `${action} ${id}`,
        })
      } else {
        const ahead = await commitsAheadOfOrigin(branch)
        if (ahead <= 0) {
          lastFailure = null
          await appendGitSyncLog({
            source,
            action: 'noop',
            result: 'success',
            reason: 'nothing to commit or push',
          })
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
        await appendGitSyncLog({
          source,
          action: 'push',
          result: 'fail',
          reason: lastFailure.message,
        })
        return { ok: false, message: lastFailure.message }
      }

      await pushHead(token, branch)
      const sha = await shortHead()
      await appendGitSyncLog({
        source,
        action: 'push',
        result: 'success',
        sha,
      })
      await refreshOriginTracking(branch, source)
      lastFailure = null
      return { ok: true, message: hasChanges ? 'pushed' : 'pushed pending commits' }
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err))
      lastFailure = { at: new Date().toISOString(), message }
      await appendGitSyncLog({
        source,
        action: 'sync',
        result: 'fail',
        reason: message,
      })
      return { ok: false, message }
    }
  })
}
