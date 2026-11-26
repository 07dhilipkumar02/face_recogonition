import { useCallback, useEffect, useState } from 'react'
import { api, formatDateTime } from '../api'
import { BarList, ColumnChart } from './Charts'
import { usePopup } from './Popup'

const KIND_LABEL = { analyze: 'Analysis', recognize: 'Recognition', verify: 'Verification' }

const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' })

function summary(item) {
  const d = item.data || {}
  if (item.kind === 'analyze') {
    if (!d.faces?.length) return 'No faces found'
    return d.faces.map((f) => `${f.gender === 'Man' ? 'M' : 'F'} ${f.age}, ${f.emotion}`).join(' · ')
  }
  if (item.kind === 'recognize') return d.names?.length ? d.names.join(', ') : 'No faces found'
  if (item.kind === 'verify') {
    return d.verified ? `Same person (${Math.round(d.similarity * 100)}%)` : 'Different people'
  }
  return ''
}

export default function DashboardPanel({ refreshKey }) {
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState([])
  const [kind, setKind] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const popup = usePopup()

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.stats(), api.history(kind || undefined, 30)])
      setStats(s); setHistory(h); setLoadFailed(false)
    } catch (e) {
      setLoadFailed(true)
      popup.error(e.message)
    }
  }, [kind, popup])

  useEffect(() => { load() }, [load, refreshKey])

  const removeItem = async (id) => {
    try { await api.deleteHistory(id); load() } catch (e) { popup.error(e.message) }
  }

  const clearAll = async () => {
    const ok = await popup.confirm({ title: 'Clear all history?', message: 'Dashboard charts based on history will reset. This cannot be undone.', confirmText: 'Clear history', danger: true })
    if (!ok) return
    try { await api.clearHistory(); popup.success('History cleared.'); load() } catch (e) { popup.error(e.message) }
  }

  if (!stats) {
    return (
      <section className="panel">
        <p className="placeholder">
          {loadFailed ? <>Couldn't load the dashboard. <button className="link" onClick={load}>Try again</button></> : 'Loading dashboard…'}
        </p>
      </section>
    )
  }

  const t = stats.totals
  const tiles = [
    ['People', t.people],
    ['Face photos', t.photos],
    ['Present today', t.present_today],
    ['Faces analysed', t.faces_analyzed],
    ['Recognitions', t.recognitions],
    ['Verifications', t.verifications],
  ]
  const emotions = Object.entries(stats.emotions).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  const genders = [
    { label: 'Male', value: stats.gender.Man || 0 },
    { label: 'Female', value: stats.gender.Woman || 0 },
  ]
  const ages = Object.entries(stats.age_groups).map(([label, value]) => ({ label, value, tip: `${label}: ${value}` }))
  const attendance = stats.attendance_7d.map((d) => ({
    label: dayLabel(d.day), value: d.present, tip: `${d.present} present`,
  }))
  const activity = stats.activity_7d.map((d) => {
    const total = d.analyze + d.recognize + d.verify
    return { label: dayLabel(d.day), value: total, tip: `${total} (${d.analyze} analyse · ${d.recognize} recognise · ${d.verify} verify)` }
  })
  const hasFaces = t.faces_analyzed > 0

  return (
    <section className="panel">
      <header className="panel-head row-between">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">Usage and attendance overview.</p>
        </div>
        <button className="btn ghost small" onClick={load}>↻ Refresh</button>
      </header>

      <div className="tiles">
        {tiles.map(([label, value]) => (
          <div className="tile" key={label}>
            <span className="tile-value">{value}</span>
            <span className="tile-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="chart-grid">
        <div className="card">
          <h3 className="list-title">Attendance · last 7 days</h3>
          <ColumnChart data={attendance} />
        </div>
        <div className="card">
          <h3 className="list-title">Activity · last 7 days</h3>
          <ColumnChart data={activity} />
        </div>
        <div className="card">
          <h3 className="list-title">Emotions detected</h3>
          {hasFaces ? <BarList data={emotions} /> : <p className="muted small">No data yet.</p>}
        </div>
        <div className="card">
          <h3 className="list-title">Age groups</h3>
          {hasFaces ? <ColumnChart data={ages} height={120} /> : <p className="muted small">No data yet.</p>}
          <h3 className="list-title spaced-top">Gender</h3>
          {hasFaces ? <BarList data={genders} /> : <p className="muted small">No data yet.</p>}
        </div>
      </div>

      <div className="list-head">
        <h3 className="list-title">Recent activity</h3>
        <div className="row">
          <select className="search" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter history">
            <option value="">All</option>
            <option value="analyze">Analysis</option>
            <option value="recognize">Recognition</option>
            <option value="verify">Verification</option>
          </select>
          {history.length > 0 && <button className="btn ghost small" onClick={clearAll}>Clear all</button>}
        </div>
      </div>
      {!history.length && <p className="placeholder">No activity yet.</p>}
      <ul className="history-list">
        {history.map((item) => (
          <li className="history-item" key={item.id}>
            <img src={item.thumbnail} alt="" />
            <div className="grow">
              <div className="row left">
                <span className={`pill kind-${item.kind}`}>{KIND_LABEL[item.kind] || item.kind}</span>
                <span className="muted small">{formatDateTime(item.created_at)}</span>
              </div>
              <p className="history-text">{summary(item)}</p>
            </div>
            <button className="icon-btn inline" onClick={() => removeItem(item.id)} aria-label="Delete entry">✕</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
