import { ImageResponse } from 'next/og'

export const alt = 'Cornerstone — Composable TypeScript full-stack foundation'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#0b0b0f',
        color: '#f7f5ff',
        display: 'flex',
        fontFamily: 'Arial, sans-serif',
        height: '100%',
        justifyContent: 'center',
        padding: '72px',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ color: '#a78bfa', display: 'flex', fontSize: 30, fontWeight: 700 }}>
          CORNERSTONE
        </div>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, letterSpacing: '-2px' }}>
          Compose your project foundation
        </div>
        <div style={{ color: '#b8b5c2', display: 'flex', fontSize: 30 }}>
          Theme · Style · Brand · Density
        </div>
      </div>
    </div>,
    size,
  )
}
