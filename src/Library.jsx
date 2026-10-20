import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase.js'
import Wordmark from './Wordmark.jsx'
import Bookcase from './Bookcase.jsx'
import BookListing from './BookListing.jsx'
import LibraryCard from './LibraryCard.jsx'
import AvatarPicker, { AvatarBadge } from './AvatarPicker.jsx'
import { scoreMembers, shelfCopies } from './shelf.js'
import { AddBook, CopyRow, Empty, ReadingControls, ScoreLine, Verdicts, isStarred, joinNames } from './parts.jsx'

export { POINTS } from './shelf.js'

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

const HOMEPAGE_HEADLINE = <>Full <em>Glam</em> required.</>
const HOMEPAGE_TEXT = 'Search for books, upload ones you own, and borrow from friends. Earn points by adding, lending, and reading.'

// Members with their names and avatars. If the avatar column doesn't exist yet
// (update-5.sql not run), load without it so nothing else breaks.
async function loadMembers(groupId) {
  const res = await supabase.from('group_members').select('user_id, joined_at, profiles(display_name, avatar)').eq('group_id', groupId)
  if (res.error && /avatar/i.test(res.error.message || '')) {
    return supabase.from('group_members').select('user_id, joined_at, profiles(display_name)').eq('group_id', groupId)
  }
  return res
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export default function Library({ group, groups, profile, notice, clearNotice, onSwitchGroup, onProfileChange, onGroupsChange }) {
  const me = profile.id
  const [books, setBooks] = useState(null)
  const [members, setMembers] = useState([])
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState('home')          // 'home' (bookcase) | 'all' (list)
  const [expandedOwner, setExpandedOwner] = useState(null) // whose complete shelf is open on the bookcase
  const [selectedCopyId, setSelectedCopyId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [person, setPerson] = useState(null)       // whose shelf we're looking at in the list
  const [personTab, setPersonTab] = useState('owns')
  const [toast, setToast] = useState('')
  const toastTimer = useRef()
  const listingHeadingRef = useRef(null)
  const searchRef = useRef(null)
  const focusSearch = useRef(false)

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
          'copies(id, owner_id, status, lendable, lent_to_user, lent_to_name, lent_at, created_at, queue(user_id, sort_key, joined_at), loans(id, borrower_id, borrower_name, lent_at, returned_at)), ' +
          'reading(user_id, status, rating)'
        )
        .eq('group_id', group.id),
      loadMembers(group.id),
    ])
    if (b.error || m.error) {
      const msg = friendlyError(b.error || m.error)
      setLoadError(msg)
      showToast(msg)
      return
    }
    setLoadError('')
    for (const book of b.data) {
      for (const c of book.copies) {
        c.queue.sort((x, y) => x.sort_key - y.sort_key || x.joined_at.localeCompare(y.joined_at))
        // chronological (oldest first), the order the library log reads
        c.loans = [...(c.loans || [])].sort((x, y) => x.lent_at.localeCompare(y.lent_at))
        c.book = { id: book.id, title: book.title, author: book.author }
      }
    }
    setBooks(b.data.sort((x, y) => x.title.localeCompare(y.title)))
    setMembers(m.data.map((r) => ({ id: r.user_id, name: r.profiles?.display_name || 'A friend', avatar: r.profiles?.avatar || null, joinedAt: r.joined_at })))
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${group.id}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, refresh)
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
    editCopy: (copy, title, author) =>
      run(supabase.rpc('edit_copy', { cid: copy.id, new_title: title, new_author: author }), 'Book details saved'),
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
    // A verdict only exists on a book you've read, so rating an unread book marks it Read too.
    rate: (bookId, rating, currentStatus) => {
      if (currentStatus === 'read') return actions.setRating(bookId, rating)
      if (rating === null) return Promise.resolve(true)
      return run(supabase.from('reading').upsert({ user_id: me, book_id: bookId, status: 'read', rating, updated_at: new Date().toISOString() }))
    },
  }

  async function saveAvatar(id) {
    if (id === profile.avatar) return
    setSavingAvatar(true)
    const { data, error } = await supabase.from('profiles').update({ avatar: id }).eq('id', me).select().single()
    setSavingAvatar(false)
    if (error) {
      showToast(/avatar/i.test(error.message || '') ? 'Avatars need the latest database update (update-5.sql).' : friendlyError(error))
      return
    }
    onProfileChange(data)
    load()
  }

  // ----- list view filtering -----
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
  const markOf = (b, uid) => b.reading.find((r) => r.user_id === uid)
  const personTests = {
    owns: (b) => b.copies.some((c) => c.owner_id === person),
    reading: (b) => markOf(b, person)?.status === 'reading',
    read: (b) => markOf(b, person)?.status === 'read',
    want: (b) => markOf(b, person)?.status === 'want',
    has: (b) => b.copies.some((c) => c.lent_to_user === person),
  }
  const personCounts = person ? Object.fromEntries(Object.keys(personTests).map((k) => [k, all.filter(personTests[k]).length])) : {}
  const visible = all
    .filter(person ? personTests[personTab] : tests[filter])
    .filter((b) => !q || `${b.title} ${b.author}`.toLowerCase().includes(q))
  const scores = useMemo(() => scoreMembers(books || [], members), [books, members])

  // ----- bookcase selection -----
  const findEntry = (id) => {
    if (!id) return null
    for (const b of all) for (const c of b.copies) if (c.id === id) return { copy: c, book: b }
    return null
  }
  // Default to the first book on your shelf (or anyone's) until a spine is picked.
  const defaultEntry = shelfCopies(all, me)[0] || members.map((m) => shelfCopies(all, m.id)[0]).find(Boolean) || null
  const entry = findEntry(selectedCopyId) || defaultEntry

  function openCopy(id) {
    setSelectedCopyId(id)
    requestAnimationFrame(() => {
      const h = listingHeadingRef.current
      if (!h) return
      h.focus({ preventScroll: true })
      h.closest('.listing')?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    })
  }

  function go(next, opts = {}) {
    setView(next)
    if (next === 'home') setExpandedOwner(opts.expand ?? null)
    if (next === 'all') { setPerson(opts.person ?? null); setPersonTab('owns') }
    window.scrollTo?.({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  // Member chips: on the bookcase they open that person's complete shelf; in the list they filter.
  const openShelf = (uid) => {
    if (view === 'home') { setExpandedOwner(uid); window.scrollTo?.({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }) }
    else { setPerson(uid); setPersonTab('owns'); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }
  }

  useEffect(() => {
    if (view === 'all' && focusSearch.current) { focusSearch.current = false; searchRef.current?.focus() }
  }, [view])

  const myMember = members.find((m) => m.id === me)
  const navItems = [
    ['bookcase', 'Bookcase', view === 'home' && !expandedOwner, () => go('home')],
    ['mine', 'My shelf', view === 'home' && expandedOwner === me, () => go('home', { expand: me })],
    ['all', 'All books', view === 'all', () => go('all')],
  ]

  return (
    <div className="page">
      <header className="topbar">
        <Wordmark as="p" />
        <nav aria-label="Main">
          {navItems.map(([key, label, active, onClick]) => (
            <button key={key} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}>{label}</button>
          ))}
        </nav>
        <div className="user-actions">
          <button type="button" className="icon-button" aria-label="Search books"
            onClick={() => { focusSearch.current = true; if (view === 'all') searchRef.current?.focus(); else go('all') }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          </button>
          <button type="button" className="avatar-button" aria-expanded={avatarOpen} aria-controls="avatar-panel"
            aria-label={profile.avatar ? 'Change your avatar' : 'Choose your avatar'} title={profile.avatar ? 'Change your avatar' : 'Choose your avatar'}
            onClick={() => setAvatarOpen((v) => !v)}>
            <AvatarBadge id={profile.avatar} name={profile.display_name} size="md" />
          </button>
          <AccountMenu profile={profile} onProfileChange={onProfileChange} showToast={showToast} />
        </div>
      </header>

      {avatarOpen && (
        <section className="avatar-panel" id="avatar-panel" aria-labelledby="avatar-panel-title">
          <div className="avatar-panel-head">
            <div>
              <h2 id="avatar-panel-title">Your shelf object</h2>
              <p className="muted small">It sits at the end of your shelf and next to your name.</p>
            </div>
            <button type="button" className="btn small ghost" onClick={() => setAvatarOpen(false)}>Done</button>
          </div>
          <AvatarPicker value={profile.avatar} onChange={saveAvatar} busy={savingAvatar} />
        </section>
      )}

      <GroupBar group={group} groups={groups} members={members} scores={scores} me={me} profile={profile}
        person={view === 'home' ? expandedOwner : person} onOpenShelf={openShelf}
        onSwitchGroup={onSwitchGroup} onGroupsChange={onGroupsChange} showToast={showToast} />

      {view === 'home' ? (
        <main className="home stack-lg">
          <h1 className="sr-only">{group.name} bookcase</h1>
          <section className="intro">
            <div>              
              <p>{HOMEPAGE_TEXT}</p>
            </div>
            <button type="button" className="btn primary" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> Add a book
            </button>
          </section>

          {addOpen && <AddBook onAdd={actions.addCopy} open onOpenChange={setAddOpen} />}

          <ForYou books={all} me={me} nameOf={nameOf} actions={actions} />

          <Bookcase
            books={books}
            members={members}
            me={me}
            myName={profile.display_name}
            myAvatar={profile.avatar}
            onChooseAvatar={() => { setAvatarOpen(true); window.scrollTo?.({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }) }}
            nameOf={nameOf}
            selectedCopyId={entry?.copy.id}
            expandedOwner={expandedOwner}
            onOpenCopy={openCopy}
            onExpand={setExpandedOwner}
            onCollapse={() => setExpandedOwner(null)}
            onViewList={(uid) => go('all', { person: uid })}
            loading={books === null && !loadError}
            error={loadError}
            onRetry={load}
          />

          <div className="content-grid">
            {books !== null && (
              <BookListing
                key={entry?.copy.id || 'none'}
                ref={listingHeadingRef}
                entry={entry}
                me={me}
                myName={profile.display_name}
                members={members}
                nameOf={nameOf}
                actions={actions}
                showToast={showToast}
                onAddBook={() => { setAddOpen(true); window.scrollTo?.({ top: 0 }) }}
              />
            )}
            <LibraryCard name={profile.display_name} avatar={profile.avatar} libraryName={group.name} joinedAt={myMember?.joinedAt} score={scores[me]} />
          </div>
        </main>
      ) : (
        <main className="list-view stack-lg">
          <h1 className="view-title">All books</h1>
          <ForYou books={all} me={me} nameOf={nameOf} actions={actions} />

          <input
            id="search"
            ref={searchRef}
            className="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a title or author, e.g. The Bell Jar"
            aria-label="Search books"
            autoComplete="off"
          />

          {person ? (
            <div className="shelf-head">
              <div className="shelf-title">
                <h2>{person === me ? 'Your shelf' : `${nameOf(person)}'s shelf`}</h2>
                <button type="button" className="linkish small" onClick={() => setPerson(null)}>Back to all books</button>
                <button type="button" className="linkish small" onClick={() => go('home', { expand: person })}>See it on the bookcase</button>
              </div>
              {scores[person] && <ScoreLine s={scores[person]} />}
              <div className="filters" role="group" aria-label="Filter this shelf">
                {[['owns', 'Owns'], ['reading', 'Reading'], ['read', 'Has read'], ['want', 'Wants to read'], ['has', 'Borrowing now']].map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={personTab === k} onClick={() => setPersonTab(k)}>
                    {label}<span className="count">{personCounts[k]}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="filters" role="group" aria-label="Filter books">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}<span className="count">{counts[k]}</span>
                </button>
              ))}
            </div>
          )}

          <AddBook onAdd={actions.addCopy} />

          <section className="list" aria-live="polite">
            {books === null ? (
              loadError
                ? <Empty title="Couldn't open the shelves">{loadError} <button type="button" className="linkish" onClick={load}>Try again</button></Empty>
                : <Empty title="Opening the shelves…" />
            ) : all.length === 0 ? (
              <Empty title="The shelf is empty">Add the first book you own with “+ Add a book you own” above, then send friends the invite link.</Empty>
            ) : visible.length === 0 ? (
              q ? <Empty title={`No one has “${query.trim()}”`}>Check the spelling, or try the author's name.</Empty>
                : <Empty title="Nothing here yet">{person ? 'Nothing in this part of their shelf yet.' : 'Try a different filter.'}</Empty>
            ) : (
              visible.map((b) => (
                <BookCard key={b.id} book={b} me={me} members={members} nameOf={nameOf} actions={actions} />
              ))
            )}
          </section>
        </main>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
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

function BookCard({ book, me, members, nameOf, actions }) {
  const copies = [...book.copies].sort((a, b) => (b.owner_id === me) - (a.owner_id === me) || a.created_at.localeCompare(b.created_at))
  return (
    <article className="card">
      <div>
        <h2 className="title">
          {book.title}
          {isStarred(book, members) && <span className="star" title="Everyone in the library has read this">★ Read by everyone</span>}
        </h2>
        {book.author && <p className="author">{book.author}</p>}
      </div>

      <Verdicts book={book} nameOf={nameOf} />

      <div className="copies">
        {copies.map((c) => (
          <CopyRow key={c.id} copy={c} me={me} members={members} nameOf={nameOf} actions={actions} />
        ))}
      </div>

      <ReadingControls book={book} me={me} actions={actions} />
    </article>
  )
}

function GroupBar({ group, groups, members, scores, me, profile, person, onOpenShelf, onSwitchGroup, onGroupsChange, showToast }) {
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
      </div>
      <div className="group-actions">
        <button type="button" className="btn small" onClick={copy}>Copy invite link</button>
        <button type="button" className="btn small ghost" onClick={() => setCreating((v) => !v)}>New library</button>
      </div>
      <ul className="members" aria-label="Members">
        {[...members]
          .sort((a, b) => (scores[b.id]?.total || 0) - (scores[a.id]?.total || 0) || a.name.localeCompare(b.name))
          .map((m) => (
          <li key={m.id}>
            <button type="button" aria-pressed={person === m.id} onClick={() => onOpenShelf(m.id)}
              aria-label={`${m.id === me ? 'You' : m.name}, ${scores[m.id]?.total || 0} points`}>
              <AvatarBadge id={m.id === me ? profile.avatar : m.avatar} name={m.name} />
              {m.id === me ? 'You' : m.name}
              <span className="pts">{scores[m.id]?.total || 0}</span>
            </button>
          </li>
        ))}
      </ul>
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
  const [mode, setMode] = useState(null) // 'name' | 'password'
  const [name, setName] = useState(profile.display_name)
  const [password, setPassword] = useState('')

  async function saveName(e) {
    e.preventDefault()
    const { data, error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', profile.id).select().single()
    if (error) { showToast(friendlyError(error)); return }
    onProfileChange(data); setMode(null); showToast('Name updated')
  }

  async function savePassword(e) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { showToast(friendlyError(error)); return }
    setPassword(''); setMode(null)
    showToast('Password saved. Next time, sign in with your email and password.')
  }

  if (mode === 'name') {
    return (
      <form className="account inline" onSubmit={saveName}>
        <input id="edit-name" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
        <button className="btn small">Save</button>
        <button type="button" className="btn small ghost" onClick={() => setMode(null)}>Cancel</button>
      </form>
    )
  }
  if (mode === 'password') {
    return (
      <form className="account inline" onSubmit={savePassword}>
        <input id="set-password" type="password" autoFocus required minLength={8} autoComplete="new-password"
          placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="New password" />
        <button className="btn small">Save</button>
        <button type="button" className="btn small ghost" onClick={() => { setPassword(''); setMode(null) }}>Cancel</button>
      </form>
    )
  }
  return (
    <div className="account">
      <button type="button" className="linkish" onClick={() => setMode('name')} title="Change your name">{profile.display_name}</button>
      <button type="button" className="linkish muted" onClick={() => setMode('password')}>Set password</button>
      <button type="button" className="linkish muted" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}

