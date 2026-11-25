import { useCallback, useEffect, useState } from 'react'
import { addDays, api, formatTime, localDay } from '../api'

export default function AttendancePanel({ refreshKey, goToLive }) {
  const today = localDay()
  const [day, setDay] = useState(today)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [start, setStart] = useState(addDays(today, -29))
  const [end, setEnd] = useState(today)

  const load = useCallback(async () => {
    try {
      setData(await api.attendance(day))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [day])

  useEffect(() => { load() }, [load, refreshKey])

  const remove = async (record) => {
    if (!window.confirm(`Remove ${record.name}'s check-in for this day?`)) return
    try {
      await api.deleteAttendance(record.id)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const label = new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const rate = data?.total_people ? Math.round((data.present_count / data.total_people) * 100) : 0

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Attendance</h2>
        <p className="muted">
          Filled automatically by Live.{' '}
          <button className="link" onClick={goToLive}>Open camera →</button>
        </p>
      </header>

      <div className="day-bar">
        <button className="btn ghost small" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</button>
        <input type="date" className="search date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button className="btn ghost small" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} aria-label="Next day">›</button>
        {day !== today && <button className="btn ghost small" onClick={() => setDay(today)}>Today</button>}
        <span className="grow" />
        <button className="btn ghost small" onClick={load}>↻ Refresh</button>
      </div>

      {error && <p className="alert">{error}</p>}

      {data && (
        <>
          <div className="att-summary">
            <div>
              <div className="big-number">{data.present_count}<span className="muted"> / {data.total_people}</span></div>
              <div className="muted small">present on {label}</div>
            </div>
            <div className="meter wide" title={`${rate}% present`}>
              <div style={{ width: `${rate}%` }} />
            </div>
            <span className="stat-value">{rate}%</span>
          </div>

          <div className="grid-2">
            <div>
              <h3 className="list-title">Present ({data.present.length})</h3>
              {!data.present.length && <p className="placeholder">No one present.</p>}
              {data.present.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Name</th><th>First seen</th><th>Last seen</th><th>Seen</th><th aria-label="Actions" /></tr>
                    </thead>
                    <tbody>
                      {data.present.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <span className="name-cell">
                              {r.thumbnail ? <img src={r.thumbnail} alt="" className="avatar" /> : <span className="avatar empty" />}
                              {r.name}
                            </span>
                          </td>
                          <td>{formatTime(r.first_seen)}</td>
                          <td>{formatTime(r.last_seen)}</td>
                          <td>{r.seen_count}×</td>
                          <td><button className="icon-btn inline" onClick={() => remove(r)} aria-label={`Remove ${r.name}`}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="list-title">Absent ({data.absent.length})</h3>
              {!data.absent.length && (
                <p className="placeholder">{data.total_people ? 'Everyone was present.' : 'No one is registered yet.'}</p>
              )}
              <div className="chip-list">
                {data.absent.map((p) => (
                  <span className="chip" key={p.id}>
                    {p.thumbnail && <img src={p.thumbnail} alt="" />}
                    {p.name}
                  </span>
                ))}
              </div>

              <div className="card export">
                <h3 className="list-title">Export CSV</h3>
                <div className="row left">
                  <label className="field inline"><span>From</span>
                    <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
                  </label>
                  <label className="field inline"><span>To</span>
                    <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} />
                  </label>
                </div>
                <a className="btn primary block" href={api.attendanceExportUrl(start, end)} download>
                  ⬇ Download
                </a>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
