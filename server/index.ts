import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearSessionCookie,
  createSessionToken,
  readSession,
  requireAuth,
  setSessionCookie,
} from './auth.js'
import {
  listQuotes,
  newId,
  validateQuoteInput,
  withQuotesLock,
  writeQuotes,
} from './quotes.js'
import { getGitStatus, syncQuotesToRemote } from './git.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT || 3000)
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me'

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/quotes', async (_req, res) => {
  try {
    res.json(await listQuotes())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/auth/me', (req, res) => {
  const user = readSession(req, SESSION_SECRET)
  res.json({ authenticated: Boolean(user), username: user })
})

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username ?? '')
  const password = String(req.body?.password ?? '')
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'invalid credentials' })
    return
  }
  const token = createSessionToken(username, SESSION_SECRET)
  setSessionCookie(res, token)
  res.json({ ok: true, username })
})

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res)
  res.json({ ok: true })
})

app.get('/api/git/status', requireAuth(SESSION_SECRET), (_req, res) => {
  res.json(getGitStatus())
})

app.post('/api/git/retry', requireAuth(SESSION_SECRET), async (_req, res) => {
  const result = await syncQuotesToRemote('update', 'retry')
  res.status(result.ok ? 200 : 500).json(result)
})

app.post('/api/quotes', requireAuth(SESSION_SECRET), async (req, res) => {
  try {
    const input = validateQuoteInput(req.body)
    const quote = { id: newId(), ...input }
    await withQuotesLock(async (quotes) => {
      quotes.push(quote)
      await writeQuotes(quotes)
    })
    const git = await syncQuotesToRemote('add', quote.id)
    res.status(201).json({ quote, git })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.put('/api/quotes/:id', requireAuth(SESSION_SECRET), async (req, res) => {
  try {
    const input = validateQuoteInput(req.body)
    let updated = null as null | typeof input & { id: string }
    await withQuotesLock(async (quotes) => {
      const idx = quotes.findIndex((q) => q.id === req.params.id)
      if (idx < 0) throw new Error('not found')
      updated = { id: quotes[idx].id, ...input }
      quotes[idx] = updated
      await writeQuotes(quotes)
    })
    const git = await syncQuotesToRemote('update', req.params.id)
    res.json({ quote: updated, git })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(msg === 'not found' ? 404 : 400).json({ error: msg })
  }
})

app.delete('/api/quotes/:id', requireAuth(SESSION_SECRET), async (req, res) => {
  try {
    await withQuotesLock(async (quotes) => {
      const next = quotes.filter((q) => q.id !== req.params.id)
      if (next.length === quotes.length) throw new Error('not found')
      await writeQuotes(next)
    })
    const git = await syncQuotesToRemote('delete', req.params.id)
    res.json({ ok: true, git })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(msg === 'not found' ? 404 : 400).json({ error: msg })
  }
})

const dist = path.join(ROOT, 'dist')
app.use(express.static(dist))
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) next()
  })
})

app.listen(PORT, () => {
  console.log(`reading-quotes listening on http://127.0.0.1:${PORT}`)
})
