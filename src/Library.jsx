import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase.js'
import Wordmark from './Wordmark.jsx'
import Bookcase from './Bookcase.jsx'
import { BookCover } from './BookListing.jsx'
import BookModal from './BookModal.jsx'
import Play from './Play.jsx'
import Activity, { WantedFromShelf } from './Activity.jsx'
import LibraryCard from './LibraryCard.jsx'
import AvatarPicker, { AvatarBadge } from './AvatarPicker.jsx'
import { bookcaseTones, compareTitles, scoreMembers, spineTone } from './shelf.js'
import { cardNumber, rankBoard, withRound } from './leaderboard.js'
import { findCover } from './covers.js'
import { AddBook, Empty, ScoreLine, joinNames } from './parts.jsx'

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
// Books with their copies, line, loans and reading. Newer columns (covers: update-9.sql,
// spine color: update-10.sql) are left out if the database doesn't have them yet, so nothing else breaks.
function booksQuery({ covers, tone }) {
  return (
    'id, title, author, ' + (covers ? 'cover_id, cover_looked, ' : '') +
    'copies(id, owner_id, status, lendable, lent_to_user, lent_to_name, lent_at, created_at, item_id, everywhere, ' + (tone ? 'tone, ' : '') +
    'queue(user_id, sort_key, joined_at), loans(id, borrower_id, borrower_name, lent_at, returned_at)), ' +
    'reading(user_id, status, rating, updated_at)'
  )
}
async function loadBooks(groupId) {
  const has = { covers: true, tone: true }
  for (let tries = 0; tries < 3; tries++) {
    const res = await supabase.from('books').select(booksQuery(has)).eq('group_id', groupId)
    const msg = res.error?.message || ''
    if (res.error && has.tone && /tone/i.test(msg)) { has.tone = false; continue }
    if (res.error && has.covers && /cover/i.test(msg)) { has.covers = false; continue }
    return res
  }
  return supabase.from('books').select(booksQuery({ covers: false, tone: false })).eq('group_id', groupId)
}

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
  const [gameScores, setGameScores] = useState(null)   // "Stack the shelf" bests; null = leaderboard not set up (update-8.sql)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState('home')          // 'home' (bookcase) | 'all' (list)
  const [expandedOwner, setExpandedOwner] = useState(null) // whose complete shelf is open on the bookcase
  const [addOpen, setAddOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [person, setPerson] = useState(null)       // whose shelf we're looking at in the list
  const [personTab, setPersonTab] = useState('owns')
  const [toast, setToast] = useState('')
  const toastTimer = useRef()
  const [modalCopyId, setModalCopyId] = useState(null)   // book open from the All books list
  const [modalWhy, setModalWhy] = useState(null)        // 'added' when it popped up after adding a book
  const tileRefs = useRef({})
  const returnFocus = useRef(null)
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
      loadBooks(group.id),
      loadMembers(group.id),
    ])
    // The leaderboard loads on its own, so the library still works before update-8.sql is run.
    supabase.from('game_scores').select('user_id, best, best_at, games').eq('group_id', group.id)
      .then(({ data, error }) => setGameScores(error ? null : data || []))
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
        c.book = { id: book.id, title: book.title, author: book.author, cover_id: book.cover_id ?? null }
      }
    }
    setBooks(b.data.sort((x, y) => compareTitles(x.title, y.title)))
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_scores', filter: `group_id=eq.${group.id}` }, refresh)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(channel) }
  }, [group.id, load])

  const nameOf = useMemo(() => {
    const map = Object.fromEntries(members.map((m) => [m.id, m.name]))
    // someone not in this library (a friend from another library, or someone who left)
    return (id) => (id === me ? 'You' : map[id] || 'A friend')
  }, [members, me])

  async function run(promise, okMsg) {
    const { error } = await promise
    if (error) { showToast(friendlyError(error)); return false }
    if (okMsg) showToast(okMsg)
    load()
    return true
  }

  // Look up a book's cover the first time anyone opens it, and save it for everyone.
  const coverTried = useRef(new Set())
  const findBookCover = useCallback(async (book) => {
    if (book.cover_looked !== false || coverTried.current.has(book.id)) return
    coverTried.current.add(book.id)
    let coverId
    try { coverId = await findCover(book.title, book.author) } catch { return }   // Open Library unreachable: try again next visit
    const { error } = await supabase.from('books').update({ cover_id: coverId, cover_looked: true }).eq('id', book.id).eq('cover_looked', false)
    if (error) return
    setBooks((bs) => bs && bs.map((b) => (b.id === book.id ? { ...b, cover_id: coverId, cover_looked: true } : b)))
  }, [])

  // On the All books tab, fetch any covers we haven't looked up yet (three at a time), so the grid fills in.
  useEffect(() => {
    if (view !== 'all' || !books) return
    const queue = books.filter((b) => b.cover_looked === false && !coverTried.current.has(b.id))
    if (!queue.length) return
    let stopped = false
    const worker = async () => { while (queue.length && !stopped) await findBookCover(queue.shift()) }
    worker(); worker(); worker()
    return () => { stopped = true }
  }, [view, books, findBookCover])

  const actions = {
    findCover: findBookCover,
    // the owner picks their copy's spine color (null = automatic again); needs update-10.sql
    setTone: (copy, tone) => run(supabase.rpc('set_spine_tone', { cid: copy.id, new_tone: tone }), tone ? 'Spine color saved' : 'Spine color back to automatic'),
    addCopy: async (title, author, everywhere = false) => {
      let res = await supabase.rpc('add_copy', { gid: group.id, book_title: title, book_author: author, everywhere })
      if (res.error && /add_copy|function/i.test(res.error.message || '')) {
        // database not updated yet (update-6.sql): add it to this library only
        res = await supabase.rpc('add_copy', { gid: group.id, book_title: title, book_author: author })
        if (!res.error && everywhere) showToast(`Added “${title}” here. Showing books in all libraries needs update-6.sql.`)
      }
      if (res.error) { showToast(friendlyError(res.error)); return false }
      await load()
      // pop the new book up so you can mark it read / reading / want to read straight away
      if (res.data) openModal(res.data, 'added', document.getElementById('add-title'))
      return true
    },
    giveCopy: async (copy, friendId) => {
      const { error } = await supabase.rpc('give_copy', { cid: copy.id, new_owner: friendId })
      if (error) { showToast(/give_copy|function/i.test(error.message || '') && !/owner|library/i.test(error.message || '') ? 'This needs the latest database update (update-7.sql).' : friendlyError(error)); return false }
      setModalCopyId(null)
      showToast(`Moved to ${nameOf(friendId)}’s shelf`)
      load()
      return true
    },
    setEverywhere: (copy, on) =>
      run(supabase.rpc('set_everywhere', { cid: copy.id, on_: on }), on ? 'Now in all your libraries' : 'Now only in this library'),
    setAllEverywhere: async () => {
      const { data, error } = await supabase.rpc('set_all_everywhere', { gid: group.id, on_: true })
      if (error) { showToast(/set_all_everywhere|function/i.test(error.message || '') ? 'This needs the latest database update (update-6.sql).' : friendlyError(error)); return false }
      showToast(data ? `${data} ${data === 1 ? 'book is' : 'books are'} now in all your libraries` : 'All your books were already in all your libraries')
      load()
      return true
    },
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
    // Getting in line = wanting to read it (update-11.sql keeps the two together)
    joinLine: (copy) => run(supabase.rpc('join_line', { cid: copy.id }), "You're in line, and it's on your want-to-read"),
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
      // Want to read a friend's book = get in line for it (update-11.sql does the line)
      const book = (books || []).find((b) => b.id === bookId)
      const borrowable = book && !book.copies.some((c) => c.owner_id === me || c.lent_to_user === me) && book.copies.some((c) => c.lendable && c.owner_id !== me)
      return run(supabase.from('reading').upsert(row), status === 'want' && borrowable ? "On your want-to-read, and you're in line" : null)
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
    loved: (b) => b.reading.some((r) => r.rating === 'up' && r.user_id !== me),
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
  const board = useMemo(() => rankBoard(gameScores || [], members), [gameScores, members])

  // A round of Stack the shelf just ended: save it (the database keeps only your best).
  const recordScore = useCallback(async (score) => {
    if (gameScores === null) return   // leaderboard not set up yet
    setGameScores((s) => withRound(s, me, score))
    const { error } = await supabase.rpc('record_score', { gid: group.id, score })
    if (error) showToast('Couldn’t save that score. Try another round in a moment.')
  }, [gameScores, me, group.id, showToast])
  const tones = useMemo(() => bookcaseTones(books || []), [books])

  // ----- bookcase selection -----
  const findEntry = (id) => {
    if (!id) return null
    for (const b of all) for (const c of b.copies) if (c.id === id) return { copy: c, book: b }
    return null
  }

  // Which copy to open from a title in the list: theirs if you're looking at someone's
  // shelf, else yours, else one that's free to borrow, else the first.
  function pickCopy(book) {
    const cs = [...book.copies].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return (person && cs.find((c) => c.owner_id === person))
      || cs.find((c) => c.owner_id === me)
      || cs.find((c) => c.status === 'home' && c.lendable)
      || cs[0]
  }
  // focusAfter: where to put the keyboard focus when it closes (the title tile, or the add form)
  function openModal(copyId, why = null, focusAfter = null) {
    returnFocus.current = focusAfter || document.activeElement
    setModalWhy(why)
    setModalCopyId(copyId)
  }
  function openFromList(book) {
    openModal(pickCopy(book).id, null, tileRefs.current[book.id])
  }
  const closeModal = useCallback(() => {
    setModalCopyId(null)
    setModalWhy(null)
    const el = returnFocus.current
    if (el && el.isConnected) requestAnimationFrame(() => el.focus())
  }, [])
  const modalEntry = findEntry(modalCopyId)
  const openActivityCopy = useCallback((copyId, el) => { if (copyId) openModal(copyId, null, el) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // A spine on the bookcase opens its book in the same pop-up as All books
  // (closing it puts you back on that spine).
  function openCopy(id) {
    openModal(id, null, document.activeElement)
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
    ['activity', 'Activity', view === 'activity', () => go('activity')],
    ['play', 'Play', view === 'play', () => go('play')],
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
        showMembers={view !== 'activity' && view !== 'play'}
        onSwitchGroup={onSwitchGroup} onGroupsChange={onGroupsChange} showToast={showToast} />

      {view === 'home' ? (
        <main className="home stack-lg">
          <h1 className="sr-only">{group.name} bookcase</h1>
          <WantedFromShelf books={books} me={me} nameOf={nameOf} onOpen={openActivityCopy} />
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
            selectedCopyId={modalCopyId}
            expandedOwner={expandedOwner}
            onOpenCopy={openCopy}
            onExpand={setExpandedOwner}
            onCollapse={() => setExpandedOwner(null)}
            onViewList={(uid) => go('all', { person: uid })}
            onShareAll={actions.setAllEverywhere}
            libraryCount={groups.length}
            loading={books === null && !loadError}
            error={loadError}
            onRetry={load}
          />

          <div className="content-grid card-only">
            <LibraryCard name={profile.display_name} avatar={profile.avatar} libraryName={group.name} joinedAt={myMember?.joinedAt} score={scores[me]} cardNo={cardNumber(board, me)} />
          </div>
        </main>
      ) : view === 'activity' ? (
        <Activity books={books} me={me} nameOf={nameOf} onOpen={openActivityCopy} />
      ) : view === 'play' ? (
        <Play libraryName={group.name} groupId={group.id} me={me} books={books} board={gameScores === null ? null : board} onScore={recordScore} />
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
              <ul className="cover-grid">
                {visible.map((b) => {
                  const copyId = pickCopy(b).id
                  return (
                    <li key={b.id}>
                      <button
                        type="button" className="cover-tile" title={`${b.title}${b.author ? ` by ${b.author}` : ''}`}
                        aria-label={`${b.title}${b.author ? ` by ${b.author}` : ''}`}
                        ref={(el) => (tileRefs.current[b.id] = el)} onClick={() => openFromList(b)}
                      >
                        <BookCover small title={b.title} author={b.author} coverId={b.cover_id} tone={tones[copyId] || spineTone(copyId)} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </main>
      )}

      {modalEntry && (
        <BookModal
          entry={modalEntry}
          intro={modalWhy === 'added' ? 'Added to your shelf. Have you read it?' : null}
          copies={[...modalEntry.book.copies].sort((a, b) => (b.owner_id === me) - (a.owner_id === me) || a.created_at.localeCompare(b.created_at))}
          onPickCopy={setModalCopyId}
          onClose={closeModal}
          me={me}
          myName={profile.display_name}
          nameOf={nameOf}
          tones={tones}
          listingProps={{ members, actions, showToast }}
        />
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

// showMembers: the name chips open someone's shelf, so they only show on the tabs with shelves
// (Bookcase, My shelf, All books), not on Activity or Play.
function GroupBar({ group, groups, members, scores, me, profile, person, onOpenShelf, showMembers = true, onSwitchGroup, onGroupsChange, showToast }) {
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
        <button type="button" className="btn small ghost" onClick={() => setCreating((v) => !v)}>New library group</button>
      </div>
      {showMembers && <ul className="members" aria-label="Members">
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
      </ul>}
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

