// The homepage bookcase: one shelf row per member, each copy a spine.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ShelfObject } from './AvatarPicker.jsx'
import { findAvatar } from './avatars.js'
import { availabilityText, bookcaseTones, chunkRows, fitCount, possessive, shelfCopies, spineHeight, spineTone } from './shelf.js'

// Fallback sizes (px) if the CSS custom properties can't be read.
const DEFAULT_SIZES = { spine: 52, gap: 6, more: 48 }

function readSizes(el) {
  if (!el || typeof getComputedStyle !== 'function') return DEFAULT_SIZES
  const cs = getComputedStyle(el)
  const px = (name, fallback) => {
    const v = parseFloat(cs.getPropertyValue(name))
    return Number.isFinite(v) && v > 0 ? v : fallback
  }
  return {
    spine: px('--spine-w', DEFAULT_SIZES.spine),
    gap: px('--spine-gap', DEFAULT_SIZES.gap),
    more: px('--more-w', DEFAULT_SIZES.more),
  }
}

// Width of an element, kept up to date as the window resizes.
function useWidth() {
  const ref = useRef(null)
  const [state, setState] = useState({ width: 0, sizes: DEFAULT_SIZES })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setState({ width: el.clientWidth, sizes: readSizes(el) })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, state.width, state.sizes]
}

export default function Bookcase({ books, members, me, myName, myAvatar, onChooseAvatar, nameOf, selectedCopyId, expandedOwner, onOpenCopy, onExpand, onCollapse, onViewList, onShareAll, libraryCount = 1, loading, error, onRetry }) {
  const tones = useMemo(() => bookcaseTones(books || []), [books])
  if (error && !books) {
    return (
      <section className="bookcase" aria-label="Bookcase">
        <div className="bookcase-msg">
          <strong>Couldn't open the shelves</strong>
          <span>{error}</span>
          <button type="button" className="btn small" onClick={onRetry}>Try again</button>
        </div>
      </section>
    )
  }
  if (loading) {
    return (
      <section className="bookcase" aria-label="Bookcase" aria-busy="true">
        <div className="bookcase-msg"><strong>Opening the shelves…</strong></div>
      </section>
    )
  }

  // Your shelf first, then everyone else alphabetically.
  const owners = [...members].sort((a, b) => (b.id === me) - (a.id === me) || a.name.localeCompare(b.name))
  const total = books.reduce((n, b) => n + b.copies.length, 0)
  const label = (id) => (id === me ? myName : nameOf(id))
  // Your own avatar comes from your profile (updates the moment you pick one).
  const avatarOf = (id) => (id === me ? myAvatar : members.find((m) => m.id === id)?.avatar) || null
  // null when there's nothing to show, so that shelf keeps its full width for books
  const decoFor = (id) => (findAvatar(avatarOf(id)) || (id === me && onChooseAvatar)
    ? <ShelfDeco avatar={avatarOf(id)} isMe={id === me} onChoose={onChooseAvatar} />
    : null)

  if (expandedOwner) {
    const items = shelfCopies(books, expandedOwner)
    return (
      <section className="bookcase" aria-labelledby="expanded-shelf-title">
        <div className="bookcase-head">
          <div>
            <span className="eyebrow">The complete shelf</span>
            <h2 id="expanded-shelf-title">On {possessive(label(expandedOwner))} shelf</h2>
          </div>
          <div className="bookcase-head-actions">
            <span className="book-count">{items.length} {items.length === 1 ? 'book' : 'books'}</span>
            <button type="button" className="linkish small" onClick={() => onViewList(expandedOwner)}>View as a list</button>
            {expandedOwner === me && onShareAll && items.some(({ copy }) => !copy.everywhere) && (
              <button type="button" className="btn small" onClick={onShareAll}
                title={libraryCount > 1 ? 'Show every book on this shelf in all your libraries' : 'Your books will follow you into libraries you join later'}>
                Put all my books in every library
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={onCollapse}>Back to the bookcase</button>
          </div>
        </div>
        <FullShelf items={items} me={me} nameOf={nameOf} selectedCopyId={selectedCopyId} onOpenCopy={onOpenCopy} ownerName={label(expandedOwner)} tones={tones}
          deco={decoFor(expandedOwner)} />
      </section>
    )
  }

  return (
    <section className="bookcase" aria-labelledby="bookcase-title">
      <div className="bookcase-head">
        <div>
          <span className="eyebrow">The community bookcase</span>
          <h2 id="bookcase-title">Friends’ shelves</h2>
        </div>
        <div className="bookcase-head-actions">
          <span className="legend"><i className="legend-ribbon" aria-hidden="true" />Out on loan or being read</span>
          <span className="book-count">{total} {total === 1 ? 'book' : 'books'} in this library</span>
        </div>
      </div>
      {owners.map((m) => (
        <ShelfRow
          key={m.id}
          ownerId={m.id}
          ownerName={label(m.id)}
          items={shelfCopies(books, m.id)}
          me={me}
          nameOf={nameOf}
          selectedCopyId={selectedCopyId}
          onOpenCopy={onOpenCopy}
          onExpand={() => onExpand(m.id)}
          tones={tones}
          deco={decoFor(m.id)}
        />
      ))}
    </section>
  )
}

export function ShelfRow({ ownerId, ownerName, items, me, nameOf, selectedCopyId, onOpenCopy, onExpand, deco = null, tones }) {
  const [ref, width, sizes] = useWidth()
  const shown = fitCount(width, items.length, sizes)
  const hidden = items.length - shown
  const headingId = `shelf-${ownerId}`

  return (
    <div className="person-shelf" role="group" aria-labelledby={headingId}>
      <div className="shelf-label">
        <h3 id={headingId}>On <strong>{possessive(ownerName)}</strong> shelf</h3>
        <small>{items.length} {items.length === 1 ? 'book' : 'books'}</small>
      </div>
      <div className={`shelf-scene${items.length === 0 ? ' is-empty' : ''}`}>
        <div className="spines" ref={ref}>
          {items.length === 0 ? (
            <p className="shelf-empty">{ownerId === me ? 'Nothing here yet. Add a book you own to fill your shelf.' : 'No books on this shelf yet.'}</p>
          ) : (
            <ul className="spine-list">
              {items.slice(0, shown).map(({ copy, book }) => (
                <li key={copy.id}>
                  <Spine copy={copy} book={book} me={me} nameOf={nameOf} ownerName={ownerName} selected={copy.id === selectedCopyId} onOpen={onOpenCopy} tone={tones?.[copy.id]} />
                </li>
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <button type="button" className="more-books" onClick={onExpand}
              aria-label={`See all ${items.length} books on ${possessive(ownerName)} shelf (${hidden} more)`}>
              <span aria-hidden="true">•••</span>
            </button>
          )}
        </div>
        {deco}
        <div className="shelf-board" aria-hidden="true" />
      </div>
    </div>
  )
}

// The avatar standing at the end of a shelf. Takes its width out of the shelf
// before the spines are counted, so the ••• logic stays right.
export function ShelfDeco({ avatar, isMe, onChoose }) {
  if (findAvatar(avatar)) {
    return <div className="shelf-deco"><ShelfObject id={avatar} /></div>
  }
  if (isMe && onChoose) {
    return (
      <div className="shelf-deco">
        <button type="button" className="deco-pick" onClick={onChoose}>
          <span aria-hidden="true">+</span>Pick a shelf object
        </button>
      </div>
    )
  }
  return null
}

function FullShelf({ items, me, nameOf, selectedCopyId, onOpenCopy, ownerName, deco = null, tones }) {
  const [ref, width, sizes] = useWidth()
  const rows = chunkRows(items, width, sizes)
  return (
    <div className="person-shelf full">
      {/* zero-height row with the same padding as a shelf, used only to measure the usable width */}
      <div className="shelf-scene measure" aria-hidden="true"><div className="spines" ref={ref} />{deco && <div className="shelf-deco" />}</div>
      {items.length === 0 && (
        <div className="shelf-scene is-empty"><div className="spines"><p className="shelf-empty">No books on this shelf yet.</p></div>{deco}<div className="shelf-board" aria-hidden="true" /></div>
      )}
      {rows.map((row, i) => (
        <div className="shelf-scene" key={i}>
          <div className="spines">
            <ul className="spine-list">
              {row.map(({ copy, book }) => (
                <li key={copy.id}>
                  <Spine copy={copy} book={book} me={me} nameOf={nameOf} ownerName={ownerName} selected={copy.id === selectedCopyId} onOpen={onOpenCopy} tone={tones?.[copy.id]} />
                </li>
              ))}
            </ul>
          </div>
          {i === 0 ? deco : deco && <div className="shelf-deco" />}
          <div className="shelf-board" aria-hidden="true" />
        </div>
      ))}
    </div>
  )
}

export function Spine({ copy, book, me, nameOf, ownerName, selected, onOpen, tone }) {
  const where = availabilityText(copy, me, nameOf)
  const out = copy.status === 'lent'
  // Whoever has this copy right now (the borrower, or the owner when it's at home)
  // has marked the book as Reading.
  const holder = out ? copy.lent_to_user : copy.owner_id
  const beingRead = Boolean(holder) && (book.reading || []).some((r) => r.user_id === holder && r.status === 'reading')
  const ribbon = out || beingRead
  const label = `${book.title}${book.author ? ` by ${book.author}` : ''}. ${possessive(ownerName)} copy. ${where}.${beingRead ? ` Being read by ${holder === me ? 'you' : nameOf(holder)}.` : ''}`
  return (
    <button
      type="button"
      className={`spine tone-${tone || spineTone(copy.id)}${selected ? ' selected' : ''}${ribbon ? ' out' : ''}${book.author ? '' : ' no-author'}`}
      style={{ '--h': spineHeight(copy.id) }}
      aria-label={label}
      aria-pressed={selected}
      title={`${book.title}${book.author ? ` — ${book.author}` : ''}`}
      onClick={() => onOpen(copy.id)}
    >
      <span className="spine-title"><span>{book.title}</span></span>
      {book.author && <small className="spine-author"><span>{book.author.split(' ').slice(-1)[0]}</span></small>}
      {ribbon && <i className="spine-ribbon" aria-hidden="true" />}
    </button>
  )
}
