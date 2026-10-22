// The listing that opens when you pick a spine: one physical copy, in detail.
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase.js'
import { CopyRow, ReadingControls, Verdicts, fmtDate, isStarred } from './parts.jsx'
import { availabilityText, libraryLog, possessive, spineTone } from './shelf.js'

const BookListing = forwardRef(function BookListing({ entry, tone, idBase = 'listing', me, myName, members, nameOf, actions, showToast, onAddBook }, headingRef) {
  const [tab, setTab] = useState('comments')
  const tabsRef = useRef([])
  const copyId = entry?.copy.id
  useEffect(() => { setTab('comments') }, [copyId])

  if (!entry) {
    return (
      <article className="listing empty-listing" aria-labelledby={`${idBase}-title`}>
        <div>
          <span className="eyebrow">Book listing</span>
          <h2 id={`${idBase}-title`} ref={headingRef} tabIndex={-1}>Pick a spine</h2>
          <p className="muted">Choose any book on the shelves above to see where it is, who's read it, and how to borrow it.</p>
          {onAddBook && <button type="button" className="btn" onClick={onAddBook}>Add a book you own</button>}
        </div>
      </article>
    )
  }

  const { copy, book } = entry
  const isOwner = copy.owner_id === me
  const ownerName = isOwner ? myName : nameOf(copy.owner_id)
  const where = availabilityText(copy, me, nameOf)
  const tabs = [
    ['comments', 'Reviews'],
    ['log', 'Library log'],
  ]

  // Arrow keys move between tabs (standard tab pattern).
  function onTabKey(e, i) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setTab(tabs[j][0])
    tabsRef.current[j]?.focus()
  }

  return (
    <article className="listing" aria-labelledby={`${idBase}-title`}>
      <div className="cover-col">
        <BookCover title={book.title} author={book.author} tone={tone || spineTone(copy.id)} />
        <Comments copy={copy} me={me} isOwner={isOwner} nameOf={nameOf} myName={myName} showToast={showToast} />
      </div>
      <div className="book-copy">
        <span className="eyebrow">{isOwner ? 'From your shelf' : `From ${possessive(ownerName)} shelf`}</span>
        <h2 id={`${idBase}-title`} ref={headingRef} tabIndex={-1}>
          {book.title}
          {isStarred(book, members) && <span className="star" title="Everyone in the library has read this">★ Read by everyone</span>}
        </h2>
        {book.author && <p className="author">by {book.author}</p>}

        <div className="tabs" role="tablist" aria-label="About this copy">
          {tabs.map(([key, label], i) => (
            <button
              key={key}
              ref={(el) => (tabsRef.current[i] = el)}
              type="button"
              role="tab"
              id={`${idBase}-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`${idBase}-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
              onKeyDown={(e) => onTabKey(e, i)}
            >{label}</button>
          ))}
        </div>

        {tab === 'comments' ? (
          <div className="details-panel" role="tabpanel" id={`${idBase}-panel-comments`} aria-labelledby={`${idBase}-tab-comments`}>
            <dl className="facts">
              <div><dt>Owner</dt><dd>{isOwner ? `${myName} (you)` : ownerName}</dd></div>
              <div>
                <dt>Location</dt>
                <dd className={`availability ${copy.status === 'lent' ? 'out' : 'in'}`}>
                  <i aria-hidden="true" />{where}{copy.status === 'lent' && copy.lent_at ? ` since ${fmtDate(copy.lent_at)}` : ''}
                </dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{!copy.lendable ? 'Not lending right now' : copy.status === 'lent' ? 'Out on loan' : isOwner ? 'On your shelf' : 'Available to borrow'}{copy.queue.length > 0 ? ` · ${copy.queue.length} in line` : ''}</dd>
              </div>
            </dl>

            <CopyRow copy={copy} me={me} members={members} nameOf={nameOf} actions={actions} compact hideHistory />

            <Verdicts book={book} nameOf={nameOf} />
            <ReadingControls book={book} me={me} actions={actions} layout="labeled" />

          </div>
        ) : (
          <div className="log-panel" role="tabpanel" id={`${idBase}-panel-log`} aria-labelledby={`${idBase}-tab-log`}>
            <LibraryLog copy={copy} nameOf={nameOf} />
          </div>
        )}
      </div>
    </article>
  )
})

export default BookListing

export function BookCover({ title, author, tone }) {
  return (
    <div className={`cover tone-${tone}`} aria-hidden="true">
      <span>GLAM BOOKSHELF</span>
      <strong>{title}</strong>
      {author && <i>by {author}</i>}
    </div>
  )
}

export function LibraryLog({ copy, nameOf }) {
  const events = libraryLog(copy, nameOf)
  return (
    <ol className="log-list" aria-label="Library log, oldest first">
      {events.map((e, i) => (
        <li className={`log-row ${e.kind}`} key={`${e.kind}-${e.at}-${i}`}>
          <span className="log-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8" /></svg>
          </span>
          <p>{e.text}</p>
          <time dateTime={e.at}>{fmtDate(e.at, { year: true })}</time>
        </li>
      ))}
    </ol>
  )
}

// Comments on one copy, shown as notes "in the margins" under the cover.
// Saved in the `comments` table (update-4.sql).
export function Comments({ copy, me, isOwner, nameOf, myName, showToast }) {
  const [items, setItems] = useState(null)
  const [missing, setMissing] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('glam_margins_open') === '1' } catch { return false } })
  const toggle = (v) => { setOpen(v); try { localStorage.setItem('glam_margins_open', v ? '1' : '0') } catch { /* private mode */ } }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, user_id, body, created_at')
      .eq('copy_id', copy.id)
      .order('created_at', { ascending: true })
    if (error) {
      // The table arrives with update-4.sql; until then, say so instead of breaking the page.
      if (/comments/i.test(error.message || '') && /(schema cache|does not exist|not find)/i.test(error.message || '')) setMissing(true)
      else showToast(friendlyError(error))
      setItems([])
      return
    }
    setItems(data || [])
  }, [copy.id, showToast])

  useEffect(() => {
    setItems(null); setConfirmId(null)
    load()
    const channel = supabase
      .channel('comments-' + copy.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `copy_id=eq.${copy.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [copy.id, load])

  async function post(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setBusy(true)
    const { error } = await supabase.from('comments').insert({ copy_id: copy.id, user_id: me, body: text })
    setBusy(false)
    if (error) { showToast(friendlyError(error)); return }
    setBody('')
    load()
  }

  async function remove(id) {
    const { error } = await supabase.from('comments').delete().eq('id', id)
    setConfirmId(null)
    if (error) { showToast(friendlyError(error)); return }
    load()
  }

  const count = items === null ? '' : items.length === 0 ? 'empty so far' : `${items.length} ${items.length === 1 ? 'note' : 'notes'}`
  const panelId = `margins-${copy.id}`

  return (
    <section className="margins" aria-label="The margins: notes from readers">
      <button type="button" className="margins-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => toggle(!open)}>
        <span className="margins-label">{open ? 'Hide margin notes' : 'Add margin notes'}</span>
        <span className="margins-count">{count}</span>
      </button>
      {open && (
        <div className="margin-notes" id={panelId}>
          {missing ? (
            <p className="hint">The margins need the latest database update (update-4.sql in the supabase folder).</p>
          ) : items === null ? (
            <p className="hint">Opening the margins…</p>
          ) : items.length === 0 ? (
            <p className="hint">Nobody has written in the margins yet. Be the first.</p>
          ) : (
            <ul className="note-list">
              {items.map((c) => {
                const mine = c.user_id === me
                return (
                  <li className="margin-note" key={c.id}>
                    <p className="note-body">{c.body}</p>
                    <div className="note-meta">
                      <span>— {mine ? myName : nameOf(c.user_id)}</span>
                      <time dateTime={c.created_at}>{fmtDate(c.created_at)}</time>
                      {(mine || isOwner) && (
                        confirmId === c.id ? (
                          <span className="comment-confirm">
                            <button type="button" className="linkish small danger-text" onClick={() => remove(c.id)}>Erase</button>
                            <button type="button" className="linkish small muted" onClick={() => setConfirmId(null)}>Keep</button>
                          </span>
                        ) : (
                          <button type="button" className="linkish small muted" onClick={() => setConfirmId(c.id)}
                            aria-label={`Erase note from ${mine ? 'you' : nameOf(c.user_id)}`}>Erase</button>
                        )
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {!missing && (
            <form className="margin-form" onSubmit={post}>
              <label htmlFor={`comment-${copy.id}`}>Write in the margin</label>
              <textarea id={`comment-${copy.id}`} rows={2} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)}
                placeholder="A thought, a favorite line, a warning…"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(e) }} />
              <button type="submit" className="btn small" disabled={busy || !body.trim()}>Add note</button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
