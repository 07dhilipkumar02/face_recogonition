import { useEffect, useRef, useState } from 'react'
import useCamera from '../hooks/useCamera'
import { usePopup } from './Popup'

let nextId = 0

/**
 * Pick several photos (upload, drag-and-drop or webcam snapshots).
 * value: [{ id, file, url }]   onChange(newList)
 */
export default function MultiImageInput({ value, onChange, max = 20, label = 'Add photos' }) {
  const fileRef = useRef(null)
  const cam = useCamera()
  const [dragging, setDragging] = useState(false)
  const popup = usePopup()

  useEffect(() => { if (cam.error) popup.error(cam.error) }, [cam.error, popup])

  const add = (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'))
    const room = Math.max(0, max - value.length)
    const items = imgs.slice(0, room).map((file) => ({ id: ++nextId, file, url: URL.createObjectURL(file) }))
    if (items.length) onChange([...value, ...items])
  }

  const remove = (id) => {
    const item = value.find((v) => v.id === id)
    if (item) URL.revokeObjectURL(item.url)
    onChange(value.filter((v) => v.id !== id))
  }

  const snap = async () => {
    const blob = await cam.capture(1280, 0.92)
    if (blob) add([new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' })])
  }

  return (
    <div className="multi-input">
      {cam.active ? (
        <div className="dropzone camera">
          <video ref={cam.videoRef} autoPlay playsInline muted className="video mirror" />
          <p className="muted small">Vary the angle between shots.</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={snap} disabled={value.length >= max}>
              Capture ({value.length})
            </button>
            <button type="button" className="btn ghost" onClick={cam.stop}>Done</button>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone compact ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}
        >
          <div className="drop-icon">⬆</div>
          <p className="drop-title">{label}</p>
          <p className="muted small">One person per photo · max {max}</p>
          <button type="button" className="btn ghost small" onClick={(e) => { e.stopPropagation(); cam.start() }}>
            📷 Use webcam
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => { add(e.target.files); e.target.value = '' }}
          />
        </div>
      )}

      {value.length > 0 && (
        <div className="thumb-strip">
          {value.map((v) => (
            <div className="thumb" key={v.id}>
              <img src={v.url} alt="" />
              <button type="button" className="icon-btn" onClick={() => remove(v.id)} aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
