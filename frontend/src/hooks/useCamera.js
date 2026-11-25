import { useCallback, useEffect, useRef, useState } from 'react'

/** Webcam access: start/stop the stream and grab JPEG frames from it. */
export default function useCamera() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera. Use Chrome or Edge on localhost or HTTPS.')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setActive(true)
      return true
    } catch (e) {
      setError(
        e.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it from the camera icon in the address bar.'
          : 'No camera found, or another app is using it.'
      )
      return false
    }
  }, [])

  // attach the stream once the <video> element is on screen
  useEffect(() => {
    if (active && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current
  }, [active])

  useEffect(() => stop, [stop])

  /** Current frame as a JPEG Blob, scaled so the longest side is <= maxSide. */
  const capture = useCallback((maxSide = 1280, quality = 0.9) => new Promise((resolve) => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return resolve(null)
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  }), [])

  return { videoRef, active, error, start, stop, capture }
}
