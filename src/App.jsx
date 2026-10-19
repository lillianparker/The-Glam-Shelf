import { useCallback, useEffect, useState } from 'react'
import { supabase, configured, friendlyError } from './supabase.js'
import { TAGLINE } from './config.js'
import Library from './Library.jsx'
import Wordmark from './Wordmark.jsx'

const JOIN_KEY = 'glam_pending_join'
const GROUP_KEY = 'glam_current_group'

function store(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* private mode */ }
}
function recall(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

// Pick up ?join=CODE from an invite link and remember it through the login email.
function capturePendingJoin() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('join')
  if (code) {
    store(JOIN_KEY, code)
    params.delete('join')
    const qs = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
  }
  return recall(JOIN_KEY)
}

export default function App() {
  if (!configured) return <SetupNeeded />
  return <Main />
}

function Main() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [groups, setGroups] = useState(undefined)
  const [groupId, setGroupId] = useState(recall(GROUP_KEY))
  const [pendingJoin] = useState(capturePendingJoin)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  // Load profile once signed in.
  useEffect(() => {
    if (!userId) { setProfile(undefined); setGroups(undefined); return }
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      .then(({ data }) => setProfile(data || null))
  }, [userId])

  const loadGroups = useCallback(async () => {
    const { data, error } = await supabase.from('groups').select('*').order('created_at')
    if (error) { setNotice(friendlyError(error)); setGroups([]); return [] }
    setGroups(data)
    return data
  }, [])

  // Once the profile exists: accept a pending invite, then load groups.
  useEffect(() => {
    if (!profile) return
    (async () => {
      const code = recall(JOIN_KEY)
      if (code) {
        const { data, error } = await supabase.rpc('join_group', { code })
        store(JOIN_KEY, null)
        if (error) setNotice(friendlyError(error))
        else if (data) { setGroupId(data.id); store(GROUP_KEY, data.id); setNotice(`Welcome to ${data.name}!`) }
      }
      await loadGroups()
    })()
  }, [profile, loadGroups])

  if (session === undefined) return <Splash />
  if (!session) return <Login inviting={Boolean(pendingJoin)} />
  if (profile === undefined) return <Splash />
  if (profile === null) return <NameSetup userId={userId} email={session.user.email} onDone={setProfile} />
  if (groups === undefined) return <Splash />
  if (groups.length === 0) {
    return (
      <NoGroup
        notice={notice}
        onReady={async (g) => { store(GROUP_KEY, g.id); setGroupId(g.id); await loadGroups() }}
      />
    )
  }

  const group = groups.find((g) => g.id === groupId) || groups[0]
  return (
    <Library
      key={group.id}
      group={group}
      groups={groups}
      profile={profile}
      notice={notice}
      clearNotice={() => setNotice('')}
      onSwitchGroup={(id) => { store(GROUP_KEY, id); setGroupId(id) }}
      onProfileChange={setProfile}
      onGroupsChange={loadGroups}
    />
  )
}

function Brand() {
  return (
    <div className="brand">
      <Wordmark />
    </div>
  )
}

function Splash() {
  return <div className="center-page"><p className="muted">Opening the shelves…</p></div>
}

function SetupNeeded() {
  return (
    <div className="center-page">
      <div className="panel">
        <Brand />
        <p>This site isn't connected to its database yet.</p>
        <p className="muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> (or to your host's environment variables) and restart. The README walks through it.</p>
      </div>
    </div>
  )
}

function Login({ inviting }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSending(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    })
    setSending(false)
    if (error) setError(friendlyError(error))
    else setSentTo(email.trim())
  }

  return (
    <div className="center-page">
      <div className="panel">
        <Brand />
        <p className="tagline">{TAGLINE}</p>
        {inviting && <p className="pill-note">You've been invited to a friend's library. Sign in to join.</p>}
        {sentTo ? (
          <div className="sent">
            <h2>Check your email</h2>
            <p>We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device and you'll land back here, signed in.</p>
            <button className="btn ghost" onClick={() => setSentTo('')}>Use a different email</button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <label className="field">
              <span>Email</span>
              <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <button className="btn" disabled={sending}>{sending ? 'Sending…' : 'Email me a sign-in link'}</button>
            {error && <p className="error">{error}</p>}
            <p className="muted small">No password. We email you a link each time you sign in.</p>
          </form>
        )}
      </div>
    </div>
  )
}

function NameSetup({ userId, email, onDone }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const { data, error } = await supabase.from('profiles').insert({ id: userId, display_name: name.trim() }).select().single()
    setSaving(false)
    if (error) setError(friendlyError(error))
    else onDone(data)
  }

  return (
    <div className="center-page">
      <div className="panel">
        <Brand />
        <h2>What should friends call you?</h2>
        <p className="muted small">Signed in as {email}. This name shows on your books and when you borrow one.</p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Your name</span>
            <input id="display-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ted" />
          </label>
          <button className="btn" disabled={saving || !name.trim()}>Continue</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  )
}

function NoGroup({ onReady, notice }) {
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState(notice && !notice.startsWith('Welcome') ? notice : '')
  const [busy, setBusy] = useState(false)

  async function create(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('create_group', { group_name: name.trim() })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onReady(data)
  }

  async function join(e) {
    e.preventDefault()
    const match = link.match(/join=([a-z0-9]+)/i)
    const code = match ? match[1] : link.trim()
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('join_group', { code })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onReady(data)
  }

  return (
    <div className="center-page">
      <div className="panel wide">
        <Brand />
        <h2>Start your library</h2>
        <div className="two-up">
          <form onSubmit={create} className="stack">
            <h3>Start a new one</h3>
            <p className="muted small">You'll get an invite link to send your friends.</p>
            <label className="field">
              <span>Library name</span>
              <input id="group-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Book Club Girls" />
            </label>
            <button className="btn" disabled={busy || !name.trim()}>Create library</button>
          </form>
          <form onSubmit={join} className="stack">
            <h3>Join a friend's</h3>
            <p className="muted small">Paste the invite link a friend sent you.</p>
            <label className="field">
              <span>Invite link</span>
              <input id="invite-link" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…?join=…" />
            </label>
            <button className="btn ghost" disabled={busy || !link.trim()}>Join library</button>
          </form>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
