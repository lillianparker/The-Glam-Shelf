import { useCallback, useEffect, useState } from 'react'
import { supabase, configured, friendlyError } from './supabase.js'
import { TAGLINE } from './config.js'
import Library from './Library.jsx'
import Wordmark from './Wordmark.jsx'
import AvatarPicker from './AvatarPicker.jsx'

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
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
    })
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
  if (recovering) return <NewPassword onDone={() => { setRecovering(false); setNotice('Password saved') }} />
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
      email={session.user.email}
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

const redirectTo = () => window.location.origin + window.location.pathname

function Login({ inviting }) {
  // signin | signup | forgot | link
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { title, body }
  const [error, setError] = useState('')

  function switchTo(m) { setMode(m); setError(''); setSent(null) }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const addr = email.trim()
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password })
        if (error) {
          setError(/invalid login/i.test(error.message)
            ? "Wrong email or password. If you've only ever signed in with email links, use “Email me a link” once, then set a password from the menu by your name."
            : /not confirmed/i.test(error.message)
              ? 'Confirm your email first: open the link we sent when you created your account.'
              : friendlyError(error))
        }
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: redirectTo() } })
        if (error) setError(friendlyError(error))
        else if (data.user && data.user.identities && data.user.identities.length === 0) {
          setError('That email already has an account. Sign in instead, or use “Forgot password?” to set one.')
        } else if (!data.session) {
          setSent({ title: 'Confirm your email', body: <>We sent a link to <strong>{addr}</strong>. Open it once to confirm your account. After that you'll sign in with your password.</> })
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: redirectTo() })
        if (error) setError(friendlyError(error))
        else setSent({ title: 'Check your email', body: <>We sent a link to <strong>{addr}</strong>. Open it on this device to choose a new password.</> })
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirectTo() } })
        if (error) setError(friendlyError(error))
        else setSent({ title: 'Check your email', body: <>We sent a sign-in link to <strong>{addr}</strong>. Open it on this device and you'll land back here, signed in.</> })
      }
    } finally {
      setBusy(false)
    }
  }

  const needsPassword = mode === 'signin' || mode === 'signup'
  const buttonLabel = {
    signin: busy ? 'Signing in…' : 'Sign in',
    signup: busy ? 'Creating…' : 'Create account',
    forgot: busy ? 'Sending…' : 'Email me a reset link',
    link: busy ? 'Sending…' : 'Email me a sign-in link',
  }[mode]

  return (
    <div className="center-page">
      <div className="panel">
        <Brand />
        <p className="tagline">{TAGLINE}</p>
        {inviting && <p className="pill-note">You've been invited to a friend's library. Sign in or create an account to join.</p>}

        {sent ? (
          <div className="sent">
            <h2>{sent.title}</h2>
            <p>{sent.body}</p>
            <button className="btn ghost" onClick={() => switchTo('signin')}>Back to sign in</button>
          </div>
        ) : (
          <>
            {(mode === 'signin' || mode === 'signup') && (
              <div className="segmented tabs" role="tablist" aria-label="Sign in or create an account">
                <button type="button" role="tab" aria-selected={mode === 'signin'} aria-pressed={mode === 'signin'} onClick={() => switchTo('signin')}>Sign in</button>
                <button type="button" role="tab" aria-selected={mode === 'signup'} aria-pressed={mode === 'signup'} onClick={() => switchTo('signup')}>Create account</button>
              </div>
            )}
            {mode === 'forgot' && <h2>Reset your password</h2>}
            {mode === 'link' && <h2>Sign in with an email link</h2>}

            <form onSubmit={submit} className="stack">
              <label className="field">
                <span>Email</span>
                <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              {needsPassword && (
                <label className="field">
                  <span>Password</span>
                  <input id="login-password" type="password" required minLength={mode === 'signup' ? 8 : undefined}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
              {mode === 'signup' && <p className="muted small">At least 8 characters.</p>}
              <button className="btn" disabled={busy}>{buttonLabel}</button>
              {error && <p className="error">{error}</p>}
            </form>

            <div className="login-links">
              {mode === 'signin' && <button type="button" className="linkish small" onClick={() => switchTo('forgot')}>Forgot password?</button>}
              {mode !== 'link' && <button type="button" className="linkish small muted" onClick={() => switchTo('link')}>Email me a link instead</button>}
              {(mode === 'forgot' || mode === 'link') && <button type="button" className="linkish small" onClick={() => switchTo('signin')}>Back to sign in</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Shown after opening a "reset password" email.
function NewPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else onDone()
  }

  return (
    <div className="center-page">
      <div className="panel">
        <Brand />
        <h2>Choose a new password</h2>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>New password</span>
            <input id="new-password" type="password" required minLength={8} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="muted small">At least 8 characters.</p>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  )
}

function NameSetup({ userId, email, onDone }) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    const row = { id: userId, display_name: name.trim(), ...(avatar ? { avatar } : {}) }
    let { data, error } = await supabase.from('profiles').insert(row).select().single()
    if (error && avatar && /avatar/i.test(error.message || '')) {
      // database not updated for avatars yet (update-5.sql): save the name anyway
      ;({ data, error } = await supabase.from('profiles').insert({ id: userId, display_name: name.trim() }).select().single())
    }
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
          <div className="field">
            <span id="setup-avatar-label">Pick an object for your shelf (optional)</span>
            <AvatarPicker value={avatar} onChange={setAvatar} label="Pick an object for your shelf" />
          </div>
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
