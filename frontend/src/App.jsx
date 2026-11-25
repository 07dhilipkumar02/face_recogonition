import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import LivePanel from './components/LivePanel'
import AnalyzePanel from './components/AnalyzePanel'
import RecognizePanel from './components/RecognizePanel'
import VerifyPanel from './components/VerifyPanel'
import PeoplePanel from './components/PeoplePanel'
import AttendancePanel from './components/AttendancePanel'
import DashboardPanel from './components/DashboardPanel'

const TABS = [
  { id: 'live', label: 'Live', icon: '🎥' },
  { id: 'recognize', label: 'Recognise', icon: '🧑' },
  { id: 'analyze', label: 'Analyse', icon: '🔍' },
  { id: 'verify', label: 'Verify', icon: '⚖' },
  { id: 'people', label: 'People', icon: '🗂' },
  { id: 'attendance', label: 'Attendance', icon: '✅' },
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
]

const initialTab = () => {
  const hash = window.location.hash.slice(1)
  return TABS.some((t) => t.id === hash) ? hash : 'analyze'
}

export default function App() {
  const [tab, setTab] = useState(initialTab)
  const [health, setHealth] = useState(null)
  const [online, setOnline] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setHealth(await api.health())
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // keep the tab in sync with the URL (#live, #people…) and the Back button
  useEffect(() => {
    const onHash = () => setTab(initialTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id) => {
    setTab(id)
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`)
  }

  // something changed people or attendance: refresh counts and dependent tabs
  const changed = useCallback(() => {
    refresh()
    setRefreshKey((k) => k + 1)
  }, [refresh])

  const peopleCount = health?.people ?? 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">◎</div>
          <div>
            <h1>Face Recognition &amp; DeepFace System</h1>
            <p className="muted small">Python · OpenCV · DeepFace · React</p>
          </div>
        </div>
        <div className={`status ${online === false ? 'off' : online ? 'on' : ''}`}>
          <span className="dot" />
          {online === null && 'Connecting…'}
          {online === true && 'API online'}
          {online === false && (
            <>
              API offline <button className="link" onClick={refresh}>retry</button>
            </>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
            {t.id === 'people' && <span className="count">{peopleCount}</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'live' && <LivePanel peopleCount={peopleCount} goToPeople={() => go('people')} onAttendance={changed} />}
        {tab === 'recognize' && <RecognizePanel peopleCount={peopleCount} goToPeople={() => go('people')} onAttendance={changed} />}
        {tab === 'analyze' && <AnalyzePanel />}
        {tab === 'verify' && <VerifyPanel />}
        {tab === 'people' && <PeoplePanel onChange={changed} />}
        {tab === 'attendance' && <AttendancePanel refreshKey={refreshKey} goToLive={() => go('live')} />}
        {tab === 'dashboard' && <DashboardPanel refreshKey={refreshKey} />}
      </main>

      <footer className="footer muted small">
        Photos aren't stored. Register people only with their consent.
      </footer>
    </div>
  )
}
