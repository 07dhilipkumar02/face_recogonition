const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}/api${path}`, options)
  } catch {
    throw new Error('Cannot reach the backend. Is the Python server running on port 8000?')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = data.detail
    const msg = typeof d === 'string' ? d : Array.isArray(d) ? d[0]?.msg : `Request failed (${res.status})`
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return data
}

function form(fields, method = 'POST') {
  const fd = new FormData()
  Object.entries(fields).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((item) => fd.append(k, item))
    else if (v !== undefined && v !== null) fd.append(k, v)
  })
  return { method, body: fd }
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  return s.toString() ? `?${s}` : ''
}

export const api = {
  health: () => request('/health'),

  // face tools
  analyze: (image) => request('/analyze', form({ image })),
  verify: (image1, image2) => request('/verify', form({ image1, image2 })),
  recognize: (image, { mode = 'photo', attendance = false } = {}) =>
    request('/recognize', form({ image, mode, attendance: String(attendance) })),

  // people
  people: (q = '') => request(`/people${qs({ q })}`),
  person: (id) => request(`/people/${id}`),
  registerPerson: (name, images) => request('/people', form({ name, images })),
  bulkRegister: (images) => request('/people/bulk', form({ images })),
  renamePerson: (id, name) => request(`/people/${id}`, json('PATCH', { name })),
  addPhotos: (id, images) => request(`/people/${id}/photos`, form({ images })),
  deletePhoto: (id, sampleId) => request(`/people/${id}/photos/${sampleId}`, { method: 'DELETE' }),
  deletePerson: (id) => request(`/people/${id}`, { method: 'DELETE' }),

  // attendance
  attendance: (day) => request(`/attendance${qs({ day })}`),
  deleteAttendance: (id) => request(`/attendance/${id}`, { method: 'DELETE' }),
  attendanceExportUrl: (start, end) => `${BASE}/api/attendance/export${qs({ start, end })}`,

  // history + dashboard
  history: (kind, limit = 30) => request(`/history${qs({ kind, limit })}`),
  deleteHistory: (id) => request(`/history/${id}`, { method: 'DELETE' }),
  clearHistory: () => request('/history', { method: 'DELETE' }),
  stats: () => request('/stats'),
}

/** YYYY-MM-DD in the user's local time zone */
export const localDay = (d = new Date()) => d.toLocaleDateString('en-CA')

export const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return localDay(d)
}

export const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

export const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
