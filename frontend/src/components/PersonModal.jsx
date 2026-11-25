import { useEffect, useState } from 'react'
import { api, formatDateTime, formatTime } from '../api'
import MultiImageInput from './MultiImageInput'

export default function PersonModal({ id, onClose, onChange }) {
  const [person, setPerson] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState([])

  const load = async () => {
    try {
      const p = await api.person(id)
      setPerson(p); setName(p.name)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = async (fn) => {
    setBusy(true); setError('')
    try {
      await fn()
      await load()
      onChange()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const rename = (e) => {
    e.preventDefault()
    act(async () => { await api.renamePerson(id, name); setEditing(false) })
  }

  const upload = () => act(async () => {
    const res = await api.addPhotos(id, photos.map((p) => p.file))
    photos.forEach((p) => URL.revokeObjectURL(p.url))
    setPhotos([])
    setNotes(res.results.filter((r) => !r.ok || r.warning).map((r) => `${r.file}: ${r.ok ? r.warning : r.error}`))
    if (!res.added) throw new Error('None of those photos could be used.')
  })

  const removePhoto = (sid) => act(() => api.deletePhoto(id, sid))

  const removePerson = async () => {
    if (!window.confirm(`Delete ${person.name} and all their photos? Their past attendance records are kept.`)) return
    setBusy(true)
    try {
      await api.deletePerson(id)
      onChange(); onClose()
    } catch (e) {
      setError(e.message); setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={person?.name || 'Person'}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {!person && !error && <p className="placeholder">Loading…</p>}
        {error && <p className="alert">{error}</p>}

        {person && (
          <>
            <div className="modal-head">
              <img src={person.thumbnail} alt="" className="avatar-lg" />
              <div className="grow">
                {editing ? (
                  <form className="row left" onSubmit={rename}>
                    <input className="search" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
                    <button className="btn primary small" disabled={busy || !name.trim()}>Save</button>
                    <button type="button" className="btn ghost small" onClick={() => { setEditing(false); setName(person.name) }}>Cancel</button>
                  </form>
                ) : (
                  <h2 className="modal-title">
                    {person.name}{' '}
                    <button className="link small" onClick={() => setEditing(true)}>rename</button>
                  </h2>
                )}
                <p className="muted small">
                  {person.photo_count} photo{person.photo_count === 1 ? '' : 's'} · registered {formatDateTime(person.created_at)} ·
                  last seen {person.last_seen ? formatDateTime(person.last_seen) : 'never'}
                </p>
              </div>
            </div>

            <h3 className="list-title">Photos</h3>
            <div className="sample-grid">
              {person.samples.map((s) => (
                <div className="thumb" key={s.id}>
                  <img src={s.thumbnail} alt="" />
                  {person.samples.length > 1 && (
                    <button className="icon-btn" disabled={busy} onClick={() => removePhoto(s.id)} aria-label="Delete photo">✕</button>
                  )}
                </div>
              ))}
            </div>

            <h3 className="list-title">Add more photos</h3>
            <MultiImageInput value={photos} onChange={setPhotos} max={10} label="Add photos of this person" />
            {photos.length > 0 && (
              <button className="btn primary block" disabled={busy} onClick={upload}>
                {busy ? <span className="spinner" /> : `Upload ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
              </button>
            )}
            {notes.length > 0 && <ul className="result-list">{notes.map((n, i) => <li key={i} className="warn">{n}</li>)}</ul>}

            <h3 className="list-title">Recent attendance</h3>
            {!person.attendance.length && <p className="muted small">Never checked in.</p>}
            <ul className="plain-list">
              {person.attendance.map((a) => (
                <li className="list-row" key={a.day}>
                  <span className="grow">{new Date(`${a.day}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="muted small">{formatTime(a.first_seen)} – {formatTime(a.last_seen)}</span>
                </li>
              ))}
            </ul>

            <div className="modal-foot">
              <button className="btn danger" disabled={busy} onClick={removePerson}>Delete person</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
