import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null

// Turn a Supabase error into something a person can act on.
export function friendlyError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (/rate limit/i.test(msg)) return 'Too many login emails were sent just now. Wait a few minutes and try again.'
  if (/fetch/i.test(msg)) return "Couldn't reach the server. Check your connection and try again."
  return msg
}
