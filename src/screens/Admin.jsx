import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store.jsx'
import * as api from '../lib/studio.js'
import { MIN_PORTFOLIO_PHOTOS, money } from '../data.js'
import { Button, H1, Icon, Notice, Photo, Screen, TopBar, inputCls } from '../ui.jsx'

const DOC_LABEL = { sa_id_front: 'ID — front', sa_id_back: 'ID — back', passport: 'Passport', selfie: 'Selfie' }
const norm = (s = '') => s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()

/** Admins only. The database enforces this too (row level security), so a non-admin simply sees nothing. */
function useAdminGuard() {
  const { auth } = useApp()
  return auth.status === 'in' && auth.profile?.role === 'admin'
}
function NotAdmin() {
  const { jump } = useApp()
  return (
    <Screen footer={<Button variant="soft" arrow={false} onClick={() => jump('home')}>Go home</Button>}>
      <div className="px-5 pt-8"><H1>Admins only.</H1><p className="mt-2 text-[14px] text-neutral-600">You need an admin account to see this page.</p></div>
    </Screen>
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
