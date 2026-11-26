import { useState } from 'react'
import { api } from '../api'
import ImageInput from './ImageInput'
import { usePopup } from './Popup'
import FaceOverlay from './FaceOverlay'

export default function VerifyPanel() {
  const [img1, setImg1] = useState(null)
  const [img2, setImg2] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const popup = usePopup()

  const reset = (setter) => (v) => { setter(v); setResult(null) }

  const run = async () => {
    setLoading(true)
    try {
      setResult(await api.verify(img1.file, img2.file))
    } catch (e) {
      popup.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const box = (info) => (info ? [{ region: info.region }] : [])

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Face Verification</h2>
        <p className="muted">Are two photos the same person?</p>
      </header>

      <div className="grid-2">
        <ImageInput value={img1} onChange={reset(setImg1)} label="First photo">
          {img1 && <FaceOverlay src={img1.url} size={result?.image1} boxes={box(result?.image1)} />}
        </ImageInput>
        <ImageInput value={img2} onChange={reset(setImg2)} label="Second photo">
          {img2 && <FaceOverlay src={img2.url} size={result?.image2} boxes={box(result?.image2)} />}
        </ImageInput>
      </div>

      <button className="btn primary block" disabled={!img1 || !img2 || loading} onClick={run}>
        {loading ? <span className="spinner" /> : 'Compare faces'}
      </button>

      {result && (
        <div className={`verdict ${result.verified ? 'ok' : 'bad'}`}>
          <div className="verdict-title">
            {result.verified ? '✔ Same person' : '✘ Different people'}
          </div>
          <div className="meter"><div style={{ width: `${result.similarity * 100}%` }} /></div>
          <p className="muted small">
            Similarity {(result.similarity * 100).toFixed(1)}%
          </p>
        </div>
      )}
    </section>
  )
}
