// The book listing as an index card: the cover taped on the left, and the basics written
// on the ruled lines. "edit" turns to your side of the card: your status and take,
// your spine color (owner), a note in the margins, and the owner's tools.
// Every line of text sits on the card's rules: long text wraps onto the next rule,
// it never stretches the spacing.
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase.js'
import { CopyRow, fmtDate, isStarred } from './parts.jsx'
import { SPINE_TONES, libraryLog, possessive, spineTone } from './shelf.js'
import { coverUrl } from './covers.js'
import { MAX_MOODS, MOODS, myMoods, topMoods } from './moods.js'

// Your side of the card. (The values match the database: reading.status and reading.rating.)
const MY_STATUSES = [['want', 'want to read'], ['reading', 'am reading'], ['read', 'read'], ['dnf', 'DNF’d']]
const MY_VERDICTS = [['up', 'loved it'], ['good', 'liked it'], ['meh', 'it was fine'], ['down', 'it wasn’t for me']]
// How a verdict reads about someone on the front of the card.
const VERDICT_SAID = { up: 'loved it', good: 'liked it', meh: 'thought it was fine', down: 'didn’t love it' }

const BookListing = forwardRef(function BookListing(
  { entry, tone, idBase = 'listing', me, myName, members, nameOf, actions, showToast, onAddBook, startEditing = false },
  headingRef,
) {
  const copyId = entry?.copy.id
  const [editing, setEditing] = useState(startEditing)
  useEffect(() => { setEditing(startEditing) }, [copyId])   // eslint-disable-line react-hooks/exhaustive-deps
  const book0 = entry?.book
  useEffect(() => { if (book0) actions?.findCover?.(book0) }, [book0?.id, book0?.cover_looked])   // eslint-disable-line react-hooks/exhaustive-deps
  const margins = useMargins(entry?.copy.id, me, showToast)

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
  const shownTone = tone || spineTone(copy.id)

  return (
    <article className={`index-card${editing ? ' editing' : ''}`} aria-labelledby={`${idBase}-title`}>
      <header className="card-head">
        <h2 id={`${idBase}-title`} ref={headingRef} tabIndex={-1} className="card-title">{book.title}</h2>
        {isStarred(book, members) && <span className="star" title="Everyone in the library has read this">★ Read by everyone</span>}
        <span className="card-mode">
          {editing && <span className="card-editing">editing</span>}
          <button type="button" className="card-toggle" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? 'done' : 'edit'}
          </button>
        </span>
      </header>

      <div className="index-body">
        <div className="card-cover">
          <BookCover title={book.title} author={book.author} coverId={book.cover_id} tone={shownTone} />
          <i className="tape" aria-hidden="true" />
        </div>
        <div className="card-lines">
          {editing ? (
            <MySide book={book} copy={copy} me={me} isOwner={isOwner} tone={shownTone} members={members}
              nameOf={nameOf} actions={actions} margins={margins} />
          ) : (
            <FrontSide book={book} copy={copy} me={me} myName={myName} isOwner={isOwner} nameOf={nameOf}
              actions={actions} margins={margins} idBase={idBase} />
          )}
        </div>
      </div>
    </article>
  )
})

export default BookListing

// ---------------------------------------------------------------------------
// The front: who's read it, where the copy is, the margins and the log
// ---------------------------------------------------------------------------

function FrontSide({ book, copy, me, myName, isOwner, nameOf, actions, margins, idBase }) {
  const rows = summarize(book.reading || [], me, nameOf)
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('glam_margins_open') === '1' } catch { return false } })
  const toggleMargins = () => {
    setOpen((v) => { try { localStorage.setItem('glam_margins_open', v ? '0' : '1') } catch { /* private mode */ } return !v })
  }
  const [logOpen, setLogOpen] = useState(false)
  const latest = margins.items?.length ? margins.items[margins.items.length - 1] : null
  const by = (uid) => (uid === me ? 'you' : nameOf(uid))

  return (
    <>
      {book.author && <p className="card-line card-by">by {book.author}</p>}

      {rows.length ? rows.map((segs, i) => (
        <p className="card-line" key={i}>{segs.map((s, j) => <Seg key={j} s={s} />)}</p>
      )) : <p className="card-line card-quiet">Nobody’s marked this one yet.</p>}

      <MoodsLine book={book} me={me} nameOf={nameOf} />

      <CopyLine copy={copy} me={me} isOwner={isOwner} nameOf={nameOf} actions={actions} />

      <p className="card-line">
        In the margins:{' '}
        {margins.missing ? <span className="card-quiet">(needs update-4.sql)</span>
          : margins.items === null ? <span className="card-quiet">…</span>
          : latest ? (
            <>
              {!open && <><span className="card-note">{latest.body}</span> <span className="card-note-by">— {by(latest.user_id)}</span>{' '}</>}
              <button type="button" className="card-link" aria-expanded={open} onClick={toggleMargins}>
                {open ? 'hide margin notes' : margins.items.length > 1 ? `see all ${margins.items.length}` : 'see it'}
              </button>
            </>
          ) : <span className="card-quiet">nothing yet</span>}
      </p>
      {open && margins.items?.length > 0 && (
        <ul className="card-notes" aria-label="The margins: notes from readers">
          {margins.items.map((c) => (
            <MarginNote key={c.id} c={c} me={me} myName={myName} nameOf={nameOf} isOwner={isOwner} remove={margins.remove} />
          ))}
        </ul>
      )}

      <p className="card-line">
        <button type="button" className="card-link" aria-expanded={logOpen} aria-controls={`${idBase}-log`} onClick={() => setLogOpen((v) => !v)}>
          {logOpen ? 'hide the library log' : 'Library log'}
        </button>
      </p>
      {logOpen && <LibraryLog id={`${idBase}-log`} copy={copy} nameOf={nameOf} />}
    </>
  )
}

function Seg({ s }) {
  return s.tab ? <><mark className="tab">{s.t}</mark>{' '}</> : <>{s.t}{' '}</>
}

// Everyone's take, one line per group: "Nat & Anna [read] and [loved it]".
export function summarize(reading, me, nameOf) {
  const names = (rows) => {
    const ns = [...rows].sort((a, b) => (a.user_id === me) - (b.user_id === me)).map((r) => (r.user_id === me ? 'you' : nameOf(r.user_id)))
    const s = ns.length === 1 ? ns[0] : ns.length === 2 ? `${ns[0]} & ${ns[1]}` : `${ns.slice(0, -1).join(', ')} & ${ns[ns.length - 1]}`
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  const t = (x) => ({ t: x })
  const tab = (x) => ({ t: x, tab: true })
  const pick = (fn) => reading.filter(fn)
  const lines = []
  for (const v of ['up', 'good', 'meh', 'down']) {
    const g = pick((r) => r.status === 'read' && r.rating === v)
    if (g.length) lines.push([t(names(g)), tab('read'), t('and'), tab(VERDICT_SAID[v])])
  }
  const read = pick((r) => r.status === 'read' && !r.rating)
  if (read.length) lines.push([t(names(read)), tab('read'), t('it')])
  const reading_ = pick((r) => r.status === 'reading')
  if (reading_.length) {
    const solo = reading_.length === 1
    const lead = solo ? (reading_[0].user_id === me ? 'You’re' : `${names(reading_)} is`) : `${names(reading_)} are`
    lines.push([t(lead), tab('currently reading')])
  }
  const dnf = pick((r) => r.status === 'dnf')
  if (dnf.length) lines.push([t(names(dnf)), tab('didn’t finish'), t('it')])
  const want = pick((r) => r.status === 'want')
  if (want.length) {
    const third = want.length === 1 && want[0].user_id !== me
    lines.push([t(names(want)), tab(third ? 'wants to read' : 'want to read'), t('it')])
  }
  return lines
}

// "Feels like [still thinking about it · 3] [ugly-cried]": the top moods friends picked.
function MoodsLine({ book, me, nameOf }) {
  const top = topMoods(book)
  if (!top.length) return null
  const who = (ids) => {
    const ns = [...ids].sort((a, b) => (a === me) - (b === me)).map((id) => (id === me ? 'you' : nameOf(id)))
    return ns.length <= 2 ? ns.join(' & ') : `${ns.slice(0, -1).join(', ')} & ${ns[ns.length - 1]}`
  }
  return (
    <p className="card-line">
      Feels like{' '}
      {top.map((m) => (
        <span key={m.id}>
          <span className={`mood mood-${m.tint} shown`} title={`${who(m.users)} picked this`}>
            {m.label}{m.count > 1 && <span className="mood-count"> · {m.count}</span>}
          </span>{' '}
        </span>
      ))}
    </p>
  )
}

// "Ted’s copy is [with Fred since Oct 12]" plus what you can do about it.
function CopyLine({ copy, me, isOwner, nameOf, actions }) {
  const owner = nameOf(copy.owner_id)
  const line = copy.queue || []
  const next = line[0]?.user_id
  const myPlace = line.findIndex((q) => q.user_id === me)
  const isHolder = copy.lent_to_user === me
  const holder = copy.lent_to_user ? (isHolder ? 'you' : nameOf(copy.lent_to_user)) : copy.lent_to_name || 'a friend'
  const where = copy.status === 'lent'
    ? `with ${holder}${copy.lent_at ? ` since ${fmtDate(copy.lent_at)}` : ''}`
    : isOwner ? 'at home' : `at ${possessive(owner)}`

  const doing = []
  if (isOwner) {
    if (copy.status === 'home' && next) doing.push(<button key="pass" type="button" className="card-link" onClick={() => actions.passOn(copy)}>gave it to {nameOf(next)}</button>)
  } else if (isHolder) {
    if (next) doing.push(<button key="pass" type="button" className="card-link" onClick={() => actions.passOn(copy)}>gave it to {nameOf(next)}</button>)
    doing.push(<button key="back" type="button" className="card-link" onClick={() => actions.setHome(copy)}>gave it back to {owner}</button>)
  } else if (myPlace >= 0) {
    doing.push(<span key="place" className="card-quiet">{myPlace === 0 ? 'you’re next in line' : `you’re #${myPlace + 1} in line`}</span>)
    doing.push(<button key="leave" type="button" className="card-link" onClick={() => actions.leaveLine(copy)}>leave the line</button>)
  } else if (copy.lendable) {
    doing.push(<button key="join" type="button" className="card-link" onClick={() => actions.joinLine(copy)}>get in line</button>)
    if (copy.status === 'home' && line.length === 0) {
      doing.push(<button key="took" type="button" className="card-link" onClick={() => actions.lendTo(copy, me)}>I already borrowed it</button>)
    }
  }

  return (
    <p className="card-line">
      {isOwner ? 'Your' : possessive(owner)} copy is <mark className="tab plain">{where}</mark>{' '}
      {!copy.lendable && <><mark className="tab plain">not lending right now</mark>{' '}</>}
      {line.length > 0 && !isOwner && myPlace < 0 && <span className="card-quiet">· {line.length} in line </span>}
      {doing.map((d, i) => <span key={i}>{d}{' '}</span>)}
    </p>
  )
}

function MarginNote({ c, me, myName, nameOf, isOwner, remove }) {
  const [confirming, setConfirming] = useState(false)
  const mine = c.user_id === me
  return (
    <li className="card-line">
      <span className="card-note">{c.body}</span>{' '}
      <span className="card-note-by">— {mine ? myName : nameOf(c.user_id)}, <time dateTime={c.created_at}>{fmtDate(c.created_at)}</time></span>{' '}
      {(mine || isOwner) && (confirming ? (
        <>
          <button type="button" className="card-link danger" onClick={() => remove(c.id)}>Erase</button>{' '}
          <button type="button" className="card-link quiet" onClick={() => setConfirming(false)}>Keep</button>
        </>
      ) : (
        <button type="button" className="card-link quiet" onClick={() => setConfirming(true)}
          aria-label={`Erase note from ${mine ? 'you' : nameOf(c.user_id)}`}>Erase</button>
      ))}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Your side: status, take, spine color, a note, and the owner's tools
// ---------------------------------------------------------------------------

function MySide({ book, copy, me, isOwner, tone, members, nameOf, actions, margins }) {
  const myRow = (book.reading || []).find((r) => r.user_id === me)
  const status = myRow?.status || 'none'
  const rating = myRow?.rating || null
  const [toneOpen, setToneOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function addNote(e) {
    e.preventDefault()
    if (!note.trim() || busy) return
    setBusy(true)
    const ok = await margins.post(note.trim())
    setBusy(false)
    if (ok) setNote('')
  }

  return (
    <>
      <p className="card-line" role="group" aria-label="Your reading status">
        I{' '}
        {MY_STATUSES.map(([v, label]) => (
          <span key={v}>
            <button type="button" className="tab" aria-pressed={status === v}
              onClick={() => actions.setMark(book.id, status === v ? 'none' : v)}>{label}</button>{' '}
          </span>
        ))}
      </p>
      <p className="card-line" role="group" aria-label="Your take">
        and{' '}
        {MY_VERDICTS.map(([v, label]) => (
          <span key={v}>
            <button type="button" className="tab" aria-pressed={rating === v}
              onClick={() => actions.rate(book.id, rating === v ? null : v, status)}>{label}</button>{' '}
          </span>
        ))}
      </p>

      {/* moods need update-12.sql: until then books arrive without book_moods and there's no picker */}
      {status === 'read' && Array.isArray(book.book_moods) && actions.setMood && (
        <MoodPicker book={book} me={me} actions={actions} />
      )}

      {isOwner && (
        <p className="card-line">
          <mark className="tab plain">Spine color?</mark>{' '}
          <button type="button" className={`swatch tone-${tone}`} aria-expanded={toneOpen}
            aria-label={`Spine color: ${copy.tone ? tone : `${tone} (picked automatically)`}. Change it`}
            onClick={() => setToneOpen((v) => !v)} />{' '}
          {toneOpen && (
            <span role="group" aria-label="Pick a spine color">
              {SPINE_TONES.map((t) => (
                <span key={t}>
                  <button type="button" className={`swatch tone-${t}`} aria-label={t} aria-pressed={copy.tone === t}
                    onClick={async () => { setToneOpen(false); await actions.setTone(copy, t) }} />{' '}
                </span>
              ))}
              {copy.tone && (
                <button type="button" className="card-link quiet" onClick={async () => { setToneOpen(false); await actions.setTone(copy, null) }}>automatic</button>
              )}
            </span>
          )}
        </p>
      )}

      {!margins.missing && (
        <form className="card-line" onSubmit={addNote}>
          <label htmlFor={`note-${copy.id}`} className="tab plain">In the margins:</label>{' '}
          <input id={`note-${copy.id}`} className="card-input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="A thought, a quote, a warning…" />{' '}
          <button type="submit" className="tab card-add" disabled={busy || !note.trim()}>add</button>
        </form>
      )}

      {isOwner && (
        <div className="card-owner">
          <p className="card-line card-sub">Your copy</p>
          <CopyRow copy={copy} me={me} members={members} nameOf={nameOf} actions={actions} compact hideHistory />
        </div>
      )}
    </>
  )
}

// "It felt like (up to 3)": your moods for a book you've read.
function MoodPicker({ book, me, actions }) {
  const mine = myMoods(book, me)
  const full = mine.length >= MAX_MOODS
  return (
    <p className="card-line" role="group" aria-label={`Moods, up to ${MAX_MOODS}`}>
      It felt like <span className="card-quiet card-hint">(up to {MAX_MOODS})</span>{' '}
      {MOODS.map((m) => {
        const on = mine.includes(m.id)
        return (
          <span key={m.id}>
            <button type="button" className={`mood mood-${m.tint}`} aria-pressed={on}
              disabled={!on && full} title={!on && full ? `You’ve picked ${MAX_MOODS}. Tap one to swap it out.` : undefined}
              onClick={() => actions.setMood(book, m.id, !on)}>
              {on && <span aria-hidden="true">✓ </span>}{m.label}
            </button>{' '}
          </span>
        )
      })}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

// The cover: the real one from Open Library when we have it, drawn on top of our own
// colored cover. While the picture loads, or if it can't, you see the colored one.
export function BookCover({ title, author, tone, coverId = null, small = false }) {
  const [status, setStatus] = useState('loading')   // 'loading' | 'shown' | 'failed'
  useEffect(() => { setStatus('loading') }, [coverId])
  const photo = coverId && status !== 'failed'
  return (
    <div className={`cover tone-${tone}${small ? ' small' : ''}${photo && status === 'shown' ? ' has-photo' : ''}`} aria-hidden="true">
      <span>GLAM BOOKSHELF</span>
      <strong>{title}</strong>
      {author && <i>by {author}</i>}
      {photo && (
        <img
          className="cover-photo" src={coverUrl(coverId, small ? 'M' : 'L')} alt="" loading="lazy"
          onLoad={(e) => setStatus(e.currentTarget.naturalWidth > 1 ? 'shown' : 'failed')}
          onError={() => setStatus('failed')}
        />
      )}
    </div>
  )
}

export function LibraryLog({ copy, nameOf, id }) {
  const events = libraryLog(copy, nameOf)
  return (
    <ol className="card-log" id={id} aria-label="Library log, oldest first">
      {events.map((e, i) => (
        <li className={`card-line ${e.kind}`} key={`${e.kind}-${e.at}-${i}`}>
          <time dateTime={e.at}>{fmtDate(e.at, { year: true })}</time> {e.text}
        </li>
      ))}
    </ol>
  )
}

// Notes "in the margins" for one copy (the `comments` table, update-4.sql), kept live.
function useMargins(copyId, me, showToast) {
  const [items, setItems] = useState(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    if (!copyId) return
    const { data, error } = await supabase
      .from('comments')
      .select('id, user_id, body, created_at')
      .eq('copy_id', copyId)
      .order('created_at', { ascending: true })
    if (error) {
      // The table arrives with update-4.sql; until then, say so instead of breaking the page.
      if (/comments/i.test(error.message || '') && /(schema cache|does not exist|not find)/i.test(error.message || '')) setMissing(true)
      else showToast(friendlyError(error))
      setItems([])
      return
    }
    setItems(data || [])
  }, [copyId, showToast])

  useEffect(() => {
    if (!copyId) return undefined
    setItems(null)
    load()
    const channel = supabase
      .channel('comments-' + copyId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `copy_id=eq.${copyId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [copyId, load])

  const post = useCallback(async (body) => {
    const { error } = await supabase.from('comments').insert({ copy_id: copyId, user_id: me, body })
    if (error) { showToast(friendlyError(error)); return false }
    load()
    return true
  }, [copyId, me, load, showToast])

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('comments').delete().eq('id', id)
    if (error) { showToast(friendlyError(error)); return }
    load()
  }, [load, showToast])

  return { items, missing, post, remove }
}
