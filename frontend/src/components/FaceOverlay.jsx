/**
 * Face boxes positioned with percentages so they stay aligned at any display size.
 * boxes: [{ region: {x,y,w,h}, label, color }]
 * size:  { width, height } of the image the backend processed
 */
export function BoxLayer({ size, boxes = [] }) {
  if (!size) return null
  return boxes.map((b, i) => (
    <div
      key={i}
      className="face-box"
      style={{
        left: `${(b.region.x / size.width) * 100}%`,
        top: `${(b.region.y / size.height) * 100}%`,
        width: `${(b.region.w / size.width) * 100}%`,
        height: `${(b.region.h / size.height) * 100}%`,
        borderColor: b.color || 'var(--accent)',
      }}
    >
      {b.label && (
        <span className="face-label" style={{ background: b.color || 'var(--accent)' }}>
          {b.label}
        </span>
      )}
    </div>
  ))
}

export default function FaceOverlay({ src, size, boxes = [] }) {
  return (
    <div className="overlay-wrap">
      <img src={src} alt="Analysed" className="preview-img" />
      <BoxLayer size={size} boxes={boxes} />
    </div>
  )
}
