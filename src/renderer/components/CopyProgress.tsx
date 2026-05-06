import React from 'react';
import { FiCopy, FiCheck, FiX } from 'react-icons/fi';
import { CopyOp } from '../hooks/useCopyOps';
import { formatSize } from '../utils/formatSize';

interface CopyProgressProps {
  ops: CopyOp[];
}

export function CopyProgress({ ops }: CopyProgressProps) {
  if (ops.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {ops.map((op) => (
        <CopyCard key={op.opId} op={op} />
      ))}
    </div>
  );
}

function CopyCard({ op }: { op: CopyOp }) {
  const pct = op.bytesTotal > 0 ? Math.min(100, (op.bytesDone / op.bytesTotal) * 100) : 0;
  const elapsedSec = Math.max(0.001, (Date.now() - op.startedAt) / 1000);
  const speedBps = op.bytesDone / elapsedSec;
  const remaining = Math.max(0, op.bytesTotal - op.bytesDone);
  const etaSec = speedBps > 0 ? remaining / speedBps : 0;

  return (
    <div
      style={{
        background: 'rgba(20,22,28,0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: '0 12px 32px -10px rgba(0,0,0,0.6)',
        fontFamily: 'Geist, sans-serif',
        color: 'var(--text)',
        fontSize: 12,
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        {op.error ? (
          <FiX size={14} style={{ color: 'var(--danger, #ff6b6b)', flexShrink: 0 }} />
        ) : op.done ? (
          <FiCheck size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        ) : (
          <FiCopy size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: 500, letterSpacing: '-0.005em' }}>
          {op.error ? 'Copy failed' : op.done ? 'Copy complete' : 'Copying…'}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontFamily: 'Geist Mono, monospace', fontSize: 11 }}>
          {Math.round(pct)}%
        </span>
      </div>

      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: op.error ? 'var(--danger, #ff6b6b)' : 'var(--accent)',
            borderRadius: 999,
            transition: 'width 200ms linear',
          }}
        />
      </div>

      {op.error ? (
        <div style={{ color: 'var(--danger, #ff6b6b)', fontSize: 11 }}>{op.error}</div>
      ) : (
        <>
          <div
            className="truncate"
            style={{
              color: 'var(--text-dim)',
              fontSize: 11,
              fontFamily: 'Geist Mono, monospace',
              marginBottom: 4,
            }}
            title={op.currentFile}
          >
            {op.currentFile || ' '}
          </div>
          <div className="flex items-center gap-2" style={{ color: 'var(--text-faint)', fontSize: 10.5, fontFamily: 'Geist Mono, monospace' }}>
            <span>{formatSize(op.bytesDone)} / {formatSize(op.bytesTotal)}</span>
            {!op.done && speedBps > 0 && (
              <>
                <span>•</span>
                <span>{formatSize(speedBps)}/s</span>
                {etaSec > 0 && etaSec < 60 * 60 && (
                  <>
                    <span>•</span>
                    <span>{formatEta(etaSec)} left</span>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatEta(sec: number): string {
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  return `${m}m ${s}s`;
}
