import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import * as api from '../lib/studio.js'
import { startAuthenticator, verifyAuthenticator } from '../lib/auth.js'
import * as market from '../lib/market.js'
import { ago } from './Notifications.jsx'
import { MIN_PORTFOLIO_PHOTOS, money } from '../data.js'
import { Button, H1, Icon, Notice, Photo, Screen, TopBar, inputCls } from '../ui.jsx'

const DOC_LABEL = { sa_id_front: 'ID — front', sa_id_back: 'ID — back', passport: 'Passport', selfie: 'Selfie' }
const norm = (s = '') => s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()

/** Admins only, and only in a session verified with an authenticator app. The database enforces both (row level
 *  security and is_admin()), so without them a screen simply sees nothing. */
function useAdminGuard() {
  const { auth } = useApp()
  return auth.status === 'in' && auth.profile?.role === 'admin' && auth.aal === 'aal2'
}
function NotAdmin() {
  const { auth, jump } = useApp()
  if (auth.status === 'in' && auth.profile?.role === 'admin') return <Screen><div className="px-5 pt-6"><AdminTwoStep /></div></Screen>
  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={() => jump('home')}>Go home</Button>}>
      <div className="px-5 pt-8"><H1>Admins only.</H1><p className="mt-2 text-[14px] text-neutral-600">You need an admin account to see this page.</p></div>
    </Screen>
  )
}

/* ---------- Two-step sign-in for admins (authenticator app) ---------- */
export function AdminTwoStep() {
  const { auth, refreshAccount } = useApp()
  const hasApp = (auth.mfaFactors || []).length > 0
  const [setup, setSetup] = useState(null)   // { id, qr, secret } while adding an app
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  if (auth.aal === 'aal2') {
    return <Notice icon={<Icon.Shield size={18} />} title="Two-step sign-in is on">This session is verified with your authenticator app, so admin tools are unlocked.</Notice>
  }
  const begin = async () => {
    setBusy(true); setError('')
    const res = await startAuthenticator()
    setBusy(false)
    res.error ? setError(res.error) : setSetup(res)
  }
  const check = async () => {
    const factorId = setup ? setup.id : auth.mfaFactors[0].id
    setBusy(true); setError('')
    const res = await verifyAuthenticator(factorId, code)
    if (res.error) { setBusy(false); return setError(res.error) }
    await refreshAccount(auth.user, { force: true })
    setBusy(false)
  }
  const codeOk = /^\d{6}$/.test(code.replace(/\D/g, ''))
  return (
    <div className="rounded-2xl border border-line p-5" data-testid="admin-two-step">
      <div className="flex items-center gap-2 text-[15px] font-semibold"><Icon.Shield size={18} /> {hasApp ? 'Enter your sign-in code' : 'Turn on two-step sign-in'}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-600">
        {hasApp
          ? 'Open your authenticator app and type the 6-digit code for SnapshotZA. Admin tools unlock for this session.'
          : 'Admin tools can approve photographers, check bank details and release money, so they need a second step: a code from an authenticator app (Google Authenticator, Microsoft Authenticator or similar) on your phone.'}
      </p>
      {!hasApp && !setup && <div className="mt-4"><Button disabled={busy} onClick={begin}>{busy ? 'Starting…' : 'Set up my authenticator app'}</Button></div>}
      {setup && (
        <div className="mt-4 flex flex-wrap items-start gap-5">
          <img src={setup.qr} alt="QR code to scan with your authenticator app" className="h-44 w-44 rounded-xl border border-line bg-white p-2" />
          <div className="min-w-0 flex-1 text-[13px] text-neutral-600">
            <p><b>1.</b> In your authenticator app, add an account and scan this code.</p>
            <button onClick={() => setShowSecret((v) => !v)} className="mt-1 font-semibold text-link">{showSecret ? 'Hide' : "Can't scan? Type a key instead"}</button>
            {showSecret && <p className="mt-1 break-all rounded-lg bg-surface p-2 font-mono text-[12px]" data-testid="totp-secret">{setup.secret}</p>}
            <p className="mt-3"><b>2.</b> Type the 6-digit code it shows.</p>
          </div>
        </div>
      )}
      {(hasApp || setup) && (
        <div className="mt-4 flex items-end gap-3">
          <label className="block flex-1">
            <span className="mb-1.5 block text-xs text-neutral-500">6-digit code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))} onKeyDown={(e) => e.key === 'Enter' && codeOk && !busy && check()}
              inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" aria-label="6-digit code" className={`${inputCls} tracking-[0.3em]`} />
          </label>
          <div className="w-40"><Button arrow={false} disabled={!codeOk || busy} onClick={check}>{busy ? 'Checking…' : 'Verify'}</Button></div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
      {hasApp && <p className="mt-3 text-[12px] text-neutral-500">Lost your phone? The owner can remove the app from your account in Supabase (Authentication, Users), then you can set it up again.</p>}
    </div>
  )
}

/* ---------- Pending photographers ---------- */
export function AdminList() {
  const isAdmin = useAdminGuard()
  const { go, jump, set } = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await api.listPendingPhotographers())
    } catch (e) {
      setError(api.explain(e))
      setItems([])
    }
  }, [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  if (!isAdmin) return <NotAdmin />

  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={load}>Refresh</Button>}>
      <TopBar title="Photographer reviews" onBack={() => jump('account')} />
      <div className="px-5 pb-4">
        <H1 className="mt-3">Waiting for<br />review.</H1>
        <p className="mt-1 text-[13px] text-neutral-500">Photographers who finished onboarding and submitted their details.</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && (
          <Notice className="mt-5" icon={<Icon.Check size={18} />} title="All caught up">No photographers are waiting for review.</Notice>
        )}
        <div className="mt-5 space-y-3">
          {items?.map((p) => (
            <button
              key={p.id}
              onClick={() => { set({ adminPid: p.id }); go('adminReview') }}
              className="flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left"
            >
              <div className="flex-1">
                <div className="text-[15px] font-semibold">{p.profiles?.full_name || 'Unnamed'}</div>
                <div className="text-[12px] text-neutral-500">{p.profiles?.email} · {p.location || 'No location'}</div>
                <div className="mt-1 text-[11px] text-neutral-400">Joined {new Date(p.created_at).toLocaleDateString('en-ZA')}</div>
              </div>
              <Icon.Chevron size={18} />
            </button>
          ))}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- One photographer: everything needed to decide ---------- */
const Section = ({ title, children }) => (
  <section className="mt-6">
    <h2 className="mb-2 font-display text-[16px] font-bold">{title}</h2>
    {children}
  </section>
)
const Row = ({ k, v }) => (
  <div className="flex justify-between gap-4 py-1.5 text-[13px]">
    <span className="text-neutral-500">{k}</span>
    <span className="text-right font-medium break-all">{v || '—'}</span>
  </div>
)

export function AdminReview() {
  const isAdmin = useAdminGuard()
  const { back, jump, state } = useApp()
  const [pack, setPack] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAdmin || !state.adminPid) return
    let cancelled = false
    api.loadReviewPack(state.adminPid)
      .then((p) => { if (!cancelled) setPack(p) })
      .catch((e) => { if (!cancelled) setError(api.explain(e)) })
    return () => { cancelled = true }
  }, [isAdmin, state.adminPid])
  if (!isAdmin) return <NotAdmin />

  const decide = async (approve) => {
    setBusy(true)
    setError('')
    try {
      await api.reviewPhotographer(state.adminPid, approve, note.trim())
      jump('adminList')
    } catch (e) {
      setError(api.explain(e))
      setBusy(false)
    }
  }

  const pp = pack?.photographer
  const owner = pp?.profiles
  const nameMatches = pack?.bank && owner ? norm(pack.bank.account_holder) === norm(owner.full_name) : null
  const hasId = pack?.docs.some((d) => d.type === 'passport') || (pack?.docs.some((d) => d.type === 'sa_id_front') && pack?.docs.some((d) => d.type === 'sa_id_back'))
  const checks = pack && [
    [`${pack.photos.length} portfolio photos (need ${MIN_PORTFOLIO_PHOTOS}+)`, pack.photos.length >= MIN_PORTFOLIO_PHOTOS],
    [`${pack.packages.length} packages (need 3)`, pack.packages.length >= 3],
    ['Bank details added', Boolean(pack.bank)],
    ['ID document uploaded', Boolean(hasId)],
    ['Selfie uploaded', pack.docs.some((d) => d.type === 'selfie')],
    ['Terms accepted', Boolean(pp.terms_accepted_at)],
  ]

  return (
    <Screen
      footer={
        pack && (
          rejecting ? (
            <div className="space-y-2">
              <textarea
                rows={3}
                className={`${inputCls} h-auto resize-none py-3`}
                placeholder="Tell the photographer what to fix (they will see this)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button variant="dark" disabled={busy || note.trim().length < 5} onClick={() => decide(false)}>{busy ? 'Sending…' : 'Send rejection'}</Button>
              <Button variant="soft" arrow={false} disabled={busy} onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button disabled={busy} onClick={() => decide(true)}>{busy ? 'Approving…' : 'Approve photographer'}</Button>
              <Button variant="soft" arrow={false} disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
            </div>
          )
        )
      }
    >
      <TopBar title="Review" onBack={back} />
      <div className="px-5 pb-4">
        {error && <p role="alert" className="mt-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {!pack && !error && <p className="mt-4 text-[13px] text-neutral-500">Loading…</p>}
        {pack && (
          <>
            <H1 className="mt-2 text-[26px]">{owner?.full_name || 'Unnamed'}</H1>
            <p className="text-[13px] text-neutral-500">{pp.location} · {(pp.specialties || []).join(', ') || 'No specialties'}</p>

            <Section title="Checklist">
              <ul className="space-y-1.5">
                {checks.map(([label, ok]) => (
                  <li key={label} className={`flex items-center gap-2 text-[13px] ${ok ? '' : 'font-semibold text-rose-600'}`}>
                    <span className={ok ? 'text-ok' : 'text-rose-600'}>{ok ? <Icon.Check size={15} /> : '✕'}</span> {label}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Does the name match?">
              <div className={`rounded-2xl p-3.5 text-[13px] ${nameMatches === false ? 'bg-rose-50' : 'bg-surface'}`}>
                <Row k="Profile name" v={owner?.full_name} />
                <Row k="Bank account holder" v={pack.bank?.account_holder} />
                <p className="mt-1 text-[12px] text-neutral-500">
                  {nameMatches === null ? 'No bank details yet.' : nameMatches ? 'Names match. Also compare them with the ID photo below.' : 'Names differ. Check the ID photo before approving.'}
                </p>
              </div>
            </Section>

            <Section title="ID documents (private)">
              {pack.docs.length === 0 && <p className="text-[13px] text-neutral-500">Nothing uploaded.</p>}
              <div className="grid grid-cols-2 gap-3">
                {pack.docs.map((d) => (
                  <a key={d.type} href={d.url || undefined} target="_blank" rel="noreferrer" className="block">
                    <div className="h-[130px] overflow-hidden rounded-xl bg-surface">
                      {d.url ? <img src={d.url} alt={DOC_LABEL[d.type]} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-rose-600">{d.error || 'Could not load'}</div>}
                    </div>
                    <div className="mt-1 text-[12px] font-medium">{DOC_LABEL[d.type] || d.type}</div>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-neutral-400">Links expire after 10 minutes. Tap a photo to open it full size.</p>
            </Section>

            <Section title="Bank details">
              {pack.bank ? (
                <div className="rounded-2xl bg-surface p-3.5">
                  <Row k="Bank" v={pack.bank.bank_name} />
                  <Row k="Account holder" v={pack.bank.account_holder} />
                  <Row k="Account number" v={pack.bank.account_number} />
                  <Row k="Type" v={pack.bank.account_type} />
                  <Row k="Branch code" v={pack.bank.branch_code} />
                </div>
              ) : <p className="text-[13px] text-neutral-500">Not added.</p>}
            </Section>

            <Section title="Packages">
              <div className="space-y-2">
                {pack.packages.map((k) => (
                  <div key={k.id} className="flex items-center justify-between rounded-xl bg-surface p-3 text-[13px]">
                    <div><div className="font-semibold">{k.name}</div><div className="text-[11.5px] text-neutral-500">{k.duration_hours}h · {k.num_photos} photos · {k.delivery_days} days</div></div>
                    <div className="font-display text-[16px] font-bold">{money(Number(k.price_zar))}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Bio">
              <p className="text-[13px] leading-relaxed text-neutral-700">{pp.bio || '—'}</p>
            </Section>

            <Section title="Portfolio">
              <div className="grid grid-cols-3 gap-2">
                {pack.photos.map((ph) => <Photo key={ph.id} src={ph.thumbnail_url || ph.url} tone="sand" className="h-[90px] rounded-lg" />)}
              </div>
            </Section>

            <Section title="Contact">
              <div className="rounded-2xl bg-surface p-3.5"><Row k="Email" v={owner?.email} /><Row k="Phone" v={owner?.phone} /></div>
            </Section>
            <div className="h-4" />
          </>
        )}
      </div>
    </Screen>
  )
}

/* ---------- Problem reports ---------- */
const REPORT_TYPE = {
  photographer_no_show: 'Photographer did not show up',
  client_no_show: 'Client did not show up',
  not_delivered: 'Photos not delivered',
  poor_quality: 'Photos not as agreed',
  other: 'Something else',
}
const REPORT_STATUS = {
  open: ['Open', 'bg-rose-50 text-rose-700'],
  investigating: ['Looking into it', 'bg-cream text-amber-700'],
  resolved_client: ['Client refunded', 'bg-surface text-neutral-600'],
  resolved_photographer: ['Photographer paid', 'bg-surface text-neutral-600'],
  closed: ['Dismissed', 'bg-surface text-neutral-600'],
}

export function AdminReports() {
  const isAdmin = useAdminGuard()
  const { go, jump, set } = useApp()
  const [tab, setTab] = useState('open')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setItems(null)
    try {
      setItems(await market.listReports(tab))
    } catch (e) {
      setError(api.explain(e))
      setItems([])
    }
  }, [tab])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  if (!isAdmin) return <NotAdmin />

  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={load}>Refresh</Button>}>
      <TopBar title="Problem reports" onBack={() => jump('account')} />
      <div className="px-5 pb-4">
        <div className="mt-2 flex gap-2" role="tablist">
          {[['open', 'Open'], ['decided', 'Decided']].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-ink text-white' : 'bg-surface text-neutral-600'}`}>{label}</button>
          ))}
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && (
          <Notice className="mt-5" icon={<Icon.Check size={18} />} title={tab === 'open' ? 'All caught up' : 'Nothing decided yet'}>
            {tab === 'open' ? 'No problem reports are waiting for a decision.' : 'Reports you have decided will appear here.'}
          </Notice>
        )}
        <div className="mt-5 space-y-3">
          {items?.map((r) => {
            const [label, tone] = REPORT_STATUS[r.status] || [r.status, 'bg-surface']
            return (
              <button key={r.id} onClick={() => { set({ adminReportId: r.id }); go('adminReport') }} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-semibold">{REPORT_TYPE[r.type] || r.type}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12.5px] text-neutral-600">{r.description}</div>
                  {r.decision_due_by && tab === 'open' && <div className="mt-0.5 text-[11.5px] font-semibold text-amber-700">Decision due {new Date(r.decision_due_by).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</div>}
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-neutral-400">
                    <span>{r.bookingRef}</span><span>·</span><span>{ago(r.created_at)}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${tone}`}>{label}</span>
                  </div>
                </div>
                <Icon.Chevron size={18} />
              </button>
            )
          })}
        </div>
      </div>
    </Screen>
  )
}

const OUTCOMES = [
  ['refund_client', 'Refund the client', 'Cancels the booking and refunds the part that has not been paid out. The first payment already released stays with the photographer.'],
  ['pay_photographer', 'Pay the photographer', 'Marks the booking complete and releases the full amount to the photographer.'],
  ['split', 'Split the decision', 'The client gets a percentage of the unpaid part back; the photographer is paid the rest.'],
  ['dismiss', 'Dismiss the report', 'No action. The booking carries on as normal and held payments are released again.'],
]

export function AdminReport() {
  const isAdmin = useAdminGuard()
  const { back, state } = useApp()
  const id = state.adminReportId
  const [pack, setPack] = useState(null)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState('')
  const [pct, setPct] = useState('50')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    try {
      setPack(await market.loadReport(id))
    } catch (e) {
      setError(api.explain(e))
    }
  }, [id])
  useEffect(() => { if (isAdmin && id) load() }, [isAdmin, id, load])
  if (!isAdmin) return <NotAdmin />

  const decide = async () => {
    setBusy(true)
    setError('')
    try {
      await market.resolveReport(id, outcome, note.trim(), outcome === 'split' ? Number(pct) : null)
      setDone(true)
      await load()
    } catch (e) {
      setError(api.explain(e))
    } finally {
      setBusy(false)
    }
  }

  if (!pack) {
    return (
      <Screen>
        <TopBar title="Report" onBack={back} />
        <div className="px-5 pt-6">{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p> : <p className="text-[13px] text-neutral-500">Loading…</p>}</div>
      </Screen>
    )
  }
  const { report: r, booking: b, client, photographer: ph, payouts } = pack
  const open = r.status === 'open' || r.status === 'investigating'
  const [slabel, stone] = REPORT_STATUS[r.status] || [r.status, 'bg-surface']
  const raisedByClient = r.raised_by === b.client_id
  const noShow = outcome === 'refund_client' && r.type === 'photographer_no_show'
  const paidOut = payouts.filter((p) => p.status !== 'failed').reduce((t, p) => t + Number(p.amount), 0)
  const settled = payouts.filter((p) => p.status === 'completed' || p.status === 'processing').reduce((t, p) => t + Number(p.amount), 0)
  const price = Number(b.package_price), net = Number(b.net_amount)
  const fullRefund = r.type === 'photographer_no_show' ? Number(b.total_amount) - settled : Math.round((price - (paidOut * price) / net) * 100) / 100
  const pctNum = Number(pct)
  const splitOk = Number.isInteger(pctNum) && pctNum >= 1 && pctNum <= 99
  const preview = outcome === 'refund_client' ? `The client will be refunded ${money(fullRefund)} (to be sent within 14 days).`
    : outcome === 'pay_photographer' ? `The photographer will be paid ${money(net - paidOut)} more, on top of ${money(paidOut)} already released.`
    : outcome === 'split' && splitOk ? `The client gets ${money(Math.round(fullRefund * pctNum) / 100)}; the photographer gets ${money(Math.round((net - paidOut) * (100 - pctNum)) / 100)} more.`
    : ''

  return (
    <Screen>
      <TopBar title={b.booking_ref} onBack={back} />
      <div className="px-5 pb-8">
        <div className="mt-2 flex items-center justify-between gap-3">
          <H1 className="text-[26px]">{REPORT_TYPE[r.type] || r.type}</H1>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${stone}`}>{slabel}</span>
        </div>
        <p className="mt-1 text-[12px] text-neutral-500">Reported by the {raisedByClient ? 'client' : 'photographer'} · {ago(r.created_at)}{r.decision_due_by && open ? ` · decision due ${new Date(r.decision_due_by).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}</p>
        <blockquote className="mt-3 rounded-2xl bg-surface p-4 text-[14px] leading-snug">{r.description}</blockquote>

        <Section title="The booking">
          <Row k="Package" v={pack.packageName} />
          <Row k="Shoot" v={`${b.shoot_date} at ${String(b.shoot_time).slice(0, 5)}`} />
          <Row k="Booking status" v={b.status.replace('_', ' ')} />
          <Row k="Rate" v={b.rate_type === 'saver' ? 'Saver (no refunds)' : 'Flexible'} />
          <Row k="Client paid" v={`${money(Number(b.total_amount))}${Number(b.flex_fee) > 0 ? ` (incl. ${money(Number(b.flex_fee))} flexible fee)` : ''}`} />
          <Row k="Package price" v={money(price)} />
          <Row k="Photographer's net" v={money(net)} />
          <Row k="Fees (platform + gateway)" v={money(Number(b.platform_fee) + Number(b.transaction_fee))} />
          <Row k="Shoot marked complete" v={b.shoot_completed_at ? new Date(b.shoot_completed_at).toLocaleString('en-ZA') : 'No'} />
          <Row k="Client confirmed" v={b.shoot_confirmed_at ? new Date(b.shoot_confirmed_at).toLocaleString('en-ZA') : 'No'} />
          {b.simulated && <Row k="Payment" v="Test payment" />}
        </Section>

        <Section title="People">
          <Row k="Client" v={client?.full_name} />
          <Row k="Client contact" v={[client?.email, client?.phone].filter(Boolean).join(' · ')} />
          <Row k="Photographer" v={ph?.full_name} />
          <Row k="Photographer contact" v={[ph?.email, ph?.phone].filter(Boolean).join(' · ')} />
          <Row k="Earlier strikes" v={String(ph?.strike_count ?? 0)} />
        </Section>

        <Section title={`Payments (${money(paidOut)} released so far)`}>
          {payouts.length === 0 && <p className="text-[13px] text-neutral-500">Nothing has been released to the photographer yet.</p>}
          {payouts.map((p) => (
            <Row key={p.id} k={`${p.type === 'deposit_release' ? 'Early payment' : 'Final payment'} · ${p.frozen && p.status === 'pending' ? 'on hold' : p.status}`} v={money(Number(p.amount))} />
          ))}
        </Section>

        {!open && (
          <Notice className="mt-6" icon={<Icon.Check size={18} />} title="Decided">
            {r.resolution ? <>Your note: “{r.resolution}”</> : 'This report has been decided.'}
          </Notice>
        )}

        {open && (
          <Section title="Your decision">
            <div className="space-y-2.5" role="radiogroup" aria-label="Decision">
              {OUTCOMES.map(([val, label, hint]) => (
                <button key={val} role="radio" aria-checked={outcome === val} onClick={() => setOutcome(val)} className={`block w-full rounded-2xl p-3.5 text-left ${outcome === val ? 'bg-brand' : 'bg-surface'}`}>
                  <div className="text-[14px] font-semibold">{label}</div>
                  <div className="mt-0.5 text-[12px] text-neutral-700">{hint}</div>
                </button>
              ))}
            </div>
            {noShow && <Notice className="mt-3" tone="cream" title="The photographer gets a strike">Refunding a photographer no-show refunds everything (including the flexible fee) and gives the photographer a strike. A second strike suspends them for 30 days; a third removes them.</Notice>}
            {outcome === 'split' && (
              <div className="mt-3">
                <label htmlFor="split-pct" className="block text-[12px] font-semibold text-neutral-600">Client's share of the unpaid part (%)</label>
                <input id="split-pct" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, '').slice(0, 2))} className={`${inputCls} mt-1`} />
              </div>
            )}
            {preview && <p className="mt-3 rounded-xl bg-cream p-3 text-[13px] font-semibold" data-testid="decision-preview">{preview}</p>}
            <label htmlFor="decision-note" className="mt-4 block text-[12px] font-semibold text-neutral-600">Note to both people (required)</label>
            <textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Why did you decide this?" className={`${inputCls} mt-1 h-auto py-2.5`} />
            {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
            <div className="mt-4">
              <Button disabled={!outcome || note.trim().length < 5 || busy || (outcome === 'split' && !splitOk)} onClick={decide}>{busy ? 'Saving…' : 'Confirm decision'}</Button>
            </div>
          </Section>
        )}
        {done && !open && <p className="mt-3 text-[12.5px] text-ok">Decision saved. Both people were notified.</p>}
      </div>
    </Screen>
  )
}

/* ---------- Real bank transfers waiting to be sent ---------- */
function TransferCard({ g, onDone }) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const held = g.payouts.filter((p) => p.frozen)
  const payable = g.payouts.filter((p) => !p.frozen)
  const total = payable.reduce((t, p) => t + p.amount, 0)
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await market.completeTransfers(payable.map((p) => p.id), ref.trim())
      await onDone()
    } catch (e) {
      setError(api.explain(e))
      setBusy(false)
    }
  }
  return (
    <div className="rounded-2xl bg-surface p-4" data-testid="transfer">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[15px] font-semibold">{g.name}</div>
        <div className="font-display text-[20px] font-extrabold">{money(total)}</div>
      </div>
      {g.bank ? (
        <div className="mt-2 rounded-xl bg-white p-3 text-[12.5px] leading-relaxed">
          <div><span className="text-neutral-500">Bank</span> {g.bank.bank_name} · {g.bank.account_type}</div>
          <div><span className="text-neutral-500">Account holder</span> {g.bank.account_holder}</div>
          <div><span className="text-neutral-500">Account number</span> <b className="select-all">{g.bank.account_number}</b></div>
          {g.bank.branch_code && <div><span className="text-neutral-500">Branch code</span> {g.bank.branch_code}</div>}
        </div>
      ) : <p className="mt-2 rounded-xl bg-rose-50 p-3 text-[12.5px] text-rose-700">No bank details on file.</p>}
      <ul className="mt-2 space-y-0.5 text-[12px] text-neutral-600">
        {payable.map((p) => <li key={p.id} className="flex justify-between"><span>{p.bookingRef} · {p.type === 'deposit_release' ? 'Early payment' : 'Final payment'}</span><span>{money(p.amount)}</span></li>)}
        {held.map((p) => <li key={p.id} className="flex justify-between text-rose-700"><span>{p.bookingRef} · on hold (problem report)</span><span>{money(p.amount)}</span></li>)}
      </ul>
      {payable.length > 0 && (
        <>
          <label htmlFor={`ref-${g.photographerId}`} className="mt-3 block text-[12px] font-semibold text-neutral-600">Bank reference (after you have made the transfer)</label>
          <input id={`ref-${g.photographerId}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. EFT-20261114-01" className={`${inputCls} mt-1`} />
          {error && <p role="alert" className="mt-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
          <div className="mt-3"><Button disabled={busy || ref.trim().length < 3 || !g.bank} onClick={send}>{busy ? 'Saving…' : `Mark ${money(total)} as sent`}</Button></div>
        </>
      )}
    </div>
  )
}

export function AdminPayouts() {
  const isAdmin = useAdminGuard()
  const { jump } = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await market.listTransfers())
    } catch (e) {
      setError(api.explain(e))
      setItems([])
    }
  }, [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  if (!isAdmin) return <NotAdmin />
  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={load}>Refresh</Button>}>
      <TopBar title="Payouts to send" onBack={() => jump('account')} />
      <div className="px-5 pb-4">
        <p className="mt-2 text-[13px] text-neutral-500">Photographers who asked to withdraw. Pay them from your bank, then enter the bank’s reference here. They are told the money was sent. Test withdrawals never appear here.</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && <Notice className="mt-5" icon={<Icon.Check size={18} />} title="Nothing to send">No withdrawals are waiting for a bank transfer.</Notice>}
        <div className="mt-5 space-y-3">{items?.map((g) => <TransferCard key={g.photographerId} g={g} onDone={load} />)}</div>
      </div>
    </Screen>
  )
}

/* ---------- Bank details waiting for a re-check ---------- */
export function AdminBanks() {
  const isAdmin = useAdminGuard()
  const { jump } = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await market.listBankChecks())
    } catch (e) {
      setError(api.explain(e))
      setItems([])
    }
  }, [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  if (!isAdmin) return <NotAdmin />
  const verify = async (id) => {
    setBusy(id)
    setError('')
    try {
      await market.verifyBank(id)
      await load()
    } catch (e) {
      setError(api.explain(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={load}>Refresh</Button>}>
      <TopBar title="Bank checks" onBack={() => jump('account')} />
      <div className="px-5 pb-4">
        <p className="mt-2 text-[13px] text-neutral-500">Photographers who changed their bank details cannot withdraw until you have checked them. Make sure the account holder matches the name on their ID.</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && <Notice className="mt-5" icon={<Icon.Check size={18} />} title="All caught up">No bank details are waiting for a check.</Notice>}
        <div className="mt-5 space-y-3">
          {items?.map((g) => (
            <div key={g.photographerId} className="rounded-2xl bg-surface p-4" data-testid="bank-check">
              <div className="text-[15px] font-semibold">{g.name}</div>
              <div className="text-[12px] text-neutral-500">{g.email}</div>
              <div className="mt-2 rounded-xl bg-white p-3 text-[12.5px] leading-relaxed">
                <div><span className="text-neutral-500">Bank</span> {g.bank.bank_name} · {g.bank.account_type}</div>
                <div><span className="text-neutral-500">Account holder</span> {g.bank.account_holder}</div>
                <div><span className="text-neutral-500">Account number</span> <b>{g.bank.account_number}</b></div>
                {g.bank.branch_code && <div><span className="text-neutral-500">Branch code</span> {g.bank.branch_code}</div>}
              </div>
              <div className="mt-3"><Button disabled={busy === g.photographerId} onClick={() => verify(g.photographerId)}>{busy === g.photographerId ? 'Saving…' : 'These details are correct'}</Button></div>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- Refunds to send (due within 14 days) ---------- */
function RefundCard({ r, onDone }) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const due = new Date(r.refund_due_by)
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000)
  const late = days < 0
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await market.markRefundSent(r.id, ref.trim())
      await onDone()
    } catch (e) {
      setError(api.explain(e))
      setBusy(false)
    }
  }
  return (
    <div className="rounded-2xl bg-surface p-4" data-testid="refund">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">{r.clientName}</div>
          <div className="text-[12px] text-neutral-500">{r.clientEmail} · {r.booking_ref}</div>
        </div>
        <div className="font-display text-[20px] font-extrabold">{money(r.amount)}</div>
      </div>
      <p className={`mt-1 text-[12.5px] font-semibold ${late ? 'text-rose-700' : days <= 3 ? 'text-amber-700' : 'text-neutral-600'}`}>
        {late ? `Overdue by ${-days} day${-days === 1 ? '' : 's'}` : `Due ${due.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })} (${days} day${days === 1 ? '' : 's'} left)`}
      </p>
      <label htmlFor={`rr-${r.id}`} className="mt-3 block text-[12px] font-semibold text-neutral-600">Reference (after you have refunded the payment)</label>
      <input id={`rr-${r.id}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. the payment provider's refund id" className={`${inputCls} mt-1`} />
      {error && <p role="alert" className="mt-2 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
      <div className="mt-3"><Button disabled={busy} onClick={send}>{busy ? 'Saving…' : `Mark ${money(r.amount)} as refunded`}</Button></div>
    </div>
  )
}

export function AdminRefunds() {
  const isAdmin = useAdminGuard()
  const { jump } = useApp()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setItems((await market.listRefunds()).filter((r) => !r.refund_sent_at))
    } catch (e) {
      setError(api.explain(e))
      setItems([])
    }
  }, [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  if (!isAdmin) return <NotAdmin />
  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={load}>Refresh</Button>}>
      <TopBar title="Refunds to send" onBack={() => jump('account')} />
      <div className="px-5 pb-4">
        <p className="mt-2 text-[13px] text-neutral-500">Clients are promised their refund within 14 days of the decision. Refund each one to the original payment method, then enter the reference here. The client is told it was sent.</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}
        {items === null && <p className="mt-6 text-[13px] text-neutral-500">Loading…</p>}
        {items?.length === 0 && !error && <Notice className="mt-5" icon={<Icon.Check size={18} />} title="No refunds waiting">Every refund has been sent.</Notice>}
        <div className="mt-5 space-y-3">{items?.map((r) => <RefundCard key={r.id} r={r} onDone={load} />)}</div>
      </div>
    </Screen>
  )
}
