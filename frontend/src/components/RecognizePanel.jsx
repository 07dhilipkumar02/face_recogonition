import { useState } from 'react'
import { api } from '../api'
import ImageInput from './ImageInput'
import FaceOverlay from './FaceOverlay'

export default function RecognizePanel({ peopleCount, goToPeople, onAttendance }) {
  const [image, setImage] = useState(null)
  const [markAttendance, setMarkAttendance] = useState(false)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const change = (img) => { setImage(img); setResult(null); setError('') }

  const run = async () => {
    setLoading(true); setError('')
    try {
      const res = await api.recognize(image.file, { attendance: markAttendance })
      setResult(res)
      if (res.attendance_marked.length) onAttendance?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const boxes = result?.faces.map((f) => ({
    region: f.region,
    label: f.name,
    color: f.matched ? 'var(--accent)' : 'var(--danger)',
  }))

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Face Recognition</h2>
        <p className="muted">Identify people in any photo.</p>
      </header>

      {peopleCount === 0 && (
        <div className="notice">
          No one registered yet.{' '}
          <button className="link" onClick={goToPeople}>Add people →</button>
        </div>
      )}

      <div className="grid-2">
        <div>
          <ImageInput value={image} onChange={change} label="Upload a photo to recognise">
            {image && <FaceOverlay src={image.url} size={result?.image} boxes={boxes} />}
          </ImageInput>
          <label className="toggle spaced">
            <input type="checkbox" checked={markAttendance} onChange={(e) => setMarkAttendance(e.target.checked)} />
            <span className="toggle-track"><span /></span>
            Mark attendance
          </label>
          <button className="btn primary block" disabled={!image || loading} onClick={run}>
            {loading ? <span className="spinner" /> : 'Recognise faces'}
          </button>
          {error && <p className="alert">{error}</p>}
        </div>

        <div className="results">
          {!result && !loading && <p className="placeholder">Matches will appear here.</p>}
          {loading && <p className="placeholder">Recognising…</p>}
          {result && result.count === 0 && <p className="placeholder">No faces detected.</p>}
          {result?.attendance_marked.length > 0 && (
            <p className="alert ok">Checked in: {result.attendance_marked.join(', ')}</p>
          )}
          {result?.faces.map((f, i) => (
            <div className={`card match ${f.matched ? 'ok' : 'bad'}`} key={i}>
              <div className="card-title">
                <span>{f.name}</span>
                <span className={`pill ${f.matched ? 'ok' : 'bad'}`}>
                  {f.matched ? `${Math.round(f.confidence * 100)}% match` : 'No match'}
                </span>
              </div>
              {f.distance != null && (
                <p className="muted small">Distance {f.distance.toFixed(3)}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
