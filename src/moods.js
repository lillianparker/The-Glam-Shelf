// Moods: what a friend would say when handing you the book. Once you've read it,
// you can tag a book with up to MAX_MOODS of these (saved in book_moods, update-12.sql).
// `id` is what the database stores, so don't change one once people have used it;
// `label` is what everyone sees and can be reworded any time.
// `tint` names one of the spine colors; the pill uses a light wash of it (styles.css, "moods").
export const MAX_MOODS = 3

export const MOODS = [
  { id: 'still-thinking', label: 'still thinking about it', tint: 'plum' },
  { id: 'cant-put-down', label: 'can’t put it down', tint: 'wine' },
  { id: 'beautiful-writing', label: 'beautiful writing', tint: 'gold' },
  { id: 'beach-read', label: 'beach read', tint: 'sun' },
  { id: 'classic', label: 'a classic worth it', tint: 'cocoa' },
  { id: 'ugly-cried', label: 'ugly-cried', tint: 'pink' },
  { id: 'made-me-laugh', label: 'made me laugh', tint: 'sage' },
  { id: 'need-to-talk', label: 'need to talk about it', tint: 'aubergine' },
  { id: 'slow-burn', label: 'slow burn', tint: 'forest' },
  { id: 'mind-bending', label: 'mind-bending', tint: 'navy' },
  { id: 'learned-something', label: 'learned something', tint: 'blue' },
]

const byId = Object.fromEntries(MOODS.map((m) => [m.id, m]))
export const findMood = (id) => byId[id] || null

// Your moods for a book.
export function myMoods(book, me) {
  return (book.book_moods || []).filter((m) => m.user_id === me && byId[m.mood]).map((m) => m.mood)
}
