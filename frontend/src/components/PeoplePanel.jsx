import { useEffect, useState } from 'react'
import { api, formatDateTime } from '../api'
import MultiImageInput from './MultiImageInput'
import PersonModal from './PersonModal'

export default function PeoplePanel({ onChange }) {
  const [people, setPeople] = useState([])
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [listError, setListError] = useState('')

  const load = async (q = query) => {
    try {
      setPeople(await api.people(q))
      setListError('')
    } catch (e) {
      setListError(e.message)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(query), 200)
    return () => clearTimeout(t)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => { load(); onChange?.() }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>People</h2>
        <p className="muted">Add 3–5 photos per person for best accuracy.</p>
      </header>

      <div className="grid-2">
        <div className="stack">
          <RegisterForm onDone={changed} />
          <BulkRegister onDone={changed} />
        </div>

        <div>
          <div className="list-head">
            <h3 className="list-title">Registered ({people.length})</h3>
            <input
              className="search"
              type="search"
              placeholder="Search by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {listError && <p className="alert">{listError}</p>}
          {!people.length && !listError && (
            <p className="placeholder">{query ? 'No one matches that search.' : 'No one registered yet.'}</p>
          )}
          <div className="people-grid">
            {people.map((p) => (
              <button className="person-card" key={p.id} onClick={() => setOpenId(p.id)}>
                <img src={p.thumbnail} alt="" />
                <span className="person-name" title={p.name}>{p.name}</span>
                <span className="muted small">
                  {p.photo_count} photo{p.photo_count === 1 ? '' : 's'}
                  {p.photo_count < 3 && <span className="hint-dot" title="Add more photos for better accuracy"> · add more</span>}
                </span>
                <span className="muted tiny">Last seen {p.last_seen ? formatDateTime(p.last_seen) : 'never'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {openId && <PersonModal id={openId} onClose={() => setOpenId(null)} onChange={changed} />}
    </section>
  )
}

function Results({ results }) {
  const problems = results.filter((r) => !r.ok || r.warning)
  if (!problems.length) return null
  return (
    <ul className="result-list">
      {problems.map((r, i) => (
        <li key={i} className={r.ok ? 'warn' : 'bad'}>
          <strong>{r.file}</strong>: {r.ok ? r.warning : r.error}
        </li>
      ))}
    </ul>
  )
}

function RegisterForm({ onDone }) {
  const [name, setName] = useState('')
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [results, setResults] = useState([])

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess(''); setResults([])
    try {
      const res = await api.registerPerson(name, photos.map((p) => p.file))
      setSuccess(
        res.merged
          ? `Added ${res.added} photo${res.added === 1 ? '' : 's'} to ${res.person.name}.`
          : `${res.person.name} registered with ${res.added} photo${res.added === 1 ? '' : 's'}.`
      )
      setResults(res.results)
      photos.forEach((p) => URL.revokeObjectURL(p.url))
      setName(''); setPhotos([])
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3 className="list-title">Register a person</h3>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Abhi" maxLength={60} required />
      </label>
      <MultiImageInput value={photos} onChange={(v) => { setPhotos(v); setError('') }} />
      <button className="btn primary block" disabled={!name.trim() || !photos.length || loading}>
        {loading ? <span className="spinner" /> : `Register${photos.length ? ` with ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}`}
      </button>
      {error && <p className="alert">{error}</p>}
      {success && <p className="alert ok">{success}</p>}
      <Results results={results} />
    </form>
  )
}

function BulkRegister({ onDone }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)

  const upload = async (fileList) => {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    setLoading(true); setError(''); setSummary(null)
    try {
      const res = await api.bulkRegister(files)
      setSummary(res)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h3 className="list-title">Bulk register</h3>
      <p className="muted small">
        Name files like <code>Abhi_1.jpg</code>. Same name = same person.
      </p>
      <div className="row left">
        <label className={`btn ghost small ${loading ? 'disabled' : ''}`}>
          Choose photos
          <input type="file" accept="image/*" multiple hidden disabled={loading}
            onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
        </label>
        <label className={`btn ghost small ${loading ? 'disabled' : ''}`}>
          Choose a folder
          <input type="file" webkitdirectory="" multiple hidden disabled={loading}
            onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
        </label>
        {loading && <span className="muted small"><span className="spinner dark" /> Processing…</span>}
      </div>
      {error && <p className="alert">{error}</p>}
      {summary && (
        <>
          <p className="alert ok">
            {summary.people.length
              ? `Registered ${summary.people.map((p) => `${p.name} (${p.added})`).join(', ')}.`
              : 'No one could be registered from those photos.'}
          </p>
          <Results results={summary.results} />
        </>
      )}
    </div>
  )
}
