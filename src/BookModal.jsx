// The book listing in a pop-up, opened from the "All books" titles.
// Same listing as on the bookcase; closing it returns you to where you were in the list.
import { useEffect, useRef } from 'react'
import BookListing from './BookListing.jsx'
import { possessive } from './shelf.js'

export default function BookModal({ entry, intro = null, copies, onPickCopy, onClose, me, myName, nameOf, tones, listingProps }) {
  const headingRef = useRef(null)
  const panelRef = useRef(null)

  // Focus the title when it opens; Escape closes; Tab stays inside; the page behind doesn't scroll.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow }
  }, [onClose])

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [entry.copy.id])

  const ownerLabel = (c) => (c.owner_id === me ? 'Your copy' : `${possessive(nameOf(c.owner_id))} copy`)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-listing-title" ref={panelRef}>
        <div className="modal-bar">
          {intro ? (
            <p className="modal-intro" role="status"><span aria-hidden="true">✓</span> {intro}</p>
          ) : copies.length > 1 ? (
            <div className="copy-switch" role="group" aria-label="Copies of this book">
              {copies.map((c) => (
                <button key={c.id} type="button" aria-pressed={c.id === entry.copy.id} onClick={() => onPickCopy(c.id)}>
                  {ownerLabel(c)}
                </button>
              ))}
            </div>
          ) : <span />}
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <BookListing key={entry.copy.id} ref={headingRef} idBase="modal-listing" entry={entry} tone={tones[entry.copy.id]} me={me} myName={myName} nameOf={nameOf} startEditing={Boolean(intro)} {...listingProps} />
      </div>
    </div>
  )
}
