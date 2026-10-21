// The Play tab. Stage 1: just the page. The book-stacking game arrives in later stages.
export default function Play({ libraryName }) {
  return (
    <main className="play-view stack-lg">
      <div className="play-head">
        <span className="eyebrow">{libraryName}</span>
        <h1 className="view-title">Play</h1>
      </div>
      <section className="play-soon" aria-label="Coming soon">
        <div className="play-stack" aria-hidden="true">
          <i className="tone-gold" /><i className="tone-plum" /><i className="tone-pink" /><i className="tone-forest" />
        </div>
        <div>
          <h2>Stack the shelf</h2>
          <p>A tower-stacking game made of the books in this library, with a leaderboard for everyone here. Coming soon.</p>
        </div>
      </section>
    </main>
  )
}
