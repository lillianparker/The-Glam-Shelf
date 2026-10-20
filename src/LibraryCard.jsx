// The signed-in member's library card: real name, library, join date and points.
import { fmtDate } from './parts.jsx'

export default function LibraryCard({ name, libraryName, joinedAt, score }) {
  const s = score || { owned: 0, lent: 0, read: 0, total: 0 }
  return (
    <aside className="library-card" aria-label="Your library card">
      <div className="card-top">
        <span className="card-mark" aria-hidden="true">Glam</span>
        <p>Library card<br /><strong>{libraryName}</strong></p>
      </div>
      <div className="card-body">
        <span className="eyebrow">Member</span>
        <h2>{name}</h2>
        <div className="points">
          <strong>{s.total}</strong>
          <span>community<br />points</span>
        </div>
        <ul className="point-breakdown">
          <li><b>{s.owned}</b> {s.owned === 1 ? 'book' : 'books'} owned <span>× 1</span></li>
          <li><b>{s.lent}</b> {s.lent === 1 ? 'lend' : 'lends'} <span>× 2</span></li>
          <li><b>{s.read}</b> read <span>× 5</span></li>
        </ul>
      </div>
      <div className="card-footer">
        <span>{joinedAt ? `MEMBER SINCE ${fmtDate(joinedAt, { year: true }).toUpperCase()}` : 'MEMBER'}</span>
        <div className="barcode" aria-hidden="true">|||| || | |||| | |||</div>
      </div>
    </aside>
  )
}
