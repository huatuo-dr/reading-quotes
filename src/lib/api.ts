export type Quote = {
  id: string
  content: string
  author: string
  book: string
  year: number
}

type GitResult = { ok: boolean; message: string }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText)
  return data as T
}

export const api = {
  listQuotes: () => req<Quote[]>('/api/quotes'),
  me: () => req<{ authenticated: boolean; username?: string | null }>('/api/auth/me'),
  login: (username: string, password: string) =>
    req<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  createQuote: (body: Omit<Quote, 'id'>) =>
    req<{ quote: Quote; git: GitResult }>('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateQuote: (id: string, body: Omit<Quote, 'id'>) =>
    req<{ quote: Quote; git: GitResult }>(`/api/quotes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteQuote: (id: string) =>
    req<{ ok: boolean; git: GitResult }>(`/api/quotes/${id}`, { method: 'DELETE' }),
  gitStatus: () =>
    req<{ lastFailure: { at: string; message: string } | null }>('/api/git/status'),
  gitRetry: () => req<GitResult>('/api/git/retry', { method: 'POST' }),
}
