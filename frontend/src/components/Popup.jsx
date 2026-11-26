import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * App-wide popups:
 *   const popup = usePopup()
 *   popup.success('Saved')            // toast, top-right, closes by itself
 *   popup.error('Something failed')
 *   popup.info('FYI')
 *   if (await popup.confirm({ title, message, confirmText, danger: true })) { ... }
 */
const PopupContext = createContext(null)

const DURATION = { success: 3500, info: 4000, error: 6000 }
const ICON = { success: '✔', info: 'ℹ', error: '!' }
let nextId = 0

export function PopupProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((type, message) => {
    if (!message) return
    setToasts((list) => {
      // same message already on screen (e.g. live camera retrying): restart its timer instead of stacking
      const existing = list.find((t) => t.type === type && t.message === message)
      const id = existing ? existing.id : ++nextId
      clearTimeout(timers.current[id])
      timers.current[id] = setTimeout(() => dismiss(id), DURATION[type])
      return existing ? list : [...list.slice(-3), { id, type, message }]
    })
  }, [dismiss])

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setDialog({ ...opts, resolve })),
    []
  )

  const close = useCallback((answer) => {
    setDialog((d) => { d?.resolve(answer); return null })
  }, [])

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  const value = useMemo(() => ({
    success: (m) => show('success', m),
    error: (m) => show('error', m),
    info: (m) => show('info', m),
    confirm,
  }), [show, confirm])

  return (
    <PopupContext.Provider value={value}>
      {children}

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon" aria-hidden="true">{ICON[t.type]}</span>
            <span className="toast-text">{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>

      {dialog && <ConfirmDialog {...dialog} onClose={close} />}
    </PopupContext.Provider>
  )
}

function ConfirmDialog({ title = 'Are you sure?', message, confirmText = 'Confirm', cancelText = 'Cancel', danger, onClose }) {
  const confirmRef = useRef(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">
        <div className={`confirm-icon ${danger ? 'danger' : ''}`} aria-hidden="true">{danger ? '!' : '?'}</div>
        <h2 id="confirm-title" className="confirm-title">{title}</h2>
        {message && <p id="confirm-msg" className="muted">{message}</p>}
        <div className="confirm-actions">
          <button className="btn ghost" onClick={() => onClose(false)}>{cancelText}</button>
          <button ref={confirmRef} className={`btn ${danger ? 'danger solid' : 'primary'}`} onClick={() => onClose(true)}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export function usePopup() {
  const ctx = useContext(PopupContext)
  if (!ctx) throw new Error('usePopup must be used inside <PopupProvider>')
  return ctx
}
