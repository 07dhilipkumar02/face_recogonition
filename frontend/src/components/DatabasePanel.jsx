import { useState } from 'react'
import { api } from '../api'
import ImageInput from './ImageInput'

export default function DatabasePanel({ faces, refresh }) {
  const [name, setName] = useState('')
  const [image, setImage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    try {
      const rec = await api.registerFace(name, image.file)
      setSuccess(`${rec.name} registered.`)
      setName(''); setImage(null)
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const remove = async (face) => {
    if (!window.confirm(`Remove ${face.name} from the database?`)) return
    try {
      await api.deleteFace(face.id)
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Face Database</h2>
        <p className="muted">Register people so the system can recognise them. Add 2–3 photos per person for better accuracy.</p>
      </header>

      <div className="grid-2">
        <form onSubmit={submit}>
          <label className="field">
            <span>Person's name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Abhi"
              maxLength={60}
              required
            />
          </label>
          <ImageInput value={image} onChange={(v) => { setImage(v); setError('') }} label="Clear, front-facing photo (one person)" />
          <button className="btn primary block" disabled={!name.trim() || !image || loading}>
            {loading ? <span className="spinner" /> : 'Register face'}
          </button>
          {error && <p className="alert">{error}</p>}
          {success && <p className="alert ok">{success}</p>}
        </form>

        <div>
          <h3 className="list-title">Registered ({faces.length})</h3>
          {faces.length === 0 && <p className="placeholder">No faces registered yet.</p>}
          <div className="face-grid">
            {faces.map((f) => (
              <div className="face-tile" key={f.id}>
                <img src={f.thumbnail} alt={f.name} />
                <span title={f.name}>{f.name}</span>
                <button className="icon-btn" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
