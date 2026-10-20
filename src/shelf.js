// Pure helpers for the bookcase, listing and points. No React, no network,
// so they're easy to test (see src/__tests__/shelf.test.js).

// Points: +1 per copy you own, +2 per friend you've lent each copy to,
// +5 per book you've read.
export const POINTS = { owned: 1, lent: 2, read: 5 }

export function scoreMembers(books, members) {
  const out = Object.fromEntries(members.map((m) => [m.id, { owned: 0, lent: 0, read: 0, total: 0 }]))
  for (const b of books) {
    for (const c of b.copies) {
      const s = out[c.owner_id]
      if (!s) continue
      s.owned += 1
      // count each different borrower once per copy, so lending back and forth doesn't pile up points
      const borrowers = new Set(
        (c.loans || [])
          .map((l) => l.borrower_id || (l.borrower_name ? 'name:' + l.borrower_name.trim().toLowerCase() : null))
          .filter((k) => k && k !== c.owner_id)
      )
      s.lent += borrowers.size
    }
    for (const r of b.reading) {
      if (r.status === 'read' && out[r.user_id]) out[r.user_id].read += 1
    }
  }
  for (const s of Object.values(out)) s.total = s.owned * POINTS.owned + s.lent * POINTS.lent + s.read * POINTS.read
  return out
}

// ---------- spines ----------

export const SPINE_TONES = ['pink', 'cream', 'wine', 'gold', 'sage', 'blue', 'plum']

// Small stable hash so a copy keeps the same colour and height on every visit.
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function spineTone(copyId) {
  return SPINE_TONES[hash(String(copyId)) % SPINE_TONES.length]
}

// Height as a fraction of the tallest spine: 0.78 to 1.0.
export function spineHeight(copyId) {
  return 0.78 + (hash('h' + copyId) % 23) / 100
}

// How many spines fit on one shelf row.
// If everything fits, show everything. Otherwise leave room for the ••• button.
// width <= 0 means "not measured yet": show everything rather than guess.
export function fitCount(width, total, { spine, gap, more }) {
  if (total <= 0) return 0
  if (!(width > 0)) return total
  const perRow = Math.max(0, Math.floor((width + gap) / (spine + gap)))
  if (total <= perRow) return total
  // n spines + their gaps + the ••• button must fit: n*(spine+gap) + more <= width
  const withMore = Math.floor((width - more) / (spine + gap))
  return Math.max(1, Math.min(total - 1, withMore))
}

// Split spines into rows for the "complete shelf" view (no ••• needed).
export function chunkRows(items, width, { spine, gap }) {
  const perRow = width > 0 ? Math.max(1, Math.floor((width + gap) / (spine + gap))) : items.length || 1
  const rows = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return rows
}

// Spines on a shelf: alphabetical by title, like a tidy bookcase.
export function shelfCopies(books, ownerId) {
  const out = []
  for (const b of books) for (const c of b.copies) if (c.owner_id === ownerId) out.push({ copy: c, book: b })
  return out.sort((x, y) => x.book.title.localeCompare(y.book.title) || x.copy.created_at.localeCompare(y.copy.created_at))
}

// ---------- library log ----------

// A hand-off (A passes straight to B) closes one loan and opens the next at
// almost the same moment. Within this window we call it "passed it to B".
const HANDOFF_WINDOW_MS = 2 * 60 * 1000

// Chronological events for one physical copy, oldest first.
// Reads copy.created_at and copy.loans; never modifies them.
export function libraryLog(copy, nameOf) {
  const who = (l) => (l.borrower_id ? nameOf(l.borrower_id) : l.borrower_name || 'A friend')
  const loans = [...(copy.loans || [])].sort((a, b) => a.lent_at.localeCompare(b.lent_at))
  const events = [{ kind: 'added', at: copy.created_at, text: `Added to ${possessive(nameOf(copy.owner_id))} shelf` }]
  loans.forEach((l, i) => {
    events.push({ kind: 'borrowed', at: l.lent_at, who: who(l), text: `${who(l)} borrowed it` })
    if (l.returned_at) {
      const ret = Date.parse(l.returned_at)
      const next = loans.slice(i + 1).find((n) => Math.abs(Date.parse(n.lent_at) - ret) <= HANDOFF_WINDOW_MS)
      events.push({
        kind: next ? 'passed' : 'returned',
        at: l.returned_at,
        who: who(l),
        text: next ? `${who(l)} passed it to ${who(next)}` : `${who(l)} returned it`,
      })
    }
  })
  // Oldest first; at the same moment, a return comes before the next borrow.
  const rank = { added: 0, returned: 1, passed: 1, borrowed: 2 }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || rank[a.kind] - rank[b.kind])
}

export function possessive(name) {
  if (name === 'You') return 'your'
  return name.endsWith('s') ? `${name}’` : `${name}’s`
}

// Where a copy is, in words. Only says "At my home" for your own copy.
export function availabilityText(copy, me, nameOf) {
  if (copy.status === 'lent') {
    const holder = copy.lent_to_user ? nameOf(copy.lent_to_user) : copy.lent_to_name || 'a friend'
    return holder === 'You' ? 'With you' : `With ${holder}`
  }
  return copy.owner_id === me ? 'At my home' : `At ${possessive(nameOf(copy.owner_id))} home`
}
