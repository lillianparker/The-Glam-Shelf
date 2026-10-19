import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase.js'
import Wordmark from './Wordmark.jsx'

const FILTERS = [
  ['all', 'All books'],
  ['avail', 'Available to borrow'],
  ['loved', 'Friends loved'],
  ['reading', "I'm reading"],
  ['want', 'My want-to-read'],
  ['inline', "I'm in line"],
  ['withme', 'Borrowed by me'],
  ['mine', 'Books I own'],
]

const VERDICTS = [
  ['up', 'Loved it'],
  ['meh', 'It was fine'],
  ['down', 'Not for me'],
]

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function joinNames(names) {
  if (names.length <= 2) return names.join(' and ')
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

export default function Library({ group, groups, profile, notice, clearNotice, onSwitchGroup, onProfileChange, onGroupsChange }) {
  const me = profile.id
  const [books, setBooks] = useState(null)
  const [members, setMembers] = useState([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [toast, setToast] = useState('')
  const toastTimer = useRef()

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  useEffect(() => { if (notice) { showToast(notice); clearNotice() } }, [notice, clearNotice, showToast])

  const load = useCallback(async () => {
    const [b, m] = await Promise.all([
      supabase
        .from('books')
        .select(
          'id, title, author, ' +
          'copies(id, owner_id, status, lendable, lent_to_user, lent_to_name, lent_at, created_at, queue(user_id, sort_key, joined_at)), ' +
          'reading(user_id, status, rating)'
        )
        .eq('group_id', group.id),
      supabase.from('group_members').select('user_id, profiles(display_name)').eq('group_id', group.id),
    ])
    if (b.error || m.error) { showToast(friendlyError(b.error || m.error)); return }
    for (const book of b.data) {
      for (const c of book.copies) {
        c.queue.sort((x, y) => x.sort_key - y.sort_key || x.joined_at.localeCompare(y.joined_at))
        c.book = { id: book.id, title: book.title }
      }
    }
    setBooks(b.data.sort((x, y) => x.title.localeCompare(y.title)))
    setMembers(m.data.map((r) => ({ id: r.user_id, name: r.profiles?.display_name || 'A friend' })))
  }, [group.id, showToast])

  // Initial load + live updates when friends change something.
  useEffect(() => {
    load()
    let timer
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 250) }
    const channel = supabase
      .channel('library-' + group.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: `group_id=eq.${group.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'copies' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reading' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${group.id}` }, refresh)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(channel) }
  }, [group.id, load])

  const nameOf = useMemo(() => {
    const map = Object.fromEntries(members.map((m) => [m.id, m.name]))
    return (id) => (id === me ? 'You' : map[id] || 'A former member')
  }, [members, me])

  async function run(promise, okMsg) {
    const { error } = await promise
    if (error) { showToast(friendlyError(error)); return false }
    if (okMsg) showToast(okMsg)
    load()
    return true
  }

  const actions = {
    addCopy: (title, author) =>
      run(supabase.rpc('add_copy', { gid: group.id, book_title: title, book_author: author }), `Added “${title}”`),
    setHome: (copy) =>
      run(supabase.from('copies').update({ status: 'home', lent_to_user: null, lent_to_name: null, lent_at: null }).eq('id', copy.id), 'Back on the shelf'),
    lendTo: (copy, userId) =>
      run(supabase.from('copies').update({ status: 'lent', lent_to_user: userId, lent_to_name: null, lent_at: new Date().toISOString() }).eq('id', copy.id),
        userId === me ? 'Enjoy the book!' : `Lent to ${nameOf(userId)}`),
    lendToName: (copy, name) =>
      run(supabase.from('copies').update({ status: 'lent', lent_to_user: null, lent_to_name: name, lent_at: new Date().toISOString() }).eq('id', copy.id), `Lent to ${name}`),
    removeCopy: (copy) => run(supabase.from('copies').delete().eq('id', copy.id), 'Removed from the shelf'),
    setLendable: (copy, lendable) =>
      run(supabase.from('copies').update({ lendable }).eq('id', copy.id), lendable ? 'Open for borrowing again' : 'Marked as not lending'),
    joinLine: (copy) => run(supabase.rpc('join_line', { cid: copy.id }), "You're in line"),
    leaveLine: (copy) => run(supabase.from('queue').delete().eq('copy_id', copy.id).eq('user_id', me), 'You left the line'),
    removeFromLine: (copy, uid) =>
      run(supabase.from('queue').delete().eq('copy_id', copy.id).eq('user_id', uid), `Took ${nameOf(uid)} off the line`),
    moveInLine: (copy, uid, direction) => run(supabase.rpc('move_in_line', { cid: copy.id, uid, direction })),
    passOn: (copy) => {
      const next = copy.queue[0]?.user_id
      return run(supabase.rpc('pass_on', { cid: copy.id }), next ? `Now with ${nameOf(next)}` : null)
    },
    setMark: (bookId, status) => {
      if (status === 'none') return run(supabase.from('reading').delete().eq('user_id', me).eq('book_id', bookId))
      const row = { user_id: me, book_id: bookId, status, updated_at: new Date().toISOString() }
      if (status !== 'read') row.rating = null
      return run(supabase.from('reading').upsert(row))
    },
    setRating: (bookId, rating) =>
      run(supabase.from('reading').update({ rating, updated_at: new Date().toISOString() }).eq('user_id', me).eq('book_id', bookId)),
  }

  // ----- filtering -----
  const myMark = (b) => b.reading.find((r) => r.user_id === me)?.status
  const tests = {
    all: () => true,
    avail: (b) => b.copies.some((c) => c.status === 'home' && c.lendable && c.owner_id !== me),
    loved: (b) => b.reading.some((r) => r.rating === 'up'),
    reading: (b) => myMark(b) === 'reading',
    want: (b) => myMark(b) === 'want',
    inline: (b) => b.copies.some((c) => c.queue.some((q) => q.user_id === me)),
    withme: (b) => b.copies.some((c) => c.lent_to_user === me),
    mine: (b) => b.copies.some((c) => c.owner_id === me),
  }
  const all = books || []
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter(tests[k]).length]))
  const q = query.trim().toLowerCase()
  const visible = all.filter(tests[filter]).filter((b) => !q || `${b.title} ${b.author}`.toLowerCase().includes(q))

  return (
    <div className="page">
      <header className="top">
        <div className="top-row">
          <Wordmark />
          <AccountMenu profile={profile} onProfileChange={onProfileChange} showToast={showToast} />
        </div>
        <GroupBar group={group} groups={groups} members={members} onSwitchGroup={onSwitchGroup} onGroupsChange={onGroupsChange} showToast={showToast} />
      </header>

      <main className="stack-lg">
        <ForYou books={all} me={me} nameOf={nameOf} actions={actions} />

        <input
          id="search"
          className="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a title or author, e.g. The Bell Jar"
          aria-label="Search books"
          autoComplete="off"
        />

        <div className="filters" role="group" aria-label="Filter books">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}<span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>

        <AddBook onAdd={actions.addCopy} />

        <section className="list" aria-live="polite">
          {books === null ? (
            <Empty title="Opening the shelves…" />
          ) : all.length === 0 ? (
            <Empty title="The shelf is empty">Add the first book you own with “+ Add a book you own” above, then send friends the invite link.</Empty>
          ) : visible.length === 0 ? (
            q ? <Empty title={`No one has “${query.trim()}”`}>Check the spelling, or try the author's name.</Empty>
              : <Empty title="Nothing here yet">Try a different filter.</Empty>
          ) : (
            visible.map((b) => (
              <BookCard key={b.id} book={b} me={me} members={members} nameOf={nameOf} actions={actions} />
            ))
          )}
        </section>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Empty({ title, children }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>
}

// Everything waiting on you: hand-offs to make, turns coming up, lines on your books.
function ForYou({ books, me, nameOf, actions }) {
  const items = []
  for (const b of books) {
    for (const c of b.copies) {
      const next = c.queue[0]?.user_id
      const isOwner = c.owner_id === me
      if (c.lent_to_user === me && next) {
        items.push({
          key: 'pass-' + c.id, kind: 'act',
          text: <>You have {nameOf(c.owner_id)}'s <i>{b.title}</i>. <b>{nameOf(next)}</b> is next in line.</>,
          button: <button className="btn small" onClick={() => actions.passOn(c)}>Gave it to {nameOf(next)}</button>,
        })
      } else if (isOwner && c.status === 'home' && next) {
        items.push({
          key: 'wait-' + c.id, kind: 'act',
          text: <><b>{nameOf(next)}</b> is waiting for your <i>{b.title}</i>.</>,
          button: <button className="btn small" onClick={() => actions.passOn(c)}>Gave it to {nameOf(next)}</button>,
        })
      } else if (isOwner && c.queue.length) {
        items.push({
          key: 'line-' + c.id, kind: 'info',
          text: <>{joinNames(c.queue.map((q) => nameOf(q.user_id)))} {c.queue.length === 1 ? 'is' : 'are'} in line for your <i>{b.title}</i>.</>,
        })
      }
      if (next === me) {
        const where = c.status === 'lent'
          ? `${c.lent_to_user ? nameOf(c.lent_to_user) : c.lent_to_name || 'a friend'} has it now`
          : `it's at ${nameOf(c.owner_id)}'s`
        items.push({ key: 'next-' + c.id, kind: 'info', text: <>You're next for {nameOf(c.owner_id)}'s <i>{b.title}</i>. {where[0].toUpperCase() + where.slice(1)}.</> })
      }
    }
  }
  if (!items.length) return null
  items.sort((a, b) => (a.kind === 'act' ? 0 : 1) - (b.kind === 'act' ? 0 : 1))
  return (
    <section className="foryou" aria-label="For you">
      <h2>For you</h2>
      <ul>
        {items.map((it) => (
          <li key={it.key} className={it.kind}>
            <span>{it.text}</span>
            {it.button}
          </li>
        ))}
      </ul>
    </section>
  )
}

function AddBook({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const titleRef = useRef()

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const ok = await onAdd(title.trim(), author.trim())
    setBusy(false)
    if (ok) { setTitle(''); setAuthor(''); titleRef.current?.focus() }
  }

  return (
    <details className="add" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
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
      </form>
    </details>
  )
}

function BookCard({ book, me, members, nameOf, actions }) {
  const who = (pred) => book.reading.filter(pred).map((r) => r.user_id)
  const wanters = who((r) => r.status === 'want')
  const readingNow = who((r) => r.status === 'reading')
  const loved = who((r) => r.rating === 'up')
  const fine = who((r) => r.rating === 'meh')
  const notFor = who((r) => r.rating === 'down')
  const readNoVerdict = who((r) => r.status === 'read' && !r.rating)
  const myRow = book.reading.find((r) => r.user_id === me)
  const mine = myRow?.status || 'none'
  const myRating = myRow?.rating || null
  const copies = [...book.copies].sort((a, b) => (b.owner_id === me) - (a.owner_id === me) || a.created_at.localeCompare(b.created_at))
  const names = (ids) => joinNames(ids.map(nameOf))

  return (
    <article className="card">
      <div>
        <h2 className="title">{book.title}</h2>
        {book.author && <p className="author">{book.author}</p>}
      </div>

      {(loved.length > 0 || fine.length > 0 || notFor.length > 0 || readNoVerdict.length > 0 || readingNow.length > 0 || wanters.length > 0) && (
        <div className="verdicts">
          {loved.length > 0 && <span className="v up">Loved by <b>{names(loved)}</b></span>}
          {fine.length > 0 && <span className="v meh">Fine for <b>{names(fine)}</b></span>}
          {notFor.length > 0 && <span className="v down">Not for <b>{names(notFor)}</b></span>}
          {readNoVerdict.length > 0 && <span className="v">Read by <b>{names(readNoVerdict)}</b></span>}
          {readingNow.length > 0 && <span className="v">Reading now: <b>{names(readingNow)}</b></span>}
          {wanters.length > 0 && <span className="v">Wants to read: <b>{names(wanters)}</b></span>}
        </div>
      )}

      <div className="copies">
        {copies.map((c) => (
          <CopyRow key={c.id} copy={c} me={me} members={members} nameOf={nameOf} actions={actions} />
        ))}
      </div>

      <div className="mine-row">
        <div className="segmented" role="group" aria-label="Your status for this book">
          {[['want', 'Want to read'], ['reading', 'Reading'], ['read', 'Read'], ['none', 'Neither']].map(([v, label]) => (
            <button key={v} type="button" aria-pressed={mine === v} onClick={() => mine !== v && actions.setMark(book.id, v)}>{label}</button>
          ))}
        </div>
        {mine === 'read' && (
          <div className="segmented verdict" role="group" aria-label="What did you think?">
            {VERDICTS.map(([v, label]) => (
              <button key={v} type="button" className={v} aria-pressed={myRating === v}
                onClick={() => actions.setRating(book.id, myRating === v ? null : v)}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function CopyRow({ copy, me, members, nameOf, actions }) {
  const isOwner = copy.owner_id === me
  const isHolder = copy.lent_to_user === me
  const [confirming, setConfirming] = useState(null) // 'remove' | 'stop'
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherName, setOtherName] = useState(copy.lent_to_name || '')

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
        <select id={`loc-${copy.id}`} aria-label="Where is this copy?" value={otherOpen ? '__other' : selectValue} onChange={onSelect}>
          <option value="home">At my home</option>
          {others.map((m) => <option key={m.id} value={m.id}>With {m.name}</option>)}
          <option value="__other">With someone else…</option>
        </select>
        {otherOpen && (
          <form className="inline" onSubmit={(e) => { e.preventDefault(); if (otherName.trim()) { actions.lendToName(copy, otherName.trim()); setOtherOpen(false) } }}>
            <input id={`other-${copy.id}`} autoFocus maxLength={60} placeholder="Their name" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
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
    <div className="copy">
      <div className="copy-main">
        <span className="owner">{isOwner ? 'Your copy' : `${nameOf(copy.owner_id)}'s copy`}</span>
        {chip}
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

      {isOwner && (
        <div className="owner-tools">
          {confirming === 'stop' ? (
            <>
              <span className="small">Stop lending? This clears the line ({line.length}).</span>
              <button type="button" className="btn small danger" onClick={() => { setConfirming(null); actions.setLendable(copy, false) }}>Stop lending</button>
              <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>Cancel</button>
            </>
          ) : confirming === 'remove' ? (
            <>
              <span className="small">Remove your copy from the shelf?</span>
              <button type="button" className="btn small danger" onClick={() => actions.removeCopy(copy)}>Yes, remove</button>
              <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>Keep</button>
            </>
          ) : (
            <>
              <button type="button" className="linkish small"
                onClick={() => copy.lendable ? (line.length ? setConfirming('stop') : actions.setLendable(copy, false)) : actions.setLendable(copy, true)}>
                {copy.lendable ? 'Not lending this one' : 'Start lending again'}
              </button>
              <button type="button" className="linkish small muted" onClick={() => setConfirming('remove')}>Remove</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GroupBar({ group, groups, members, onSwitchGroup, onGroupsChange, showToast }) {
  const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${group.invite_code}`
  const [showLink, setShowLink] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      showToast('Invite link copied. Send it to a friend.')
    } catch {
      setShowLink(true)
    }
  }

  async function createGroup(e) {
    e.preventDefault()
    const { data, error } = await supabase.rpc('create_group', { group_name: newName.trim() })
    if (error) { showToast(friendlyError(error)); return }
    setCreating(false); setNewName('')
    await onGroupsChange()
    onSwitchGroup(data.id)
  }

  return (
    <div className="groupbar">
      <div className="group-name">
        {groups.length > 1 ? (
          <select id="group-switch" aria-label="Library" value={group.id} onChange={(e) => onSwitchGroup(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : (
          <span className="gname">{group.name}</span>
        )}
        <span className="muted small">{members.length} {members.length === 1 ? 'member' : 'members'}</span>
      </div>
      <div className="group-actions">
        <button type="button" className="btn small" onClick={copy}>Copy invite link</button>
        <button type="button" className="btn small ghost" onClick={() => setCreating((v) => !v)}>New library</button>
      </div>
      {showLink && (
        <div className="linkbox">
          <span className="muted small">Copy this link and send it to a friend:</span>
          <input id="invite-url" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
        </div>
      )}
      {creating && (
        <form className="linkbox inline" onSubmit={createGroup}>
          <input id="new-group-name" autoFocus required maxLength={80} placeholder="New library name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn small">Create</button>
        </form>
      )}
    </div>
  )
}

function AccountMenu({ profile, onProfileChange, showToast }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.display_name)

  async function save(e) {
    e.preventDefault()
    const { data, error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', profile.id).select().single()
    if (error) { showToast(friendlyError(error)); return }
    onProfileChange(data); setEditing(false); showToast('Name updated')
  }

  if (editing) {
    return (
      <form className="account inline" onSubmit={save}>
        <input id="edit-name" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
        <button className="btn small">Save</button>
        <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
      </form>
    )
  }
  return (
    <div className="account">
      <button type="button" className="linkish" onClick={() => setEditing(true)} title="Change your name">{profile.display_name}</button>
      <button type="button" className="linkish muted" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}
