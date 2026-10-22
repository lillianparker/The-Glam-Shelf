// Choose the object that sits on your shelf. Saved as profiles.avatar.
import { useRef } from 'react'
import { avatarSrc, avatarsFor, findAvatar } from './avatars.js'

// A small round badge with someone's avatar (or their initial if they haven't picked one).
export function AvatarBadge({ id, name, size = 'sm' }) {
  const a = findAvatar(id)
  return (
    <span className={`avatar-badge ${size}${a ? '' : ' none'}`} aria-hidden="true">
      {a ? <img src={avatarSrc(a.id)} alt="" loading="lazy" /> : (name || '?').trim().charAt(0).toUpperCase()}
    </span>
  )
}

// The object itself, standing on a shelf.
export function ShelfObject({ id }) {
  const a = findAvatar(id)
  if (!a) return null
  return <img className="shelf-object" src={avatarSrc(a.id)} alt="" aria-hidden="true" loading="lazy" />
}

// A grid of choices that works like radio buttons (arrow keys move between them).
// email: the signed-in account's, so personal avatars only show for their owner.
export default function AvatarPicker({ value, onChange, busy = false, label = 'Choose your shelf object', email = '' }) {
  const refs = useRef([])
  const options = avatarsFor(email)
  const current = Math.max(0, options.findIndex((a) => a.id === value))

  function onKey(e, i) {
    const cols = 4
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }
    if (!(e.key in moves)) return
    e.preventDefault()
    const j = (i + moves[e.key] + options.length) % options.length
    refs.current[j]?.focus()
    onChange(options[j].id)
  }

  return (
    <div className="avatar-picker" role="radiogroup" aria-label={label} aria-busy={busy}>
      {options.map((a, i) => {
        const selected = a.id === value
        return (
          <button
            key={a.id}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={a.label}
            title={a.label}
            tabIndex={i === current ? 0 : -1}
            className={selected ? 'selected' : ''}
            disabled={busy}
            onClick={() => onChange(a.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <img src={avatarSrc(a.id)} alt="" loading="lazy" />
          </button>
        )
      })}
    </div>
  )
}
