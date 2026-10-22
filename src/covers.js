// Book covers from Open Library (openlibrary.org): free, no account needed.
// We look a book up once by title and author, save the cover number with the book,
// and from then on just show the picture.

const SEARCH = 'https://openlibrary.org/search.json'

// Ask Open Library for a cover. Returns the cover number, or null if it has none.
// Throws if Open Library can't be reached (so we can try again another time).
export async function findCover(title, author, fetchImpl = globalThis.fetch) {
  const search = async (withAuthor) => {
    const params = new URLSearchParams({ title, fields: 'cover_i', limit: '5' })
    if (withAuthor && author) params.set('author', author)
    const res = await fetchImpl(`${SEARCH}?${params}`)
    if (!res.ok) throw new Error(`Open Library: ${res.status}`)
    const data = await res.json()
    return data.docs || []
  }
  let docs = await search(true)
  // nothing for that title + author (maybe the author is spelled a little differently): try the title alone
  if (!docs.length && author) docs = await search(false)
  const hit = docs.find((d) => d.cover_i > 0)
  return hit ? hit.cover_i : null
}

// The picture itself. Size: 'S', 'M' or 'L'.
// default=false makes a missing picture fail properly instead of showing a blank square.
export function coverUrl(id, size = 'L') {
  return `https://covers.openlibrary.org/b/id/${id}-${size}.jpg?default=false`
}
