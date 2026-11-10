import { useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { AppNav } from './Client.jsx'
import { BANKS, BOOKINGS_PER_TIER, MAX_TIER, MIN_PORTFOLIO_PHOTOS, TIER_DEPOSIT_PCT, money, tierFor } from '../data.js'
import {
  Button, Checkbox, Field, H1, Icon, Notice, Photo, Screen, Segmented, Stepper, TopBar, inputCls,
} from '../ui.jsx'

const maskAcc = (n = '') => '•••• ' + n.slice(-4)

/* ---------- 8. Photographer dashboard ---------- */
export function Studio() {
  const { go, state } = useApp()
  const [open, setOpen] = useState([18, 21])
  const booked = [21, 24]
  const week = [
    ['M', 16], ['T', 17], ['W', 18], ['T', 19], ['F', 20], ['S', 21], ['S', 22],
  ]
  const done = state.completedBookings
  const tier = tierFor(done)
  const maxed = tier >= MAX_TIER
  const intoTier = done - (tier - 1) * BOOKINGS_PER_TIER
  const pct = maxed ? 100 : Math.round((intoTier / BOOKINGS_PER_TIER) * 100)
  const left = BOOKINGS_PER_TIER - intoTier

  return (
    <Screen nav={<AppNav active="profile" />}>
      <div className="px-5 pt-3">
        <div className="flex items-start justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Photographer studio</div>
          <button aria-label="Notifications"><Icon.Bell size={22} /></button>
        </div>
        <H1 className="mt-1 text-[30px]">Morning, {state.studio.name.split(' ')[0]}.</H1>
        <p className="mt-1 text-[13px] text-neutral-500">Let’s make your next great shot happen.</p>

        <div className="mt-4 rounded-3xl bg-ink p-5 text-white">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Earned this month</div>
          <div className="mt-1 font-display text-[38px] font-extrabold">{money(18450)}</div>
          <div className="text-[12px] text-emerald-400">↑ 18% vs last month</div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[13px]">
            <span className="text-neutral-300">In escrow</span>
            <span className="font-semibold text-brand">{money(9000)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-[#f1e3a0] bg-cream p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">Tier {tier} · {TIER_DEPOSIT_PCT[tier]}% paid 24h after each shoot</div>
          <div className="mt-1 font-display text-[19px] font-bold">{maxed ? 'You’re at the top tier.' : 'Your next level is close.'}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efe6bd]"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
          <div className="mt-2 text-[12px] text-neutral-700">
            {maxed ? `${done} completed bookings` : `${intoTier} / ${BOOKINGS_PER_TIER} bookings to Tier ${tier + 1}`}
          </div>
          <p className="mt-1 text-[12px] text-neutral-600">
            {maxed ? 'Half of every booking lands within 24 hours of the shoot. The rest follows delivery.' : `${left} more completed ${left === 1 ? 'booking' : 'bookings'} lifts your early payout from ${TIER_DEPOSIT_PCT[tier]}% to ${TIER_DEPOSIT_PCT[tier + 1]}%. The rest is paid after you deliver your photos.`}
          </p>
        </div>

        {!state.bank && (
          <button onClick={() => go('payouts')} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-info p-4 text-left">
            <Icon.Bank size={22} className="text-link" />
            <div className="flex-1"><div className="text-[13px] font-semibold">Add your bank details</div><div className="text-[12px] text-neutral-600">You can’t be paid until this is done.</div></div>
            <Icon.Chevron size={18} />
          </button>
        )}

        <div className="mb-3 mt-6 flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold">Upcoming bookings</h2>
          <button className="text-[13px] font-semibold text-link">View all</button>
        </div>
        <div className="space-y-3">
          {[
            ['21', 'Kayla & James', 'Wedding · Signature · 14:00', 4500],
            ['24', 'Sipho Ndlovu', 'Corporate · Half day · 09:00', 4500],
          ].map(([d, n, sub, amt]) => (
            <div key={d} className="flex items-center gap-4 rounded-2xl bg-surface p-3">
              <div className="flex h-14 w-14 flex-col items-center justify-center rounded-xl bg-white"><span className="font-display text-[20px] font-bold leading-none">{d}</span><span className="text-[10px] text-neutral-500">NOV</span></div>
              <div className="flex-1"><div className="text-[14px] font-semibold">{n}</div><div className="text-[11.5px] text-neutral-500">{sub}</div></div>
              <span className="self-end text-[11.5px] font-semibold text-link">Paid · {money(amt)}</span>
            </div>
          ))}
        </div>

        <div className="mb-3 mt-6 flex items-center justify-between">
          <h2 className="font-display text-[18px] font-bold">Your availability</h2>
          <button className="text-[13px] font-semibold text-link">Edit calendar</button>
        </div>
        <div className="flex gap-2">
          {week.map(([l, n]) => {
            const isBooked = booked.includes(n)
            const isOpen = open.includes(n)
            return (
              <button
                key={n}
                disabled={isBooked}
                onClick={() => setOpen((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]))}
                className={`flex h-[72px] flex-1 flex-col items-center justify-center gap-1 rounded-xl ${isBooked ? 'bg-ink text-white' : 'bg-surface'}`}
              >
                <span className={`text-[11px] ${isBooked ? 'text-neutral-300' : 'text-neutral-500'}`}>{l}</span>
                <span className="text-[15px] font-semibold">{n}</span>
                <span className={`h-1 w-1 rounded-full ${isBooked || isOpen ? 'bg-brand' : 'bg-transparent'}`} />
              </button>
            )
          })}
        </div>

        <div className="mt-4 space-y-2 pb-5 text-[12.5px]">
          {state.verification === 'verified' ? (
            <div className="flex items-center gap-2 text-link"><Icon.Check size={15} /> Identity verified · Your studio is ready to book.</div>
          ) : (
            <div className="flex items-center gap-2 text-amber-700"><Icon.Eye size={15} /> Identity under review · Usually within 24 hours.</div>
          )}
          {state.bank && (
            <button onClick={() => go('payouts')} className="flex items-center gap-2 text-link">
              <Icon.Bank size={15} /> Payouts to {state.bank.bank} {maskAcc(state.bank.account)} · Edit
            </button>
          )}
        </div>
      </div>
    </Screen>
  )
}

/* ---------- onboarding shell ---------- */
const STEP_LABELS = ['Profile', 'Portfolio', 'Packages', 'Payouts', 'Verification']
function Onb({ step, children, footer }) {
  const { back, jump } = useApp()
  return (
    <Screen footer={footer}>
      <TopBar title="Create your studio" onBack={back} right={<button onClick={() => jump('studio')} className="text-[13px] font-normal text-neutral-500">Save & exit</button>} />
      <Stepper steps={5} current={step} left={`0${step} / 05`} right={STEP_LABELS[step - 1].toUpperCase()} />
      <div className="px-5 pb-4">{children}</div>
    </Screen>
  )
}

/* ---------- 9. Step 1 — Profile ---------- */
export function OnbProfile() {
  const { go, set, state } = useApp()
  const s = state.studio
  const fileRef = useRef(null)
  const upd = (k) => (e) => set({ studio: { ...s, [k]: e.target.value } })
  const valid = s.name.trim() && s.city.trim() && s.specialty.trim()
  return (
    <Onb step={1} footer={<Button disabled={!valid} onClick={() => go('onbPortfolio')}>Continue to portfolio</Button>}>
      <H1 className="mt-5">Put a face to<br />your craft.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Build a profile clients can connect with.</p>
      <div className="mt-5 flex items-center gap-4">
        <Photo src={s.photo || '/photos/thabo.jpg'} tone="warm" label={s.name.split(' ').map((w) => w[0]).slice(0, 2).join('')} className="h-[72px] w-[72px] shrink-0 rounded-full" />
        <div>
          <div className="text-[14px] font-semibold">Looking sharp, {s.name.split(' ')[0] || 'there'}.</div>
          <button onClick={() => fileRef.current.click()} className="text-[13px] text-link">Change profile photo</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && set({ studio: { ...s, photo: URL.createObjectURL(e.target.files[0]) } })} />
        </div>
      </div>
      <div className="mt-5 space-y-4">
        <Field label="Full name"><input className={inputCls} value={s.name} onChange={upd('name')} /></Field>
        <Field label="Based in"><input className={inputCls} value={s.city} onChange={upd('city')} /></Field>
        <Field label="Your specialty"><input className={inputCls} value={s.specialty} onChange={upd('specialty')} /></Field>
        <Field label="Your bio"><textarea rows={3} maxLength={200} className={`${inputCls} h-auto resize-none py-3`} value={s.bio} onChange={upd('bio')} /></Field>
      </div>
    </Onb>
  )
}

/* ---------- 10. Step 2 — Portfolio ---------- */
const MAX_PHOTOS = 12
const TONE_CYCLE = ['green', 'dusk', 'cream', 'warm']
export function OnbPortfolio() {
  const { go, set, state } = useApp()
  const photos = state.portfolio
  const fileRef = useRef(null)
  const [err, setErr] = useState('')
  const add = (files) => {
    const next = []
    let problem = ''
    for (const f of files) {
      if (!/^image\/(jpeg|png)$/.test(f.type)) { problem = 'Only JPG or PNG photos are allowed.'; continue }
      if (f.size > 20 * 1024 * 1024) { problem = 'Each photo must be 20 MB or smaller.'; continue }
      next.push({ id: Date.now() + Math.random(), tone: 'sand', src: URL.createObjectURL(f) })
    }
    const room = MAX_PHOTOS - photos.length
    if (next.length > room) problem = `You can add up to ${MAX_PHOTOS} photos.`
    setErr(problem)
    set({ portfolio: [...photos, ...next.slice(0, room)] })
  }
  const makeCover = (id) => set({ portfolio: [photos.find((p) => p.id === id), ...photos.filter((p) => p.id !== id)] })
  const remove = (id) => set({ portfolio: photos.filter((p) => p.id !== id) })
  return (
    <Onb step={2} footer={<Button disabled={photos.length < MIN_PORTFOLIO_PHOTOS} onClick={() => go('onbPackages')}>Continue to packages</Button>}>
      <H1 className="mt-5">Let your work<br />do the talking.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Your best shots. Your signature style.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {photos.map((ph, i) => (
          <div key={ph.id} className="relative">
            <button onClick={() => makeCover(ph.id)} aria-label={`Make photo ${i + 1} the cover`} className="block w-full">
              <Photo src={ph.src} tone={ph.tone || TONE_CYCLE[i % 4]} className="h-[150px] rounded-2xl" />
            </button>
            <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-white text-[12px] font-semibold">{i + 1}</span>
            <button onClick={() => remove(ph.id)} aria-label="Remove photo" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"><span className="-mt-0.5 text-sm leading-none">×</span></button>
            {i === 0 && <span className="absolute bottom-2 left-2 rounded-md bg-brand px-2 py-1 text-[10px] font-bold">COVER</span>}
          </div>
        ))}
      </div>
      <button
        onClick={() => fileRef.current.click()}
        disabled={photos.length >= MAX_PHOTOS}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-surface p-4 text-left disabled:opacity-50"
      >
        <Icon.Plus size={22} />
        <div><div className="text-[14px] font-semibold">Add more photos</div><div className="text-[11.5px] text-neutral-500">JPG or PNG · Up to 20 MB each</div></div>
      </button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = '' }} />
      {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
      <p className="mt-3 text-[11.5px] text-neutral-500">
        {photos.length} of {MAX_PHOTOS} photos · Tap a photo to make it your cover{photos.length < MIN_PORTFOLIO_PHOTOS ? ` · Add at least ${MIN_PORTFOLIO_PHOTOS}` : ''}
      </p>
    </Onb>
  )
}

/* ---------- 11. Step 3 — Packages ---------- */
export function OnbPackages() {
  const { go, set, state } = useApp()
  const [editing, setEditing] = useState('signature')
  const pk = state.studioPackages
  const upd = (id, patch) => set({ studioPackages: pk.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const valid = pk.every((p) => p.price > 0)
  const sel = `${inputCls} appearance-none`
  return (
    <Onb step={3} footer={<Button disabled={!valid} onClick={() => go('payouts')}>Continue to payouts</Button>}>
      <H1 className="mt-5">Your craft.<br />Your price.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Offer three clear ways to book you.</p>
      <div className="mt-5 space-y-3">
        {pk.map((p, i) =>
          editing === p.id ? (
            <div key={p.id} className="rounded-2xl border-2 border-brand bg-cream p-4">
              <div className="mb-3 flex items-center justify-between"><span className="text-[14px] font-semibold">0{i + 1} {p.name}</span><span className="text-[10px] font-bold tracking-wider text-amber-700">EDITING</span></div>
              <div className="space-y-3">
                <Field label="Price (ZAR)"><input inputMode="numeric" className={`${inputCls} bg-white`} value={money(p.price)} onChange={(e) => upd(p.id, { price: Number(e.target.value.replace(/\D/g, '')) })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Shoot duration"><select className={`${sel} bg-white`} value={p.hours} onChange={(e) => upd(p.id, { hours: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 8, 10].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}</select></Field>
                  <Field label="Edited photos"><input inputMode="numeric" className={`${inputCls} bg-white`} value={p.photos} onChange={(e) => upd(p.id, { photos: Number(e.target.value.replace(/\D/g, '')) })} /></Field>
                </div>
                <Field label="Delivery time"><select className={`${sel} bg-white`} value={p.delivery} onChange={(e) => upd(p.id, { delivery: Number(e.target.value) })}>{[3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} days after your shoot</option>)}</select></Field>
              </div>
            </div>
          ) : (
            <button key={p.id} onClick={() => setEditing(p.id)} className="flex w-full items-center justify-between rounded-2xl bg-surface p-4 text-left">
              <span className="text-[14px] font-semibold">0{i + 1} {p.name}</span>
              <span className="font-display text-[17px] font-bold">{money(p.price)}</span>
            </button>
          ),
        )}
      </div>
      <Notice icon={<Icon.Lock size={16} />} tone="none" className="mt-4 !bg-transparent !p-0" title={<span className="font-normal text-link">All bookings are paid upfront into escrow.</span>}>
        New photographers start on Tier 1: full payment is held until delivery. Your payout level grows with you.
      </Notice>
    </Onb>
  )
}

/* ---------- 12. Step 4 — NEW: Payout (bank) details ---------- */
export function Payouts() {
  const { go, set, state } = useApp()
  const saved = state.bank
  const [bank, setBank] = useState(saved?.bank || '')
  const [holder, setHolder] = useState(saved?.holder || state.studio.name)
  const [account, setAccount] = useState(saved?.account || '')
  const [type, setType] = useState(saved?.type || 'cheque')
  const [confirm, setConfirm] = useState(!!saved)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const branch = BANKS.find((b) => b.name === bank)?.branch || ''
  const accOk = /^\d{7,16}$/.test(account)
  const valid = bank && holder.trim().length > 2 && accOk && confirm
  const submit = () => {
    setSaving(true)
    setTimeout(() => {
      set({ bank: { bank, holder: holder.trim(), account, type, branch } })
      setSaving(false)
      go('verify')
    }, 900)
  }
  return (
    <Onb step={4} footer={<Button disabled={!valid || saving} onClick={submit}>{saving ? 'Checking your account…' : 'Save & continue'}</Button>}>
      <H1 className="mt-5">Get paid,<br />safely.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Tell us where to send your earnings.</p>

      <Notice icon={<Icon.Lock size={18} />} className="mt-4" title="Your bank details. Protected.">
        Encrypted and used only to pay you. Never shown on your profile or to clients.
      </Notice>

      <div className="mt-5 space-y-4">
        <Field label="Bank">
          <div className="relative">
            <select className={`${inputCls} appearance-none pr-10`} value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Select your bank</option>
              {BANKS.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
            <Icon.Chevron size={16} className="pointer-events-none absolute right-4 top-4 rotate-90 text-neutral-500" />
          </div>
        </Field>
        <Field label="Account holder name" hint="Must match the name on your ID.">
          <input className={inputCls} value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Account number" error={touched && account && !accOk ? 'Enter 7–16 digits, numbers only.' : ''}>
          <input
            className={inputCls}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 62012345678"
            value={account}
            onBlur={() => setTouched(true)}
            onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 16))}
          />
        </Field>
        <div>
          <span className="mb-1.5 block text-xs text-neutral-500">Account type</span>
          <Segmented value={type} onChange={setType} options={[{ value: 'cheque', label: 'Cheque / Current' }, { value: 'savings', label: 'Savings' }]} />
        </div>
        <Field label="Branch code" hint={branch ? 'Filled in automatically for your bank.' : 'Select a bank to see the branch code.'}>
          <input className={`${inputCls} text-neutral-500`} readOnly value={branch} placeholder="—" />
        </Field>
      </div>

      <div className="mt-5 rounded-2xl bg-surface p-4">
        <div className="text-[13px] font-semibold">When you’re paid</div>
        <ul className="mt-2 space-y-1.5 text-[12px] text-neutral-600">
          <li><b>Tier 1</b> · 30% within 24 hours of the shoot. <b>Tier 2</b> · 40%. <b>Tier 3</b> · 50%.</li>
          <li>The rest is paid after you upload all your edited photos and the client approves (or 48 hours pass).</li>
          <li>Our 5% fee and payment fees come off the booking total, shared across both payments.</li>
          <li>Every 5 completed bookings moves you up a tier.</li>
        </ul>
      </div>
      <div className="mt-4"><Checkbox checked={confirm} onChange={setConfirm}>I confirm this bank account is in my name, or my registered business’s name.</Checkbox></div>
    </Onb>
  )
}

/* ---------- 13. Step 5 — Verification ---------- */
function UploadRow({ icon, title, file, onFile, capture, action }) {
  const ref = useRef(null)
  return (
    <button onClick={() => ref.current.click()} className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white">{icon}</span>
      <div className="flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        <div className="text-[11.5px] text-neutral-500">{file ? `${file} · Uploaded` : action}</div>
      </div>
      {file ? <Icon.Check className="text-ok" /> : <Icon.Camera size={20} />}
      <input ref={ref} type="file" accept="image/*" capture={capture} hidden onChange={(e) => e.target.files[0] && onFile(e.target.files[0].name)} />
    </button>
  )
}
export function Verify() {
  const { jump, set } = useApp()
  const [doc, setDoc] = useState('id')
  const [front, setFront] = useState('sa-id-front.jpg')
  const [backImg, setBackImg] = useState('sa-id-back.jpg')
  const [selfie, setSelfie] = useState('')
  const selfieRef = useRef(null)
  const docsOk = doc === 'id' ? front && backImg : front
  const submit = () => { set({ verification: 'pending' }); jump('studio') }
  return (
    <Onb
      step={5}
      footer={
        <>
          <Button disabled={!docsOk} onClick={() => (selfie ? submit() : selfieRef.current.click())}>{selfie ? 'Submit for review' : 'Take selfie & submit'}</Button>
          <p className="mt-2 text-center text-[11px] text-neutral-500">Usually reviewed within 24 hours. You can go live once approved.</p>
          <input ref={selfieRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => e.target.files[0] && setSelfie(e.target.files[0].name)} />
        </>
      }
    >
      <H1 className="mt-5">Trust starts<br />with you.</H1>
      <p className="mt-1 text-[13px] text-neutral-500">Get verified. Give clients peace of mind.</p>
      <Notice icon={<Icon.Lock size={18} />} className="mt-4" title="Your identity. Protected.">Encrypted documents, never shown on your profile.</Notice>
      <div className="mt-5 text-xs text-neutral-500">Document type</div>
      <div className="mt-1.5"><Segmented value={doc} onChange={setDoc} options={[{ value: 'id', label: 'SA ID card' }, { value: 'passport', label: 'Passport' }]} /></div>
      <div className="mt-4 space-y-3">
        {doc === 'id' ? (
          <>
            <UploadRow icon={<Icon.IdCard />} title="Front of ID" file={front} onFile={setFront} action="Tap to upload" />
            <UploadRow icon={<Icon.IdCard />} title="Back of ID" file={backImg} onFile={setBackImg} action="Tap to upload" />
          </>
        ) : (
          <UploadRow icon={<Icon.IdCard />} title="Passport photo page" file={front} onFile={setFront} action="Tap to upload" />
        )}
        <UploadRow icon={<Icon.Camera />} title="Quick selfie check" file={selfie} onFile={setSelfie} capture="user" action="Match your face to your ID" />
      </div>
      <p className="mt-4 text-[12px] text-neutral-500">{selfie ? 'All set — submit when you’re ready.' : 'One last step: take your selfie to submit.'}</p>
    </Onb>
  )
}
