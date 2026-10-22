// The signed-in member's library card: the library's name, when they joined, their avatar
// and name, what they've owned, lent and read, their card number and their points.
// The card number is your place on the Stack the shelf leaderboard (0 until you've played).
import { fmtDate } from './parts.jsx'
import { AvatarBadge } from './AvatarPicker.jsx'

// A made-up barcode: the same pattern every time, drawn as thin and thick bars.
const BARS = [1, 2, 2, 1, 1, 2, 3, 1, 1, 2, 1, 2, 2, 1, 1, 2, 3, 1, 1, 2, 2, 1, 1, 2, 1, 2, 2, 1, 1, 2, 3, 1, 1, 2, 1, 2, 2, 1, 1, 2, 2]

export default function LibraryCard({ name, avatar, libraryName, joinedAt, score, cardNo = 0 }) {
  const s = score || { owned: 0, lent: 0, read: 0, total: 0 }
  // even entries are bars, odd entries are the gaps between them
  let x = 0
  const bars = []
  BARS.forEach((w, i) => { if (i % 2 === 0) bars.push(<rect key={i} x={x} y="0" width={w} height="26" />); x += w })
  return (
    <aside className="library-card" aria-label="Your library card">
      <div className="lc-head">
        <p className="lc-library">{libraryName}</p>
        <p className="lc-since">{joinedAt ? `MEMBER SINCE ${fmtDate(joinedAt, { year: true }).toUpperCase()}` : 'MEMBER'}</p>
      </div>
      <div className="lc-member">
        <AvatarBadge id={avatar} name={name} size="lg" />
        <div className="lc-who">
          <h2>{name}</h2>
          <p className="lc-stats">
            <b>{s.owned}</b> owned, <b>{s.lent}</b> {s.lent === 1 ? 'lend' : 'lends'}, <b>{s.read}</b> read
          </p>
        </div>
      </div>
      <div className="lc-foot">
        <span className="lc-no">No. {cardNo}</span>
        <span className="lc-points"><b>{s.total}</b> {s.total === 1 ? 'pt' : 'pts'}</span>
        <svg className="lc-barcode" viewBox={`0 0 ${x} 26`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden="true">{bars}</svg>
      </div>
    </aside>
  )
}
