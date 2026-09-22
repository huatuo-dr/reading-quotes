import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Quote } from '../lib/api'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function HomePage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listQuotes()
      .then((list) => {
        setQuotes(shuffle(list))
        setIndex(0)
      })
      .catch((e) => setError(e.message))
  }, [])

  const current = quotes[index]

  const go = (next: number) => {
    if (!quotes.length) return
    setFade(false)
    window.setTimeout(() => {
      setIndex((next + quotes.length) % quotes.length)
      setFade(true)
    }, 220)
  }

  useEffect(() => {
    if (quotes.length < 2) return
    const id = window.setInterval(() => go(index + 1), 60_000)
    return () => window.clearInterval(id)
  }, [quotes.length, index])

  const yearLabel = useMemo(() => (current ? String(current.year) : ''), [current])

  return (
    <div className="relative min-h-screen overflow-hidden">
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

      <main className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-20 text-center">
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
              “{current.content}”
            </blockquote>
            <div className="mt-10 space-y-2 text-amber-100/80">
              <p className="text-lg">— {current.author}</p>
              <p className="text-sm tracking-wide text-white/55">
                《{current.book}》 · {yearLabel}
              </p>
            </div>
          </div>
        )}

        <div className="mt-14 flex items-center gap-4">
          <button
            type="button"
            onClick={() => go(index - 1)}
            className="rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm tracking-widest text-white/80 backdrop-blur transition hover:bg-white/10"
          >
            上一条
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            className="rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm tracking-widest text-white/80 backdrop-blur transition hover:bg-white/10"
          >
            下一条
          </button>
        </div>
      </main>
    </div>
  )
}
