// "Stack the shelf": the game's rules, with no drawing and no React,
// so they're easy to test (src/__tests__/stack.test.js) and easy to tune.
//
// The play area is FIELD units wide (drawn as percentages, so it fits any screen).
// A book slides back and forth above the stack; dropping it keeps the part that
// lands on the book below and the overhang falls off. Miss completely and the game ends.

// ---------------------------------------------------------------------------
// Tuning: change these to make the game easier, harder, faster or slower.
// ---------------------------------------------------------------------------
export const TUNING = {
  FIELD: 1000,          // width of the play area, in units
  START_WIDTH: 560,     // width of the first books
  START_SPEED: 185,     // how fast the book slides at first (units per second); lower is slower
  SPEED_UP: 1.015,      // each book is this much faster than the last (1.015 = 1.5% faster)
  MAX_SPEED: 420,       // it never gets faster than this
  PERFECT_WITHIN: 10,   // a drop this close (in units) to the book below counts as perfect
  PERFECT_GROW: 40,     // a perfect drop grows the book back by this much
  CLEAR: 12,            // how far the sliding book goes past the stack on each side, so a total miss is possible
}

// Shuffle the library's titles into a random order to stack (each title once per round).
export function shuffleTitles(books, random = Math.random) {
  const titles = [...new Set(books.map((b) => b.title).filter(Boolean))]
  for (let i = titles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[titles[i], titles[j]] = [titles[j], titles[i]]
  }
  return titles
}

export function speedFor(score, t = TUNING) {
  return Math.min(t.MAX_SPEED, t.START_SPEED * Math.pow(t.SPEED_UP, score))
}

// Where the sliding book can go: from completely off the left of the book below
// to completely off its right, so every drop is a real decision.
export function travelRange(width, top, t = TUNING) {
  return { min: top.x - width - t.CLEAR, max: top.x + top.w + t.CLEAR }
}

// A new game: one book already on the base, the next one about to slide in.
export function newGame(titles, random = Math.random, t = TUNING) {
  const first = { x: (t.FIELD - t.START_WIDTH) / 2, w: t.START_WIDTH, title: titles[0] || 'The Glam Shelf', tone: 0 }
  return {
    status: 'ready',      // 'ready' → 'playing' (⇄ 'paused') → 'over'
    titles,
    next: 1,              // index of the next title to use
    tower: [first],       // bottom to top
    current: spawn(first.w, first, 1, titles, t),
    score: 0,
    perfectStreak: 0,
    lastDrop: null,       // { kind: 'perfect' | 'trim' | 'miss', piece } for the screen to animate
    toneSeed: Math.floor(random() * 1000),
  }
}

function spawn(width, top, n, titles, t = TUNING) {
  const range = travelRange(width, top, t)
  const fromLeft = n % 2 === 1
  return {
    x: fromLeft ? range.min : range.max,
    w: width,
    dir: fromLeft ? 1 : -1,
    title: titles.length ? titles[n % titles.length] : 'The Glam Shelf',
    tone: n,
  }
}

// Move the sliding book forward by dt seconds, bouncing at the ends.
export function step(game, dt, t = TUNING) {
  if (game.status !== 'playing') return game
  const c = game.current
  const range = travelRange(c.w, game.tower[game.tower.length - 1], t)
  let x = c.x + c.dir * speedFor(game.score, t) * dt
  let dir = c.dir
  if (x > range.max) { x = range.max - (x - range.max); dir = -1 }
  if (x < range.min) { x = range.min + (range.min - x); dir = 1 }
  return { ...game, current: { ...c, x, dir } }
}

// Pause and keep going. A paused book stays exactly where it was.
export function pause(game) {
  return game.status === 'playing' ? { ...game, status: 'paused' } : game
}
export function resume(game) {
  return game.status === 'paused' ? { ...game, status: 'playing' } : game
}

// Drop the sliding book onto the stack.
export function drop(game, t = TUNING) {
  if (game.status === 'ready') return { ...game, status: 'playing' }
  if (game.status !== 'playing') return game
  const c = game.current
  const top = game.tower[game.tower.length - 1]
  const left = Math.max(c.x, top.x)
  const right = Math.min(c.x + c.w, top.x + top.w)
  const overlap = right - left

  if (overlap <= 0) {
    // missed completely: the whole book falls and the game is over
    return { ...game, status: 'over', lastDrop: { kind: 'miss', piece: { x: c.x, w: c.w, title: c.title, tone: c.tone } } }
  }

  let placed, piece = null, kind
  if (Math.abs(c.x - top.x) <= t.PERFECT_WITHIN) {
    // perfect: snap onto the book below and grow back a little (never wider than the first books)
    const w = Math.min(t.START_WIDTH, top.w + t.PERFECT_GROW)
    const x = Math.max(0, Math.min(t.FIELD - w, top.x - (w - top.w) / 2))
    placed = { x, w, title: c.title, tone: c.tone }
    kind = 'perfect'
  } else {
    placed = { x: left, w: overlap, title: c.title, tone: c.tone }
    // the overhang that falls off
    piece = c.x < top.x
      ? { x: c.x, w: top.x - c.x, title: c.title, tone: c.tone }
      : { x: top.x + top.w, w: c.x + c.w - (top.x + top.w), title: c.title, tone: c.tone }
    kind = 'trim'
  }

  const score = game.score + 1
  const next = game.next + 1
  return {
    ...game,
    tower: [...game.tower, placed],
    current: spawn(placed.w, placed, next, game.titles, t),
    next,
    score,
    perfectStreak: kind === 'perfect' ? game.perfectStreak + 1 : 0,
    lastDrop: { kind, piece },
  }
}
