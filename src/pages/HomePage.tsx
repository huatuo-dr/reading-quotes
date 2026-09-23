import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type Quote } from '../lib/api'

const STORAGE_KEY = 'reading-quotes:home-deck'
const SWIPE_MIN_PX = 48

type DeckCache = { ids: string[]; index: number }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function readDeckCache(): DeckCache | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DeckCache
    if (!Array.isArray(parsed.ids) || typeof parsed.index !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeDeckCache(ids: string[], index: number) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ids, index }))
  } catch {
    /* ignore quota / private mode */
  }
}

function buildDeck(list: Quote[]): { quotes: Quote[]; index: number } {
  const byId = new Map(list.map((q) => [q.id, q]))
  const cached = readDeckCache()
  if (cached?.ids.length) {
    const restored = cached.ids.map((id) => byId.get(id)).filter((q): q is Quote => Boolean(q))
    const known = new Set(restored.map((q) => q.id))
    const extras = shuffle(list.filter((q) => !known.has(q.id)))
    const quotes = [...restored, ...extras]
    if (quotes.length) {
      const idx = quotes.findIndex((q) => q.id === cached.ids[cached.index])
      const index = idx >= 0 ? idx : Math.min(Math.max(cached.index, 0), quotes.length - 1)
      return { quotes, index }
    }
  }
  const quotes = shuffle(list)
  return { quotes, index: 0 }
}

export default function HomePage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)
  const [error, setError] = useState('')
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  useEffect(() => {
    api
      .listQuotes()
      .then((list) => {
        const deck = buildDeck(list)
        setQuotes(deck.quotes)
        setIndex(deck.index)
        writeDeckCache(
          deck.quotes.map((q) => q.id),
          deck.index,
        )
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!quotes.length) return
    writeDeckCache(
      quotes.map((q) => q.id),
      index,
    )
  }, [quotes, index])

  const go = useCallback(
    (next: number) => {
      if (!quotes.length) return
      setFade(false)
      window.setTimeout(() => {
        setIndex((next + quotes.length) % quotes.length)
        setFade(true)
      }, 220)
    },
    [quotes.length],
  )

  useEffect(() => {
    if (quotes.length < 2) return
    const id = window.setInterval(() => go(index + 1), 60_000)
    return () => window.clearInterval(id)
  }, [quotes.length, index, go])

  const current = quotes[index]
  const yearLabel = useMemo(() => (current ? String(current.year) : ''), [current])

  const onTouchStart = (e: TouchEvent) => {
    const t = e.changedTouches[0]
    touchStartX.current = t.clientX
    touchStartY.current = t.clientY
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (touchStartX.current == null || touchStartY.current == null) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartX.current
    const dy = t.clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return
    // 向左滑 → 下一条；向右滑 → 上一条
    if (dx < 0) go(index + 1)
    else go(index - 1)
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(212,175,110,0.18),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(88,120,180,0.16),_transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />

      <Link
        to="/admin"
        aria-label="后台"
        className="absolute right-4 top-4 z-20 rounded-full border border-white/15 bg-white/5 p-3 text-amber-100/90 backdrop-blur transition hover:bg-white/10"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a7.6 7.6 0 0 0-1.7-1L15 4h-4l-.5 2a7.6 7.6 0 0 0-1.7 1L6.5 6.4l-2 3.4 2 1.2a7.8 7.8 0 0 0 0 2l-2 1.2 2 3.4 2.3-.6a7.6 7.6 0 0 0 1.7 1l.5 2h4l.5-2a7.6 7.6 0 0 0 1.7-1l2.3.6 2-3.4-2-1.2Z" />
        </svg>
      </Link>

      {quotes.length > 1 && (
        <>
          <button
            type="button"
            aria-label="上一条"
            onClick={() => go(index - 1)}
            className="fixed left-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/20 text-3xl leading-none text-white/45 backdrop-blur transition hover:bg-white/10 hover:text-white/90 sm:left-4 sm:h-14 sm:w-14 sm:text-4xl sm:text-white/70 md:left-6"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一条"
            onClick={() => go(index + 1)}
            className="fixed right-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/20 text-3xl leading-none text-white/45 backdrop-blur transition hover:bg-white/10 hover:text-white/90 sm:right-4 sm:h-14 sm:w-14 sm:text-4xl sm:text-white/70 md:right-6"
          >
            ›
          </button>
        </>
      )}

      <main className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-14 py-20 text-center sm:px-16 md:px-20">
        {error && <p className="text-rose-300">{error}</p>}
        {!error && !quotes.length && (
          <p className="text-lg text-white/60">还没有摘抄。登录后台添加第一条吧。</p>
        )}
        {current && (
          <div
            className={`transition-all duration-300 ${fade ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
          >
            <p className="mb-8 text-xs tracking-[0.35em] text-amber-200/70 uppercase">Reading Quotes</p>
            <blockquote className="text-3xl leading-relaxed text-balance text-[#f7f1e6] sm:text-4xl md:text-5xl md:leading-snug">
              {current.content}
            </blockquote>
            <div className="mt-10 space-y-2 text-amber-100/80">
              {current.author ? <p className="text-lg">— {current.author}</p> : null}
              <p className="text-sm tracking-wide text-white/55">
                {current.book ? `《${current.book}》 · ${yearLabel}` : yearLabel}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
