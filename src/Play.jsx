// The Play tab: "Stack the shelf".
// Stage 2: the game itself (nothing is saved yet). Rules live in stack.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SPINE_TONES } from './shelf.js'
import { TUNING, drop, newGame, shuffleTitles, step } from './stack.js'

const BOOK_H = 34      // height of each book in the tower, in pixels
const HEADROOM = 96    // space above the tower for the sliding book, in pixels
const BASE_H = 18      // the shelf the tower stands on

const pct = (units) => `${(units / TUNING.FIELD) * 100}%`

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export default function Play({ libraryName, books }) {
  const titles = useMemo(() => [...new Set((books || []).map((b) => b.title))], [books])
  return (
    <main className="play-view stack-lg">
      <div className="play-head">
        <span className="eyebrow">{libraryName}</span>
        <h1 className="view-title">Play</h1>
        <p className="play-sub">Stack the shelf: drop each book onto the one below. Whatever hangs over the edge falls off.</p>
      </div>
      {books === null ? (
        <div className="stack-empty">Opening the shelves…</div>
      ) : titles.length === 0 ? (
        <div className="stack-empty">Add a few books to this library and they’ll become the tower.</div>
      ) : (
        <StackGame books={books} />
      )}
    </main>
  )
}

export function StackGame({ books }) {
  const [game, setGame] = useState(() => newGame(shuffleTitles(books)))
  const [falling, setFalling] = useState([])   // overhang pieces tumbling away
  const [flash, setFlash] = useState(null)     // "Perfect!" moments
  const areaRef = useRef(null)
  const [areaH, setAreaH] = useState(480)
  const gameRef = useRef(game)
  gameRef.current = game

  // Ready for Space as soon as the tab opens (otherwise Space would just "press" the Play tab again).
  useEffect(() => { areaRef.current?.focus({ preventScroll: true }) }, [])

  // --- input: Space, or a tap/click on the play area ---
  const act = useCallback(() => {
    const g = gameRef.current
    if (g.status === 'over') {
      setFalling([])
      setGame({ ...newGame(shuffleTitles(books)), status: 'playing' })
      return
    }
    const next = drop(g)
    setGame(next)
    if (next.lastDrop && next.lastDrop !== g.lastDrop) {
      const { kind, piece } = next.lastDrop
      if (piece) {
        const id = Math.random().toString(36).slice(2)
        const row = kind === 'miss' ? g.tower.length : g.tower.length
        setFalling((f) => [...f, { id, row, ...piece, side: piece.x < (g.tower[g.tower.length - 1].x) ? -1 : 1 }])
        setTimeout(() => setFalling((f) => f.filter((p) => p.id !== id)), 900)
      }
      if (kind === 'perfect') {
        const id = Date.now()
        setFlash({ id, streak: next.perfectStreak })
        setTimeout(() => setFlash((f) => (f && f.id === id ? null : f)), 900)
      }
    }
  }, [books])

  useEffect(() => {
    function onKey(e) {
      if (e.code !== 'Space' && e.key !== ' ') return
      const tag = e.target?.tagName
      if (e.target !== areaRef.current && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag)) return
      if (e.target?.isContentEditable) return
      e.preventDefault()
      if (!e.repeat) act()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act])

  // --- the slide: move the book every frame while playing (pauses when the tab is hidden) ---
  useEffect(() => {
    if (game.status !== 'playing') return
    let raf, last = performance.now()
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)   // a long gap (tab hidden) doesn't jump ahead
      last = now
      setGame((g) => step(g, dt))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [game.status])

  // --- size: how many books fit on screen before the view scrolls up ---
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setAreaH(el.clientHeight || 480)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visibleRows = Math.max(4, Math.floor((areaH - HEADROOM - BASE_H) / BOOK_H))
  const scroll = Math.max(0, game.tower.length - visibleRows) * BOOK_H
  const firstRow = Math.max(0, game.tower.length - visibleRows - 2)
  const tone = (n) => SPINE_TONES[(n + game.toneSeed) % SPINE_TONES.length]
  const rowBottom = (i) => BASE_H + i * BOOK_H

  const placed = game.score
  return (
    <section className="stack-wrap" aria-label="Stack the shelf">
      <div className="stack-hud">
        <span className="stack-score"><b>{placed}</b> {placed === 1 ? 'book' : 'books'} stacked</span>
        <span className="stack-hint">Space or tap to drop</span>
      </div>
      <div
        ref={areaRef}
        className={`stack-area status-${game.status}`}
        tabIndex={0}
        role="button"
        aria-label={game.status === 'ready' ? 'Start the game' : game.status === 'over' ? 'Play again' : 'Drop the book'}
        aria-describedby="stack-help"
        onPointerDown={(e) => { if (e.button === 0 || e.pointerType !== 'mouse') { e.preventDefault(); areaRef.current?.focus({ preventScroll: true }); act() } }}
      >
        <p id="stack-help" className="sr-only">Press Space, or tap, to drop the sliding book onto the stack.</p>
        <div className="stack-world" style={{ transform: `translateY(${scroll}px)`, transition: reducedMotion() ? 'none' : undefined }}>
          <div className="stack-base" style={{ height: BASE_H }} aria-hidden="true" />
          {game.tower.map((b, i) => i >= firstRow && (
            <Block key={i} b={b} tone={tone(b.tone)} bottom={rowBottom(i)} />
          ))}
          {game.status !== 'over' && (
            <Block b={game.current} tone={tone(game.current.tone)} bottom={rowBottom(game.tower.length)} moving />
          )}
          {falling.map((p) => (
            <Block key={p.id} b={p} tone={tone(p.tone)} bottom={rowBottom(p.row)} falling={p.side} />
          ))}
        </div>

        {flash && (
          <div key={flash.id} className="stack-flash" aria-hidden="true">
            Perfect!{flash.streak > 1 ? ` ×${flash.streak}` : ''}
          </div>
        )}

        {game.status === 'ready' && (
          <div className="stack-overlay">
            <div className="stack-card">
              <p className="stack-overlay-title">Stack the shelf</p>
              <p>Press <kbd>Space</kbd> or tap to start</p>
            </div>
          </div>
        )}
        {game.status === 'over' && (
          <div className="stack-overlay">
            <div className="stack-card">
              <p className="stack-overlay-title">{placed} {placed === 1 ? 'book' : 'books'} high</p>
              <p>Press <kbd>Space</kbd> or tap to play again</p>
            </div>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {game.status === 'over' ? `Game over. ${placed} books stacked.` : placed ? `${placed} stacked` : ''}
      </p>
    </section>
  )
}

function Block({ b, tone, bottom, moving = false, falling = 0 }) {
  const narrow = b.w < 70
  return (
    <div
      className={`stack-book tone-${tone}${moving ? ' moving' : ''}${falling ? (falling < 0 ? ' falling left' : ' falling right') : ''}`}
      style={{ left: pct(b.x), width: pct(b.w), bottom, height: BOOK_H }}
      aria-hidden="true"
    >
      {!narrow && <span>{b.title}</span>}
    </div>
  )
}
