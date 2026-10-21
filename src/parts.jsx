// Pieces shared by the bookcase listing and the "All books" list.
import { useRef, useState } from 'react'

export const VERDICTS = [
  ['up', 'Loved it'],
  ['good', 'It was good'],
  ['meh', 'It was fine'],
  ['down', 'Not for me'],
]

export const STATUSES = [
  ['want', 'Want to read'],
  ['reading', 'Reading'],
  ['read', 'Read'],
  ['none', 'None'],
]

export function fmtDate(iso, { year = false } = {}) {
  if (!iso) return ''
  const d = new Date(iso)
  const showYear = year || d.getFullYear() !== new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}) })
}

export function joinNames(names) {
  if (names.length <= 2) return names.join(' and ')
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

export function Empty({ title, children }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>
}

export function ScoreLine({ s }) {
  return (
    <p className="scoreline">
      <b>{s.total} points</b>
      <span>{s.owned} {s.owned === 1 ? 'book' : 'books'} owned × 1</span>
      <span>{s.lent} {s.lent === 1 ? 'lend' : 'lends'} × 2</span>
      <span>{s.read} read × 5</span>
    </p>
  )
}

export function isStarred(book, members) {
  const readIds = new Set(book.reading.filter((r) => r.status === 'read').map((r) => r.user_id))
  return members.length >= 2 && members.every((m) => readIds.has(m.id))
}

// "Loved by Ted and Ann · Fine for Sam · Reading now: Fred …"
export function Verdicts({ book, nameOf }) {
  const who = (pred) => book.reading.filter(pred).map((r) => r.user_id)
  const names = (ids) => joinNames(ids.map(nameOf))
  const groups = [
    ['up', 'Loved by ', who((r) => r.rating === 'up')],
    ['good', 'Liked by ', who((r) => r.rating === 'good')],
    ['meh', 'Fine for ', who((r) => r.rating === 'meh')],
    ['down', 'Not for ', who((r) => r.rating === 'down')],
    ['', 'Read by ', who((r) => r.status === 'read' && !r.rating)],
    ['', 'Reading now: ', who((r) => r.status === 'reading')],
    ['', 'Wants to read: ', who((r) => r.status === 'want')],
  ].filter(([, , ids]) => ids.length)
  if (!groups.length) return null
  return (
    <div className="verdicts">
      {groups.map(([cls, label, ids]) => (
        <span key={label} className={`v ${cls}`}>{label}<b>{names(ids)}</b></span>
      ))}
    </div>
  )
}

// Your status + verdict for a title. Saved in the `reading` table.
// layout="compact": pill rows (list view; verdict appears once you've read it).
// layout="labeled": labelled groups (book listing; picking a verdict also marks it Read).
export function ReadingControls({ book, me, actions, layout = 'compact' }) {
  const myRow = book.reading.find((r) => r.user_id === me)
  const mine = myRow?.status || 'none'
  const myRating = myRow?.rating || null
  const pickStatus = (v) => mine !== v && actions.setMark(book.id, v)
  const pickRating = (v) => actions.rate(book.id, myRating === v ? null : v, mine)

  if (layout === 'labeled') {
    return (
      <>
        <div className="choice-group" role="group" aria-labelledby={`status-${book.id}`}>
          <span id={`status-${book.id}`}>Reading status</span>
          <div>
            {STATUSES.map(([v, label]) => (
              <button key={v} type="button" aria-pressed={mine === v} onClick={() => pickStatus(v)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="choice-group" role="group" aria-labelledby={`take-${book.id}`}>
          <span id={`take-${book.id}`}>Your take</span>
          <div>
            {VERDICTS.map(([v, label]) => (
              <button key={v} type="button" className={v} aria-pressed={myRating === v} onClick={() => pickRating(v)}>{label}</button>
            ))}
          </div>
          {mine !== 'read' && <p className="hint">Picking one also marks the book as Read.</p>}
        </div>
      </>
    )
  }

  return (
    <div className="mine-row">
      <div className="segmented" role="group" aria-label="Your status for this book">
        {STATUSES.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={mine === v} onClick={() => pickStatus(v)}>{label}</button>
        ))}
      </div>
      {mine === 'read' && (
        <div className="segmented verdict" role="group" aria-label="What did you think?">
          {VERDICTS.map(([v, label]) => (
            <button key={v} type="button" className={v} aria-pressed={myRating === v} onClick={() => pickRating(v)}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AddBook({ onAdd, open: openProp, onOpenChange }) {
  const [everywhere, setEverywhere] = useState(true)
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (v) => { setOpenState(v); onOpenChange?.(v) }
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const titleRef = useRef()

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const ok = await onAdd(title.trim(), author.trim(), everywhere)
    setBusy(false)
    if (ok) { setTitle(''); setAuthor(''); titleRef.current?.focus() }
  }

  return (
    <details className="add" open={open} onToggle={(e) => { if (e.currentTarget.open !== open) setOpen(e.currentTarget.open) }}>
      <summary>+ Add a book you own</summary>
      <form onSubmit={submit} className="add-form">
        <label className="field">
          <span>Title</span>
          <input id="add-title" ref={titleRef} required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Author</span>
          <input id="add-author" maxLength={200} value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <button className="btn" disabled={busy || !title.trim()}>Add to shelf</button>
        <label className="check add-everywhere" htmlFor="add-everywhere">
          <input id="add-everywhere" type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
          <span>Show it in all my libraries <em>(including ones I join later)</em></span>
        </label>
      </form>
    </details>
  )
}

// One physical copy: where it is, the borrowing line, and the owner's tools.
// compact: hide the "Your copy / At your home" header (the listing shows it above).
// hideHistory: the listing shows history in its Library log tab instead.
export function CopyRow({ copy, me, members, nameOf, actions, compact = false, hideHistory = false }) {
  const isOwner = copy.owner_id === me
  const isHolder = copy.lent_to_user === me
  const [confirming, setConfirming] = useState(null) // 'remove' | 'stop' | 'edit' | 'give'
  const [giveTo, setGiveTo] = useState('')
  const [editTitle, setEditTitle] = useState(copy.book.title)
  const [editAuthor, setEditAuthor] = useState(copy.book.author || '')
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherName, setOtherName] = useState(copy.lent_to_name || '')
  const [showHistory, setShowHistory] = useState(false)
  const loans = copy.loans || []
  const pastLoans = loans.filter((l) => l.returned_at)

  const line = copy.queue
  const next = line[0]?.user_id
  const myPlace = line.findIndex((q) => q.user_id === me)
  const holder = copy.lent_to_user ? nameOf(copy.lent_to_user) : copy.lent_to_name || 'a friend'
  const others = members.filter((m) => m.id !== me)
  const selectValue = copy.status === 'lent'
    ? (copy.lent_to_user && others.some((m) => m.id === copy.lent_to_user) ? copy.lent_to_user : '__other')
    : 'home'

  function onSelect(e) {
    const v = e.target.value
    if (v === '__other') { setOtherOpen(true); return }
    setOtherOpen(false)
    if (v === 'home') actions.setHome(copy)
    else actions.lendTo(copy, v)
  }

  let chip
  if (copy.status === 'lent') {
    chip = <span className="chip lent">With {holder === 'You' ? 'you' : holder}{copy.lent_at ? ` · since ${fmtDate(copy.lent_at)}` : ''}</span>
  } else {
    chip = <span className="chip home">{isOwner ? 'At your home' : `At ${nameOf(copy.owner_id)}'s`}</span>
  }

  let controls = null
  if (isOwner) {
    controls = (
      <>
        <label className="sr-only" htmlFor={`loc-${copy.id}`}>Where is this copy?</label>
        <select id={`loc-${copy.id}`} value={otherOpen ? '__other' : selectValue} onChange={onSelect}>
          <option value="home">At my home</option>
          {others.map((m) => <option key={m.id} value={m.id}>With {m.name}</option>)}
          <option value="__other">With someone else…</option>
        </select>
        {otherOpen && (
          <form className="inline" onSubmit={(e) => { e.preventDefault(); if (otherName.trim()) { actions.lendToName(copy, otherName.trim()); setOtherOpen(false) } }}>
            <input id={`other-${copy.id}`} autoFocus maxLength={60} placeholder="Their name" aria-label="Their name" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
            <button className="btn small">Save</button>
          </form>
        )}
        {copy.status === 'home' && next && (
          <button type="button" className="btn small" onClick={() => actions.passOn(copy)}>Gave it to {nameOf(next)}</button>
        )}
      </>
    )
  } else if (isHolder) {
    controls = (
      <>
        {next && <button type="button" className="btn small" onClick={() => actions.passOn(copy)}>Gave it to {nameOf(next)}</button>}
        <button type="button" className="btn small ghost" onClick={() => actions.setHome(copy)}>Gave it back to {nameOf(copy.owner_id)}</button>
      </>
    )
  } else if (myPlace >= 0) {
    controls = (
      <>
        <span className="place">{myPlace === 0 ? "You're next" : `You're #${myPlace + 1} in line`}</span>
        <button type="button" className="btn small ghost" onClick={() => actions.leaveLine(copy)}>Leave line</button>
      </>
    )
  } else if (copy.lendable) {
    controls = (
      <>
        <button type="button" className="btn small" onClick={() => actions.joinLine(copy)}>Get in line</button>
        {copy.status === 'home' && line.length === 0 && (
          <button type="button" className="btn small ghost" onClick={() => actions.lendTo(copy, me)}>I already borrowed it</button>
        )}
      </>
    )
  }

  return (
    <div className={`copy${compact ? ' compact' : ''}`}>
      <div className="copy-main">
        {!compact && <span className="owner">{isOwner ? 'Your copy' : `${nameOf(copy.owner_id)}'s copy`}</span>}
        {!compact && chip}
        {!copy.lendable && <span className="chip off">Not lending</span>}
        <div className="ctrl">{controls}</div>
      </div>

      {line.length > 0 && (
        <ol className="line" aria-label="Line to borrow this copy">
          <li className="line-label">In line</li>
          {line.map((q, i) => (
            <li key={q.user_id} className={q.user_id === me ? 'me' : ''}>
              <span className="n">{i + 1}</span>{nameOf(q.user_id)}
              {isOwner && (
                <span className="line-ctrl">
                  <button type="button" aria-label={`Move ${nameOf(q.user_id)} up`} disabled={i === 0} onClick={() => actions.moveInLine(copy, q.user_id, -1)}>↑</button>
                  <button type="button" aria-label={`Move ${nameOf(q.user_id)} down`} disabled={i === line.length - 1} onClick={() => actions.moveInLine(copy, q.user_id, 1)}>↓</button>
                  <button type="button" aria-label={`Take ${nameOf(q.user_id)} off the line`} onClick={() => actions.removeFromLine(copy, q.user_id)}>×</button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {!hideHistory && loans.length > 0 && (
        <div className="history">
          <button type="button" className="linkish small muted" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide history' : `Borrowing history · ${pastLoans.length === 0 ? 'first time out' : `lent ${loans.length} ${loans.length === 1 ? 'time' : 'times'}`}`}
          </button>
          {showHistory && (
            <ol className="history-list">
              {loans.map((l) => (
                <li key={l.id}>
                  <b>{l.borrower_id ? nameOf(l.borrower_id) : l.borrower_name || 'A friend'}</b>
                  <span className="muted">{fmtDate(l.lent_at)} – {l.returned_at ? fmtDate(l.returned_at) : 'now'}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {isOwner && (
        <div className="owner-tools">
          {confirming === 'stop' ? (
            <>
              <span className="small">Stop lending? This clears the line ({line.length}).</span>
              <button type="button" className="btn small danger" onClick={() => { setConfirming(null); actions.setLendable(copy, false) }}>Stop lending</button>
              <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>Cancel</button>
            </>
          ) : confirming === 'edit' ? (
            <form className="edit-form" onSubmit={async (e) => {
              e.preventDefault()
              if (!editTitle.trim()) return
              const ok = await actions.editCopy(copy, editTitle.trim(), editAuthor.trim())
              if (ok) setConfirming(null)
            }}>
              <label className="field">
                <span>Title</span>
                <input id={`edit-title-${copy.id}`} autoFocus required maxLength={300} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>Author</span>
                <input id={`edit-author-${copy.id}`} maxLength={200} value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} />
              </label>
              <div className="edit-actions">
                <button className="btn small" disabled={!editTitle.trim()}>Save</button>
                <button type="button" className="btn small ghost" onClick={() => { setConfirming(null); setEditTitle(copy.book.title); setEditAuthor(copy.book.author || '') }}>Cancel</button>
              </div>
            </form>
          ) : confirming === 'give' ? (
            <div className="give-form">
              <label className="field" htmlFor={`give-${copy.id}`}>
                <span>Whose book is it?</span>
                <select id={`give-${copy.id}`} value={giveTo} onChange={(e) => setGiveTo(e.target.value)}>
                  <option value="">Choose a friend…</option>
                  {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              {giveTo && (
                <p className="small give-note">
                  It moves to {members.find((m) => m.id === giveTo)?.name}’s shelf, with its notes and history, and leaves your other libraries.
                  After that, only {members.find((m) => m.id === giveTo)?.name} can change it.
                </p>
              )}
              <div className="edit-actions">
                <button type="button" className="btn small" disabled={!giveTo}
                  onClick={async () => { if (await actions.giveCopy(copy, giveTo)) { setConfirming(null); setGiveTo('') } }}>
                  {giveTo ? `Move to ${members.find((m) => m.id === giveTo)?.name}’s shelf` : 'Move'}
                </button>
                <button type="button" className="btn small ghost" onClick={() => { setConfirming(null); setGiveTo('') }}>Cancel</button>
              </div>
            </div>
          ) : confirming === 'remove' ? (
            <>
              <span className="small">{copy.everywhere ? 'Remove your copy from all your libraries?' : 'Remove your copy from the shelf?'}</span>
              <button type="button" className="btn small danger" onClick={() => actions.removeCopy(copy)}>Yes, remove</button>
              <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>Keep</button>
            </>
          ) : (
            <>
              <button type="button" className="linkish small"
                onClick={() => copy.lendable ? (line.length ? setConfirming('stop') : actions.setLendable(copy, false)) : actions.setLendable(copy, true)}>
                {copy.lendable ? 'Not lending this one' : 'Start lending again'}
              </button>
              <label className="check small" htmlFor={`everywhere-${copy.id}`}>
                <input id={`everywhere-${copy.id}`} type="checkbox" checked={Boolean(copy.everywhere)}
                  onChange={(e) => actions.setEverywhere(copy, e.target.checked)} />
                <span>In all my libraries</span>
              </label>
              <button type="button" className="linkish small" onClick={() => { setEditTitle(copy.book.title); setEditAuthor(copy.book.author || ''); setConfirming('edit') }}>Edit title or author</button>
              {others.length > 0 && (
                <button type="button" className="linkish small" onClick={() => setConfirming('give')}>This is actually a friend’s</button>
              )}
              <button type="button" className="linkish small muted" onClick={() => setConfirming('remove')}>Remove</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
