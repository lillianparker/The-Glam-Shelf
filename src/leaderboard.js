// "Stack the shelf" leaderboard: turns saved best scores into places.
// Higher best first; on a tie, whoever got there first ranks higher.
// Only current members of the library appear.

export function rankBoard(scores, members) {
  const byId = new Map((members || []).map((m) => [m.id, m]))
  const played = (scores || [])
    .filter((s) => byId.has(s.user_id))
    .sort((a, b) =>
      b.best - a.best ||
      String(a.best_at || '').localeCompare(String(b.best_at || '')) ||
      byId.get(a.user_id).name.localeCompare(byId.get(b.user_id).name))
    .map((s, i) => ({ ...byId.get(s.user_id), best: s.best, games: s.games || 0, place: i + 1 }))
  const onBoard = new Set(played.map((p) => p.id))
  const notYet = (members || []).filter((m) => !onBoard.has(m.id)).sort((a, b) => a.name.localeCompare(b.name))
  return { played, notYet }
}

// Your library card number is your place on the board, or 0 if you haven't played yet.
export function cardNumber(board, id) {
  return board.played.find((p) => p.id === id)?.place ?? 0
}

// Your saved scores after a round, before the database answers (so the board updates straight away).
export function withRound(scores, userId, score, now = new Date().toISOString()) {
  const list = scores || []
  const mine = list.find((s) => s.user_id === userId)
  if (!mine) return [...list, { user_id: userId, best: score, best_at: now, games: 1 }]
  const better = score > mine.best
  return list.map((s) => (s === mine
    ? { ...s, best: better ? score : s.best, best_at: better ? now : s.best_at, games: (s.games || 0) + 1 }
    : s))
}
