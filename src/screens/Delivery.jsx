import { useCallback, useEffect, useRef, useState } from 'react'
import * as market from '../lib/market.js'
import { explain } from '../lib/studio.js'
import { Button, Lightbox } from '../ui.jsx'

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
const CONCURRENCY = 2

/* ---------- Photographer: upload the edited photos, then deliver ---------- */
export function DeliveryPanel({ b, onChanged }) {
  const [need, setNeed] = useState(b.numPhotos || 0)
  const [photos, setPhotos] = useState(null)
  const [queue, setQueue] = useState([]) // { key, name, status: 'waiting' | 'uploading' | 'failed', error }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const input = useRef(null)

  const reload = useCallback(async () => {
    try {
      setPhotos(await market.listDeliveryPhotos(b.id))
    } catch (e) {
      setError(explain(e))
      setPhotos((v) => v || [])
    }
  }, [b.id])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { market.deliveryRequired(b.id, b.numPhotos || 0).then(setNeed) }, [b.id, b.numPhotos])

  const uploadAll = async (files) => {
    setError('')
    const items = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, name: file.name, status: 'waiting', error: '' }))
    const refused = items.map((it) => market.deliveryProblem(it.file)).filter(Boolean)
    if (refused.length) setError(refused.slice(0, 3).join(' ') + (refused.length > 3 ? ` (and ${refused.length - 3} more)` : ''))
    const todo = items.filter((it) => !market.deliveryProblem(it.file))
    setQueue((q) => [...q.filter((x) => x.status === 'failed'), ...todo.map(({ key, name, status, error: er }) => ({ key, name, status, error: er }))])
    const mark = (key, patch) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)))
    let next = 0
    const worker = async () => {
      while (next < todo.length) {
        const it = todo[next++]
        mark(it.key, { status: 'uploading' })
        try {
          await market.uploadDeliveryPhoto(b.id, it.file)
          setQueue((q) => q.filter((x) => x.key !== it.key))
          await reload()
        } catch (e) {
          mark(it.key, { status: 'failed', error: explain(e) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
  }

  const pick = (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (files.length) uploadAll(files)
  }
  const remove = async (id) => {
    setBusy(id)
    setError('')
    try {
      await market.removeDeliveryPhoto(id)
      await reload()
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy('')
    }
  }
  const deliver = async () => {
    setBusy('deliver')
    setError('')
    try {
      await market.deliverGallery(b.id)
      await onChanged()
    } catch (e) {
      setError(explain(e))
      setBusy('')
    }
  }

  const have = photos?.length || 0
  const uploading = queue.some((q) => q.status === 'uploading' || q.status === 'waiting')
  const pct = need ? Math.min(100, Math.round((have / need) * 100)) : 0
  return (
    <div className="mt-3 rounded-xl bg-white p-3.5" data-testid="delivery-panel">
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-semibold">Deliver the photos</div>
        <div className="text-[12.5px] text-neutral-600" data-testid="photo-count">{have} of {need} uploaded</div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={have} aria-valuemin={0} aria-valuemax={need}>
        <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-neutral-600">
        Upload your edited, full-size photos (JPG, PNG or WebP, up to 50 MB each). Your client sees previews first; full-size downloads unlock when they approve.
      </p>

      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={pick} className="sr-only" aria-label="Choose photos to upload" data-testid="photo-input" />
      <div className="mt-3 space-y-2">
        <Button variant="soft" arrow={false} disabled={Boolean(busy)} onClick={() => input.current?.click()}>{uploading ? 'Uploading…' : have ? 'Add more photos' : 'Choose photos'}</Button>
        <Button disabled={have < need || uploading || Boolean(busy)} onClick={deliver}>{busy === 'deliver' ? 'Delivering…' : have < need ? `${need - have} more to go` : 'Deliver photos to client'}</Button>
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px]" aria-label="Uploads in progress">
          {queue.map((q) => (
            <li key={q.key} className={`flex justify-between gap-2 ${q.status === 'failed' ? 'text-rose-700' : 'text-neutral-600'}`}>
              <span className="truncate">{q.name}</span>
              <span className="shrink-0">{q.status === 'failed' ? q.error : q.status === 'uploading' ? 'Uploading…' : 'Waiting'}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-[12.5px] text-rose-700">{error}</p>}

      {have > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-link">Uploaded photos ({have})</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[12px]">
            {photos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.file_name} <span className="text-neutral-400">· {mb(p.size_bytes || 0)}</span></span>
                <button disabled={busy === p.id} onClick={() => remove(p.id)} aria-label={`Remove ${p.file_name}`} className="shrink-0 font-semibold text-rose-700 disabled:opacity-50">{busy === p.id ? '…' : 'Remove'}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/* ---------- Client: look at the photos, download them once approved ---------- */
export function GalleryPanel({ b }) {
  const [photos, setPhotos] = useState(null)
  const [thumbs, setThumbs] = useState({}) // id -> object url
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const urls = useRef([])
  const canDownload = b.status === 'completed'
  const expired = b.gallery_purged_at || (b.gallery_expires_at && new Date(b.gallery_expires_at) <= new Date())

  useEffect(() => {
    if (expired) return undefined
    let off = false
    market.listDeliveryPhotos(b.id)
      .then(async (list) => {
        if (off) return
        setPhotos(list)
        for (const p of list) {
          if (off) return
          try {
            const url = await market.photoObjectUrl(p.id, 'preview')
            if (off) { URL.revokeObjectURL(url); return }
            urls.current.push(url)
            setThumbs((t) => ({ ...t, [p.id]: url }))
          } catch (e) {
            if (!off) setError(explain(e))
            return
          }
        }
      })
      .catch((e) => { if (!off) { setError(explain(e)); setPhotos([]) } })
    return () => { off = true; urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = [] }
  }, [b.id, expired])

  const save = async (p) => {
    setBusy(p.id)
    setError('')
    try {
      await market.downloadPhoto(p.id, p.file_name || 'photo.jpg')
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy('')
    }
  }
  const saveAll = async () => {
    setBusy('all')
    setError('')
    try {
      for (const p of photos) await market.downloadPhoto(p.id, p.file_name || 'photo.jpg')
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy('')
    }
  }

  if (expired) {
    return <p className="mt-3 rounded-xl bg-white p-3 text-[12.5px] text-neutral-600">The download period has ended and the photos were deleted. Ask your photographer if you need a copy.</p>
  }
  if (photos && photos.length === 0 && !error) {
    return b.simulated ? <p className="mt-3 rounded-xl bg-white p-3 text-[12.5px] text-neutral-600">This was a test delivery, so there are no photos to see.</p> : null
  }
  const ready = photos?.filter((p) => thumbs[p.id]) || []
  const viewer = ready.map((p) => ({ src: thumbs[p.id], full: thumbs[p.id] }))
  return (
    <div className="mt-3 rounded-xl bg-white p-3.5" data-testid="gallery">
      <div className="flex items-baseline justify-between">
        <div className="text-[14px] font-semibold">Your photos{photos ? ` (${photos.length})` : ''}</div>
        {b.gallery_expires_at && <div className="text-[11.5px] text-neutral-500">Download until {dateLabel(b.gallery_expires_at)}</div>}
      </div>
      <p className="mt-1 text-[12px] text-neutral-600">
        {canDownload
          ? 'Your photos are unlocked. Save them to your phone or computer before the date above, then they are deleted. For long-term copies, ask your photographer for a Google Drive link.'
          : 'These are previews. Approve the photos to unlock full-size downloads.'}
      </p>
      {photos === null && <p className="mt-3 text-[12.5px] text-neutral-500">Loading photos…</p>}
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {(photos || []).map((p) => {
          const idx = ready.findIndex((r) => r.id === p.id)
          return (
            <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-surface">
              {thumbs[p.id] && (
                <button onClick={() => setOpen(idx)} aria-label={`Open ${p.file_name || 'photo'}`} className="block h-full w-full">
                  <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" />
                </button>
              )}
              {canDownload && (
                <button disabled={busy === p.id} onClick={() => save(p)} aria-label={`Save ${p.file_name || 'photo'}`} className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10.5px] font-semibold text-white disabled:opacity-50">{busy === p.id ? '…' : 'Save'}</button>
              )}
            </div>
          )
        })}
      </div>
      {canDownload && photos?.length > 0 && (
        <div className="mt-3"><Button variant="soft" arrow={false} disabled={Boolean(busy)} onClick={saveAll}>{busy === 'all' ? 'Saving…' : `Save all ${photos.length} photos`}</Button></div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-[12.5px] text-rose-700">{error}</p>}
      {open != null && viewer.length > 0 && <Lightbox photos={viewer} index={Math.min(open, viewer.length - 1)} onClose={() => setOpen(null)} onIndex={setOpen} />}
    </div>
  )
}
