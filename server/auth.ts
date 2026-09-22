import type { Request, Response, NextFunction } from 'express'
import crypto from 'node:crypto'

const COOKIE = 'rq_session'

function b64url(buf: Buffer) {
  return buf.toString('base64url')
}

function sign(payload: string, secret: string) {
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest())
}

export function createSessionToken(username: string, secret: string) {
  const body = b64url(Buffer.from(JSON.stringify({ u: username, exp: Date.now() + 7 * 864e5 }), 'utf8'))
  return `${body}.${sign(body, secret)}`
}

export function readSession(req: Request, secret: string): string | null {
  const raw = req.cookies?.[COOKIE]
  if (!raw || typeof raw !== 'string') return null
  const [body, sig] = raw.split('.')
  if (!body || !sig) return null
  if (sign(body, secret) !== sig) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u: string; exp: number }
    if (!data.u || Date.now() > data.exp) return null
    return data.u
  } catch {
    return null
  }
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 864e5,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/' })
}

export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = readSession(req, secret)
    if (!user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    ;(req as Request & { user?: string }).user = user
    next()
  }
}
