// Profile avatars: the little object that sits at the end of your shelf.
// The pictures live in public/avatars/. To add one: drop a transparent .webp
// in that folder and add a line here (id = file name without ".webp").
export const AVATARS = [
  { id: 'aloe', label: 'Aloe' },
  { id: 'cactus', label: 'Cactus' },
  { id: 'fern', label: 'Fern' },
  { id: 'wildflowers', label: 'Wildflowers' },
  { id: 'tulips', label: 'Tulip pitcher' },
  { id: 'pink-blooms', label: 'Pink blooms' },
  { id: 'terrarium', label: 'Terrarium' },
  { id: 'amber-potion', label: 'Amber potion' },
  { id: 'green-potion', label: 'Green potion' },
  { id: 'pink-perfume', label: 'Pink perfume' },
  { id: 'blue-perfume', label: 'Blue perfume' },
  { id: 'mug', label: 'Tulip mug' },
  { id: 'globe', label: 'Globe' },
  { id: 'clock', label: 'Alarm clock' },
  { id: 'lavender-vase', label: 'Lavender vase' },
  { id: 'lavender-bottle', label: 'Lavender bottle' },
  { id: 'lilies', label: 'Lilies' },
  { id: 'jar-candle', label: 'Jar candle' },
  { id: 'candles', label: 'Dripping candles' },
  { id: 'green-mug', label: 'Green mug' },
  { id: 'rock', label: 'Rock' },
  { id: 'liberty', label: 'Statue of Liberty' },
  // Personal ones: only the listed accounts can pick them (everyone still sees them on that person's shelf).
  // `onlyFor` holds a fingerprint of the account's email (emailKey below), not the email itself,
  // so no address is readable in the website's files. To add someone: node -e "…emailKey('their@email')…"
  { id: 'droo', label: 'DROO', onlyFor: [1346527824] },
]

const byId = Object.fromEntries(AVATARS.map((a) => [a.id, a]))

// A short fingerprint of an email address (FNV-1a), lower-cased and trimmed first.
export function emailKey(email) {
  const s = String(email || '').trim().toLowerCase()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// The avatars this account can choose from: everyone's, plus any personal ones that are theirs.
export function avatarsFor(email) {
  const key = emailKey(email)
  return AVATARS.filter((a) => !a.onlyFor || (email && a.onlyFor.includes(key)))
}

// The avatar for an id, or null if there isn't one (not picked yet, or no longer offered).
export function findAvatar(id) {
  return (id && byId[id]) || null
}

export function avatarSrc(id) {
  return `${import.meta.env.BASE_URL}avatars/${id}.webp`
}
