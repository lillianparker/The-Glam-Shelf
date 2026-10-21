// The logo: "Glam Bookshelf" with "Glam" in italic berry.
// as="h1" on the sign-in screens; as="p" in the app header (the page has its own h1).
export default function Wordmark({ as: Tag = 'h1' }) {
  return (
    <Tag className="wordmark" aria-label="Glam Bookshelf">
      <em>Glam</em> Bookshelf
    </Tag>
  )
}
