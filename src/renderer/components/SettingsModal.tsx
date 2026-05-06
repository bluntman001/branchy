import React, { useState, useEffect } from 'react';
import { FiX, FiEye, FiEyeOff, FiKey, FiFolder } from 'react-icons/fi';
import { AppSettings } from '../../types';
import { fileAPI } from '../../api';

interface SettingsModalProps {
  onClose: () => void;
  onSave: (settings: Partial<AppSettings>) => void;
  settings: AppSettings;
}

export function SettingsModal({ onClose, onSave, settings: initialSettings }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState(initialSettings.apiKey || '');
  const [startDir, setStartDir] = useState(initialSettings.startDir || '');
  const [confirmDelete, setConfirmDelete] = useState(initialSettings.confirmDelete ?? true);
  const [showHidden, setShowHidden] = useState(initialSettings.showHidden ?? false);
  const [showKey, setShowKey] = useState(false);
  const [homeDir, setHomeDir] = useState('');

  useEffect(() => {
    fileAPI.settings.getHomeDir().then(setHomeDir);
  }, []);

  const handleSave = () => {
    onSave({ apiKey, startDir, confirmDelete, showHidden });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{
        background: 'rgba(8, 6, 12, 0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'fadeIn 160ms ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[500px] overflow-hidden"
        style={{
          background: 'rgba(24, 20, 30, 0.92)',
          backdropFilter: 'blur(28px) saturate(170%)',
          WebkitBackdropFilter: 'blur(28px) saturate(170%)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.05)',
          animation: 'modalIn 200ms cubic-bezier(0.2, 0.9, 0.3, 1.1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              style={{
                width: 24, height: 24, borderRadius: 7,
                background: 'linear-gradient(135deg, var(--accent-hover), var(--accent))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: '#fff',
                boxShadow: '0 4px 12px -3px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
              }}
            >
              ⚙
            </div>
            <h2 style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.015em' }}>
              Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="fp-btn-ghost flex items-center justify-center"
            style={{ width: 28, height: 28, borderRadius: 8 }}
          >
            <FiX size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* API Key */}
          <div>
            <label
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}
            >
              <FiKey size={11} /> Anthropic API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="fp-input w-full"
                style={{
                  paddingRight: 36,
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: 12,
                  letterSpacing: '0.01em',
                }}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute fp-btn-ghost flex items-center justify-center"
                style={{
                  right: 6, top: '50%', transform: 'translateY(-50%)',
                  width: 26, height: 26, borderRadius: 6,
                }}
              >
                {showKey ? <FiEyeOff size={13} /> : <FiEye size={13} />}
              </button>
            </div>
            <p style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 6, letterSpacing: '-0.005em' }}>
              Stored locally. Get your key from console.anthropic.com
            </p>
          </div>

          {/* Start Directory */}
          <div>
            <label
              className="flex items-center gap-1.5"
              style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}
            >
              <FiFolder size={11} /> Default Start Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={startDir}
                onChange={(e) => setStartDir(e.target.value)}
                placeholder={homeDir || 'e.g. C:\\Users\\You'}
                className="fp-input flex-1"
                style={{
                  fontFamily: 'Geist Mono, monospace',
                  fontSize: 12,
                  letterSpacing: '0.01em',
                }}
              />
              <button
                onClick={() => setStartDir(homeDir)}
                className="fp-btn-ghost transition-colors"
                style={{
                  padding: '0 14px',
                  borderRadius: 6,
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  border: '1px solid var(--border)',
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                }}
              >
                Reset
              </button>
            </div>
          </div>

          {/* Toggles */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              background: 'rgba(255,255,255,0.018)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              padding: '4px',
            }}
          >
            <ToggleRow
              label="Confirm before delete"
              description="Show a confirmation dialog before deleting files"
              checked={confirmDelete}
              onChange={setConfirmDelete}
            />
            <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 8px' }} />
            <ToggleRow
              label="Show hidden files"
              description="Show files and folders starting with a dot"
              checked={showHidden}
              onChange={setShowHidden}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2"
          style={{
            padding: '16px 22px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(0,0,0,0.15)',
          }}
        >
          <button
            onClick={onClose}
            className="fp-btn-ghost"
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              color: 'var(--text-dim)',
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: '-0.005em',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="fp-btn-primary"
            style={{
              padding: '8px 18px',
              fontSize: 12.5,
            }}
          >
            Save Changes
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

function ToggleRow({
  label, description, checked, onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4" style={{ padding: '10px 12px' }}>
      <div>
        <div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 500, letterSpacing: '-0.005em' }}>
          {label}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 2, letterSpacing: '-0.005em' }}>
          {description}
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="fp-switch mt-0.5"
        data-on={checked}
        role="switch"
        aria-checked={checked}
      >
        <span className="fp-switch-thumb" />
      </button>
    </div>
  );
}
