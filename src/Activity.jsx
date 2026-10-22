import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

// A read-only feed of what's happened to the books in this library:
// who added what, who read what (and whose copy), and who wrote in whose margins.
// Nothing from Play shows up here.

const MAX_ITEMS = 200

function when(iso) {
  const t = new Date(iso)
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  const sameYear = t.getFullYear() === new Date().getFullYear()
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export default function Activity({ books, me, nameOf, onOpen }) {
  const [comments, setComments] = useState([])

  // Comments live in their own table; load the newest and keep them live.
  useEffect(() => {
    let alive = true
    let timer
    const load = async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('id, copy_id, user_id, body, created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_ITEMS * 2)
      if (alive && !error) setComments(data || [])
    }
    load()
    const channel = supabase
      .channel('activity-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => { clearTimeout(timer); timer = setTimeout(load, 250) })
      .subscribe()
    return () => { alive = false; clearTimeout(timer); supabase.removeChannel(channel) }
  }, [])

  const items = useMemo(() => {
    if (!books) return []
    const out = []
    const copyById = {}
    for (const b of books) for (const c of b.copies) copyById[c.id] = { copy: c, book: b }

    // "Ted's copy of", "your copy of", or "their own copy of"
    const whose = (ownerId, actorId) =>
      ownerId === me ? 'your copy of' : ownerId === actorId ? 'their own copy of' : `${nameOf(ownerId)}’s copy of`
    // the title opens that copy's listing
    const title = (b, copyId) => (
      <button type="button" className="activity-book" onClick={(e) => onOpen(copyId, e.currentTarget)}>
        <i>{b.title}</i>{b.author && <> by {b.author}</>}
      </button>
    )

    for (const b of books) {
      // added to a shelf
      for (const c of b.copies) {
        out.push({
          key: 'add-' + c.id, at: c.created_at, who: c.owner_id,
          text: <>added {title(b, c.id)} to {c.owner_id === me ? 'your' : 'their'} shelf.</>,
        })
      }
      // finished reading
      for (const r of b.reading) {
        if (r.status !== 'read' || !r.updated_at) continue
        const ownsOne = b.copies.some((c) => c.owner_id === r.user_id)
        // If they don't own it, credit the copy they last borrowed.
        let borrowed = null
        const own = b.copies.find((c) => c.owner_id === r.user_id)
        if (!ownsOne) {
          for (const c of b.copies) {
            if (c.owner_id === r.user_id) continue
            for (const l of c.loans || []) {
              if (l.borrower_id === r.user_id && (!borrowed || l.lent_at > borrowed.lent_at)) borrowed = { lent_at: l.lent_at, owner: c.owner_id, copyId: c.id }
            }
            if (!borrowed && c.lent_to_user === r.user_id) borrowed = { lent_at: c.lent_at || '', owner: c.owner_id, copyId: c.id }
          }
        }
        out.push({
          key: `read-${b.id}-${r.user_id}`, at: r.updated_at, who: r.user_id,
          text: borrowed ? <>read {whose(borrowed.owner, r.user_id)} {title(b, borrowed.copyId)}.</> : <>read {title(b, (own || b.copies[0])?.id)}.</>,
        })
      }
    }
    // wants to read: a place in line names the copy; otherwise just the book
    for (const b of books) {
      const lined = new Set()
      for (const c of b.copies) {
        for (const q of c.queue || []) {
          lined.add(q.user_id)
          out.push({
            key: `line-${c.id}-${q.user_id}`, at: q.joined_at, who: q.user_id,
            text: <>{q.user_id === me ? 'want' : 'wants'} to read {whose(c.owner_id, q.user_id)} {title(b, c.id)}.</>,
          })
        }
      }
      for (const r of b.reading) {
        if (r.status !== 'want' || lined.has(r.user_id)) continue
        const own = b.copies.find((c) => c.owner_id === r.user_id)
        const other = b.copies.find((c) => c.owner_id !== r.user_id)
        out.push({
          key: `want-${b.id}-${r.user_id}`, at: r.updated_at, who: r.user_id,
          text: !own && other && b.copies.length === 1
            ? <>{r.user_id === me ? 'want' : 'wants'} to read {whose(other.owner_id, r.user_id)} {title(b, other.id)}.</>
            : <>{r.user_id === me ? 'want' : 'wants'} to read {title(b, (own || b.copies[0])?.id)}.</>,
        })
      }
    }
    // wrote in the margins
    for (const cm of comments) {
      const e = copyById[cm.copy_id]
      if (!e) continue   // a comment in one of your other libraries
      out.push({
        key: 'note-' + cm.id, at: cm.created_at, who: cm.user_id,
        text: <>commented on {whose(e.copy.owner_id, cm.user_id)} {title(e.book, cm.copy_id)}.</>,
        quote: cm.body,
      })
    }
    return out.filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS)
  }, [books, comments, me, nameOf, onOpen])

  return (
    <main className="list-view stack-lg">
      <h1 className="view-title">Activity</h1>
      <WantedFromShelf books={books} me={me} nameOf={nameOf} onOpen={onOpen} />
      {books === null ? (
        <div className="empty"><strong>Opening the shelves…</strong></div>
      ) : items.length === 0 ? (
        <div className="empty"><strong>Nothing yet</strong>When someone adds, reads, wants or comments on a book, it shows up here.</div>
      ) : (
        <ol className="activity">
          {items.map((it) => (
            <li key={it.key}>
              <p>
                <b>{nameOf(it.who)}</b> {it.text}
                {it.quote && <span className="activity-quote">“{it.quote.length > 140 ? it.quote.slice(0, 140).trimEnd() + '…' : it.quote}”</span>}
              </p>
              <time dateTime={it.at} title={new Date(it.at).toLocaleString()}>{when(it.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </main>
  )
}

// The people who want to read the books you own: whoever is in line for your copy,
// plus anyone who marked it want-to-read and isn't waiting on someone else's copy.
export function WantedFromShelf({ books, me, nameOf, onOpen }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('glam_wanted_open') === '1' } catch { return false } })
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem('glam_wanted_open', v ? '1' : '0') } catch { /* private mode */ } }

  const rows = []
  for (const b of books || []) {
    const mine = b.copies.filter((c) => c.owner_id === me)
    if (!mine.length) continue
    const people = []
    const seen = new Set([me])
    for (const c of mine) {
      c.queue.forEach((q, i) => {
        if (seen.has(q.user_id)) return
        seen.add(q.user_id)
        people.push({ id: q.user_id, note: i === 0 ? 'next in line' : `${i + 1}${['st', 'nd', 'rd'][i] || 'th'} in line` })
      })
    }
    const elsewhere = new Set(b.copies.filter((c) => c.owner_id !== me).flatMap((c) => c.queue.map((q) => q.user_id)))
    for (const r of b.reading) {
      if (r.status !== 'want' || seen.has(r.user_id) || elsewhere.has(r.user_id)) continue
      if (b.copies.some((c) => c.owner_id === r.user_id)) continue   // they have their own
      seen.add(r.user_id)
      people.push({ id: r.user_id, note: 'wants to read' })
    }
    if (people.length) rows.push({ book: b, copyId: mine[0].id, people })
  }
  const total = rows.reduce((n, r) => n + r.people.length, 0)
  if (!books) return null

  return (
    <section className="wanted" aria-label="Wanted from your shelf">
      <button type="button" className="wanted-toggle" aria-expanded={open} onClick={toggle}>
        <span>Wanted from your shelf</span>
        <span className="count">{total}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        rows.length === 0 ? (
          <p className="muted small wanted-empty">Nobody is waiting on your books right now.</p>
        ) : (
          <ul>
            {rows.map(({ book, copyId, people }) => (
              <li key={book.id}>
                <button type="button" className="activity-book" onClick={(e) => onOpen(copyId, e.currentTarget)}>
                  <i>{book.title}</i>{book.author && <> by {book.author}</>}
                </button>
                <span className="wanted-people">
                  {people.map((p, i) => (
                    <span key={p.id}>{i > 0 && ', '}<b>{nameOf(p.id)}</b> <span className="muted">({p.note})</span></span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  )
}
