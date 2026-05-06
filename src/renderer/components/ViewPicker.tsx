import React, { useState, useRef, useEffect } from 'react';
import { PiImage, PiImageSquare, PiListBullets, PiCaretDown } from 'react-icons/pi';

/**
 * Continuous view picker. `pos` is a slider position in [0, 1]:
 *   - 0.0 … 0.85  → thumbnails, px interpolated from MAX_PX down to MIN_PX
 *   - 0.85 … 1.0  → details (table) view, no thumbnails
 *
 * Labels (XL/L/M/S Icons, Details) are positional references only —
 * the slider does not snap. Dragging smoothly resizes icons in realtime.
 */

export const DETAILS_THRESHOLD = 0.85;
export const MIN_PX = 40;
export const MAX_PX = 280;

/** Given a slider pos, returns the current view mode and thumbnail px. */
export function resolveView(pos: number): { mode: 'details' | 'thumbnails'; px: number } {
  if (pos >= DETAILS_THRESHOLD) return { mode: 'details', px: 0 };
  const t = pos / DETAILS_THRESHOLD;           // 0 at top, 1 at bottom of icons range
  const px = Math.round(MAX_PX - t * (MAX_PX - MIN_PX));
  return { mode: 'thumbnails', px };
}

/** Short label for the current pos — used on the toolbar button. */
function labelFor(pos: number): string {
  if (pos >= DETAILS_THRESHOLD) return 'Details';
  const { px } = resolveView(pos);
  if (px >= 210) return 'XL Icons';
  if (px >= 140) return 'L Icons';
  if (px >=  95) return 'M Icons';
  return 'S Icons';
}

/** Icon for the current pos. */
function IconFor({ pos }: { pos: number }) {
  if (pos >= DETAILS_THRESHOLD) return <PiListBullets size={13} />;
  const { px } = resolveView(pos);
  return px >= 140 ? <PiImage size={13} /> : <PiImageSquare size={12} />;
}

/** Labels shown beside the slider, top → bottom, at evenly-spaced positions. */
const LABEL_ROWS: Array<{ pos: number; icon: React.ReactNode; text: string }> = [
  { pos: 0.00, icon: <PiImage size={14} />,       text: 'XL Icons' },
  { pos: 0.20, icon: <PiImage size={13} />,       text: 'L Icons'  },
  { pos: 0.42, icon: <PiImageSquare size={13} />, text: 'M Icons'  },
  { pos: 0.63, icon: <PiImageSquare size={11} />, text: 'S Icons'  },
  { pos: 1.00, icon: <PiListBullets size={13} />, text: 'Details'  },
];

interface Props {
  pos: number;
  onChange: (pos: number) => void;
}

export function ViewPicker({ pos, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const popRef   = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number | null>(null);
  const pendingY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function flush() {
    rafRef.current = null;
    const y = pendingY.current;
    if (y == null) return;
    pendingY.current = null;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
    onChange(ratio);
  }

  function scheduleUpdate(clientY: number) {
    pendingY.current = clientY;
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
  }

  function handleSliderPointer(e: React.PointerEvent<HTMLDivElement>) {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    scheduleUpdate(e.clientY);
    const onMove = (ev: PointerEvent) => scheduleUpdate(ev.clientY);
    const onUp   = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
  }

  // Click a label → jump to that position.
  function jumpTo(p: number) { onChange(p); }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 transition-all"
        style={{
          color: open ? 'var(--text)' : 'var(--text-dim)',
          fontSize: 12,
          background: open ? 'rgba(255,255,255,0.05)' : 'transparent',
          padding: '7px 10px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          minWidth: 108,
          fontWeight: 500,
          letterSpacing: '-0.005em',
        }}
        onMouseEnter={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; } }}
        onMouseLeave={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; } }}
        title="View"
      >
        <IconFor pos={pos} />
        <span>{labelFor(pos)}</span>
        <PiCaretDown size={10} style={{ opacity: 0.6, marginLeft: 'auto' }} />
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute fp-glass"
          style={{
            right: 0,
            top: 'calc(100% + 8px)',
            background: 'rgba(24, 20, 30, 0.92)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: 10,
            width: 210,
            zIndex: 50,
            animation: 'fp-ctx-in 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
          }}
        >
          <div className="flex items-stretch gap-2" style={{ height: 210 }}>
            {/* Reference labels — click to jump */}
            <div className="flex-1 relative" style={{ margin: '28px 0 20px' }}>
              {LABEL_ROWS.map((row) => {
                const active =
                  (row.text === 'Details' && pos >= DETAILS_THRESHOLD) ||
                  (row.text !== 'Details' && labelFor(pos) === row.text);
                return (
                  <button
                    key={row.text}
                    onClick={() => jumpTo(row.pos)}
                    className="absolute left-0 right-0 flex items-center gap-2 text-left transition-colors"
                    style={{
                      top: `calc(${row.pos * 100}% - 13px)`,
                      padding: '5px 9px',
                      borderRadius: 7,
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color:      active ? 'var(--accent-text)' : 'var(--text-dim)',
                      fontSize: 12,
                      fontWeight: active ? 500 : 400,
                      letterSpacing: '-0.005em',
                      boxShadow: active ? 'inset 0 0 0 1px var(--accent-strong)' : 'none',
                    }}
                    onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; } }}
                    onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; } }}
                  >
                    {row.icon}
                    <span>{row.text}</span>
                  </button>
                );
              })}
            </div>

            {/* Continuous vertical slider */}
            <div
              ref={trackRef}
              onPointerDown={handleSliderPointer}
              className="relative cursor-pointer flex-shrink-0"
              style={{ width: 20, margin: '28px 2px 20px' }}
            >
              <div
                className="absolute left-1/2"
                style={{
                  top: 0, bottom: 0, width: 3,
                  transform: 'translateX(-50%)',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 2,
                }}
              />
              {/* Active fill */}
              <div
                className="absolute left-1/2"
                style={{
                  top: 0,
                  height: `${Math.max(0, Math.min(1, pos)) * 100}%`,
                  width: 3,
                  transform: 'translateX(-50%)',
                  background: 'linear-gradient(180deg, var(--accent-hover), var(--accent))',
                  borderRadius: 2,
                  boxShadow: '0 0 8px var(--accent-glow)',
                }}
              />
              {/* Details threshold tick */}
              <div
                className="absolute left-1/2"
                style={{
                  top: `${DETAILS_THRESHOLD * 100}%`,
                  width: 12, height: 1,
                  transform: 'translate(-50%, 0)',
                  background: 'var(--border-strong)',
                }}
              />
              {/* Thumb */}
              <div
                className="absolute left-1/2"
                style={{
                  top: `${Math.max(0, Math.min(1, pos)) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 14, height: 28,
                  background: 'linear-gradient(180deg, #fff, #e4dffb)',
                  borderRadius: 8,
                  pointerEvents: 'none',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4), 0 0 0 2px var(--accent)',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
