import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type Quote } from '../lib/api'

const emptyForm = { content: '', author: '', book: '', year: new Date().getFullYear() }

export default function AdminPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [authed, setAuthed] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [query, setQuery] = useState('')
  const [yearFilter, setYearFilter] = useState<'all' | number>('all')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [gitFail, setGitFail] = useState<{ at: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    const [list, me] = await Promise.all([api.listQuotes(), api.me()])
    setQuotes(list)
    setAuthed(me.authenticated)
    if (me.authenticated) {
      try {
        const st = await api.gitStatus()
        setGitFail(st.lastFailure)
      } catch {
        setGitFail(null)
      }
    } else {
      setGitFail(null)
    }
  }

  useEffect(() => {
    refresh().catch((e: Error) => setMessage(e.message))
  }, [])

  const years = useMemo(
    () => Array.from(new Set(quotes.map((q) => q.year))).sort((a, b) => b - a),
    [quotes],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return quotes.filter((item) => {
      if (yearFilter !== 'all' && item.year !== yearFilter) return false
      if (!q) return true
      return [item.content, item.author, item.book].some((v) =>
        v.toLowerCase().includes(q),
      )
    })
  }, [quotes, query, yearFilter])

  const onLogin = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await api.login(username, password)
      setPassword('')
      await refresh()
      setMessage('已登录')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onLogout = async () => {
    await api.logout()
    setAuthed(false)
    setGitFail(null)
    setMessage('已登出')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!authed) return
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        content: form.content.trim(),
        author: form.author.trim(),
        book: form.book.trim(),
        year: Number(form.year),
      }
      const res = editingId
        ? await api.updateQuote(editingId, payload)
        : await api.createQuote(payload)
      setMessage(
        res.git.ok
          ? editingId
            ? '已更新并同步'
            : '已新增并同步'
          : `已保存，但 Git 同步失败：${res.git.message}`,
      )
      setForm(emptyForm)
      setEditingId(null)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onEdit = (q: Quote) => {
    setEditingId(q.id)
    setForm({ content: q.content, author: q.author, book: q.book, year: q.year })
  }

  const onDelete = async (id: string) => {
    if (!authed || !window.confirm('确认删除这条摘抄？')) return
    setBusy(true)
    try {
      const res = await api.deleteQuote(id)
      setMessage(
        res.git.ok
          ? '已删除并同步'
          : `已删除本地数据，但 Git 同步失败：${res.git.message}`,
      )
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onRetryGit = async () => {
    setBusy(true)
    try {
      const res = await api.gitRetry()
      setMessage(res.ok ? 'Git 重试成功' : `重试失败：${res.message}`)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b1020] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">摘抄后台</h1>
            <p className="text-sm text-slate-400">搜索 · 按年筛选 · 登录后可增删改</p>
          </div>
          <Link
            to="/"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            返回首页
          </Link>
        </header>

        {!authed ? (
          <form
            onSubmit={onLogin}
            className="max-w-md space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <h2 className="font-medium">登录</h2>
            <input
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              disabled={busy}
              className="rounded-lg bg-amber-500/90 px-4 py-2 font-medium text-black disabled:opacity-50"
            >
              登录
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-emerald-300">已登录</span>
            <button
              onClick={onLogout}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm"
            >
              登出
            </button>
          </div>
        )}

        {gitFail && authed && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p>
              Git 同步失败（{gitFail.at}）：{gitFail.message}
            </p>
            <button
              onClick={onRetryGit}
              className="mt-2 rounded-lg bg-amber-500/90 px-3 py-1.5 text-black"
            >
              重试同步
            </button>
          </div>
        )}

        {message && <p className="text-sm text-sky-300">{message}</p>}

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            placeholder="搜索内容 / 作者 / 书名"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            value={yearFilter === 'all' ? 'all' : String(yearFilter)}
            onChange={(e) =>
              setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
          >
            <option value="all">全部年份</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} 年
              </option>
            ))}
          </select>
        </div>

        {authed && (
          <form
            onSubmit={onSubmit}
            className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <h2 className="font-medium">{editingId ? '编辑摘抄' : '新增摘抄'}</h2>
            <textarea
              required
              className="min-h-28 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
              placeholder="内容"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                required
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                placeholder="作者"
                value={form.author}
                onChange={(e) => setForm({ ...form, author: e.target.value })}
              />
              <input
                required
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                placeholder="书名"
                value={form.book}
                onChange={(e) => setForm({ ...form, book: e.target.value })}
              />
              <input
                required
                type="number"
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                placeholder="阅读年份"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
              />
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                className="rounded-lg bg-amber-500/90 px-4 py-2 text-black disabled:opacity-50"
              >
                {editingId ? '保存' : '新增'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null)
                    setForm(emptyForm)
                  }}
                  className="rounded-lg border border-white/10 px-4 py-2"
                >
                  取消
                </button>
              )}
            </div>
          </form>
        )}

        <section className="space-y-3">
          <h2 className="text-sm tracking-wide text-slate-400">共 {filtered.length} 条</h2>
          {filtered.map((q) => (
            <article key={q.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="leading-relaxed text-slate-100">{q.content}</p>
              <p className="mt-2 text-sm text-slate-400">
                {q.author} · 《{q.book}》 · {q.year}
              </p>
              {authed && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onEdit(q)}
                    className="rounded-lg border border-white/10 px-3 py-1 text-sm"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => onDelete(q.id)}
                    className="rounded-lg border border-rose-400/30 px-3 py-1 text-sm text-rose-300"
                  >
                    删除
                  </button>
                </div>
              )}
            </article>
          ))}
          {!filtered.length && <p className="text-slate-500">没有匹配的摘抄。</p>}
        </section>
      </div>
    </div>
  )
}
