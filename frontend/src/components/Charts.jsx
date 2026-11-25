/**
 * Small dependency-free charts. Single hue (magnitude), rounded data ends,
 * values on hover, text in text colours.
 */

/** Vertical columns, e.g. a value per day. data: [{ label, value, tip }] */
export function ColumnChart({ data, height = 140, unit = '' }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="col-chart" style={{ height }} role="img"
      aria-label={data.map((d) => `${d.label}: ${d.value}${unit}`).join(', ')}>
      {data.map((d) => (
        <div className="col" key={d.label} tabIndex={0}>
          <span className="col-tip">{d.tip || `${d.value}${unit}`}</span>
          <div className="col-track">
            <div className="col-bar" style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="col-label">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Horizontal bars with the value at the end. data: [{ label, value }] */
export function BarList({ data, total }) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0)
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="bar-list">
      {data.map((d) => (
        <div className="bar-row" key={d.label} title={`${d.label}: ${d.value}`}>
          <span className="bar-label">{d.label}</span>
          <div className="bar"><div style={{ width: `${(d.value / max) * 100}%` }} /></div>
          <span className="bar-val">
            {d.value}
            {sum > 0 && <span className="muted"> · {Math.round((d.value / sum) * 100)}%</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
