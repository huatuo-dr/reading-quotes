import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_PATH = path.resolve(__dirname, '../data/quotes.json')

export type Quote = {
  id: string
  content: string
  author: string
  book: string
  year: number
}

async function readFile(): Promise<Quote[]> {
  const raw = await fs.readFile(DATA_PATH, 'utf8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error('quotes.json must be an array')
  return data as Quote[]
}

export async function listQuotes(): Promise<Quote[]> {
  return readFile()
}

export async function writeQuotes(quotes: Quote[]): Promise<void> {
  await fs.writeFile(DATA_PATH, `${JSON.stringify(quotes, null, 2)}\n`, 'utf8')
}

export async function withQuotesLock<T>(fn: (quotes: Quote[]) => Promise<T>): Promise<T> {
  const release = await lockfile.lock(DATA_PATH, {
    retries: { retries: 10, factor: 1.5, minTimeout: 50, maxTimeout: 1000 },
  })
  try {
    const quotes = await readFile()
    return await fn(quotes)
  } finally {
    await release()
  }
}

export function validateQuoteInput(body: unknown): Omit<Quote, 'id'> {
  if (!body || typeof body !== 'object') throw new Error('invalid body')
  const b = body as Record<string, unknown>
  const content = String(b.content ?? '').trim()
  const author = String(b.author ?? '').trim()
  const book = String(b.book ?? '').trim()
  const year = Number(b.year)
  if (!content) throw new Error('content is required')
  if (!Number.isInteger(year)) throw new Error('year must be an integer')
  return { content, author, book, year }
}

export function newId(): string {
  return randomUUID()
}
