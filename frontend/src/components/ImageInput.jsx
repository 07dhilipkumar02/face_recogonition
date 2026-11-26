import { useEffect, useRef, useState } from 'react'
import { usePopup } from './Popup'

/**
 * Pick an image by upload, drag-and-drop, or webcam snapshot.
 * Calls onChange({ file, url }) or onChange(null) when cleared.
 */
export default function ImageInput({ value, onChange, label = 'Upload a photo', children }) {
  const fileRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [camera, setCamera] = useState(false)
  const popup = usePopup()

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamera(false)
  }

  useEffect(() => stopCamera, [])

  const setFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    if (value?.url) URL.revokeObjectURL(value.url)
    onChange({ file, url: URL.createObjectURL(file) })
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      setCamera(true)
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      })
    } catch {
      popup.error('Camera not available or permission denied.')
    }
  }

  const snap = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      setFile(new File([blob], 'webcam.jpg', { type: 'image/jpeg' }))
      stopCamera()
    }, 'image/jpeg', 0.92)
  }

  const clear = () => {
    if (value?.url) URL.revokeObjectURL(value.url)
    onChange(null)
  }

  if (camera) {
    return (
      <div className="dropzone camera">
        <video ref={videoRef} autoPlay playsInline muted className="video" />
        <div className="row">
          <button className="btn primary" onClick={snap}>Capture</button>
          <button className="btn ghost" onClick={stopCamera}>Cancel</button>
        </div>
      </div>
    )
  }

  if (value) {
    return (
      <div className="preview">
        {children ?? <img src={value.url} alt="Selected" className="preview-img" />}
        <button className="btn ghost small" onClick={clear}>Change photo</button>
      </div>
    )
  }

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); setFile(e.dataTransfer.files[0]) }}
      onClick={() => fileRef.current?.click()}
    >
      <div className="drop-icon">⬆</div>
      <p className="drop-title">{label}</p>
      <p className="muted">Drag & drop or click</p>
      <button
        className="btn ghost small"
        onClick={(e) => { e.stopPropagation(); startCamera() }}
      >
        📷 Use webcam
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { setFile(e.target.files[0]); e.target.value = '' }}
      />
    </div>
  )
}
