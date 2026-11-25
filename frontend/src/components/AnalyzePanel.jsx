import { useState } from 'react'
import { api } from '../api'
import ImageInput from './ImageInput'
import FaceOverlay from './FaceOverlay'

const EMOJI = {
  happy: '😄', sad: '😢', angry: '😠', surprise: '😲',
  fear: '😨', disgust: '🤢', neutral: '😐',
}

export default function AnalyzePanel() {
  const [image, setImage] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const change = (img) => { setImage(img); setResult(null); setError('') }

  const run = async () => {
    setLoading(true); setError('')
    try {
      setResult(await api.analyze(image.file))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const boxes = result?.faces.map((f, i) => ({
    region: f.region,
    label: `#${i + 1} · ${f.gender === 'Man' ? 'M' : 'F'} · ${f.age}`,
  }))

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Face Analysis</h2>
        <p className="muted">Age, gender and emotion for every face.</p>
      </header>

      <div className="grid-2">
        <div>
          <ImageInput value={image} onChange={change} label="Upload a photo to analyse">
            {image && <FaceOverlay src={image.url} size={result?.image} boxes={boxes} />}
          </ImageInput>
          <button className="btn primary block" disabled={!image || loading} onClick={run}>
            {loading ? <span className="spinner" /> : 'Analyse faces'}
          </button>
          {error && <p className="alert">{error}</p>}
        </div>

        <div className="results">
          {!result && !loading && <p className="placeholder">Results will appear here.</p>}
          {loading && <p className="placeholder">Analysing… (first run takes a minute)</p>}
          {result && result.count === 0 && <p className="placeholder">No faces detected.</p>}
          {result?.faces.map((f, i) => (
            <div className="card" key={i}>
              <div className="card-title">
                <span>Face #{i + 1}</span>
                <span className="emoji">{EMOJI[f.emotion] || '🙂'}</span>
              </div>
              <div className="stats">
                <Stat label="Age" value={f.age} />
                <Stat label="Gender" value={f.gender === 'Man' ? 'Male' : 'Female'} />
                <Stat label="Emotion" value={f.emotion} />
              </div>
              <div className="bars">
                {Object.entries(f.emotion_scores)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div className="bar-row" key={k}>
                      <span className="bar-label">{k}</span>
                      <div className="bar"><div style={{ width: `${v}%` }} /></div>
                      <span className="bar-val">{v.toFixed(1)}%</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}
