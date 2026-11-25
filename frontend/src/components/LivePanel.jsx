import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import useCamera from '../hooks/useCamera'
import { BoxLayer } from './FaceOverlay'

const FRAME_GAP_MS = 600 // pause between frames so the CPU isn't pinned

export default function LivePanel({ peopleCount, goToPeople, onAttendance }) {
  const cam = useCamera()
  const [running, setRunning] = useState(false)
  const [attendance, setAttendance] = useState(true)
  const [result, setResult] = useState(null)
  const [latency, setLatency] = useState(null)
  const [error, setError] = useState('')
  const [log, setLog] = useState([])
  const attendanceRef = useRef(attendance)
  attendanceRef.current = attendance

  // recognition loop: one frame in flight at a time
  useEffect(() => {
    if (!running || !cam.active) return
    let cancelled = false
    let timer

    const tick = async () => {
      const started = performance.now()
      try {
        const blob = await cam.capture(640, 0.8)
        if (blob && !cancelled) {
          const frame = new File([blob], 'frame.jpg', { type: 'image/jpeg' })
          const res = await api.recognize(frame, { mode: 'live', attendance: attendanceRef.current })
          if (cancelled) return
          setResult(res)
          setLatency(Math.round(performance.now() - started))
          setError('')
          if (res.attendance_marked.length) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            setLog((l) => [...res.attendance_marked.map((name) => ({ name, time })), ...l].slice(0, 30))
            onAttendance?.()
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
      if (!cancelled) timer = setTimeout(tick, FRAME_GAP_MS)
    }

    timer = setTimeout(tick, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [running, cam.active, cam.capture, onAttendance])

  const start = async () => {
    setError('')
    if (await cam.start()) setRunning(true)
  }

  const stop = () => {
    setRunning(false)
    cam.stop()
    setResult(null)
    setLatency(null)
  }

  const boxes = result?.faces.map((f) => ({
    region: f.region,
    label: f.matched ? `${f.name} · ${Math.round(f.confidence * 100)}%` : 'Unknown',
    color: f.matched ? 'var(--accent)' : 'var(--danger)',
  }))

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Live Recognition</h2>
        <p className="muted">Real-time recognition and auto check-in.</p>
      </header>

      {peopleCount === 0 && (
        <div className="notice">
          No one registered yet.{' '}
          <button className="link" onClick={goToPeople}>Add people →</button>
        </div>
      )}

      <div className="live-grid">
        <div>
          <div className="live-stage">
            {cam.active ? (
              <div className="mirror-wrap">
                <video ref={cam.videoRef} autoPlay playsInline muted className="live-video" />
                <BoxLayer size={result?.image} boxes={boxes} />
              </div>
            ) : (
              <div className="live-placeholder">
                <div className="drop-icon">📷</div>
                <p className="drop-title">Camera is off</p>
              </div>
            )}
            {running && <span className="live-badge"><span className="rec-dot" /> LIVE</span>}
          </div>

          <div className="live-controls">
            {running ? (
              <button className="btn danger" onClick={stop}>■ Stop camera</button>
            ) : (
              <button className="btn primary" onClick={start}>▶ Start camera</button>
            )}
            <label className="toggle">
              <input type="checkbox" checked={attendance} onChange={(e) => setAttendance(e.target.checked)} />
              <span className="toggle-track"><span /></span>
              Mark attendance
            </label>
            {latency != null && (
              <span className="muted small live-meta">
                {result?.count ?? 0} face{result?.count === 1 ? '' : 's'} · {latency} ms/frame
              </span>
            )}
          </div>
          {(cam.error || error) && <p className="alert">{cam.error || error}</p>}
        </div>

        <aside className="live-side">
          <div className="card">
            <h3 className="list-title">In view</h3>
            {!result?.faces.length && <p className="muted small">{running ? 'Searching…' : 'Not started'}</p>}
            <ul className="plain-list">
              {result?.faces.map((f, i) => (
                <li key={i} className="list-row">
                  <span className={`dot ${f.matched ? 'ok' : 'bad'}`} />
                  <span className="grow">{f.name}</span>
                  {f.matched && <span className="muted small">{Math.round(f.confidence * 100)}%</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h3 className="list-title">Checked in</h3>
            {!log.length && (
              <p className="muted small">
                {attendance ? 'No check-ins yet.' : 'Attendance off.'}
              </p>
            )}
            <ul className="plain-list">
              {log.map((entry, i) => (
                <li key={i} className="list-row">
                  <span className="pill ok">✔</span>
                  <span className="grow">{entry.name}</span>
                  <span className="muted small">{entry.time}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  )
}
