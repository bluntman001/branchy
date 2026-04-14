import React, { useState, useEffect } from 'react';
import { FiX, FiEye, FiEyeOff, FiKey, FiFolder } from 'react-icons/fi';
import { AppSettings } from '../../types';

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
    window.fileAPI.settings.getHomeDir().then(setHomeDir);
  }, []);

  const handleSave = () => {
    onSave({ apiKey, startDir, confirmDelete, showHidden });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-[480px] border overflow-hidden"
        style={{ background: '#1a1a1a', borderColor: '#2a2a2a' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: '#2a2a2a' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: '#e5e5e5' }}>Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#666' }}
          >
            <FiX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* API Key */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: '#aaa' }}>
              <FiKey size={12} /> Anthropic API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full px-3 py-2 pr-9 rounded-lg text-xs outline-none border"
                style={{
                  background: '#0f0f0f',
                  border: '1px solid #2a2a2a',
                  color: '#e5e5e5',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5"
                style={{ color: '#666' }}
              >
                {showKey ? <FiEyeOff size={13} /> : <FiEye size={13} />}
              </button>
            </div>
            <p className="mt-1 text-xs" style={{ color: '#555' }}>
              Stored locally. Get your key from console.anthropic.com
            </p>
          </div>

          {/* Start Directory */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: '#aaa' }}>
              <FiFolder size={12} /> Default Start Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={startDir}
                onChange={(e) => setStartDir(e.target.value)}
                placeholder={homeDir || 'e.g. C:\\Users\\You'}
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none border"
                style={{
                  background: '#0f0f0f',
                  border: '1px solid #2a2a2a',
                  color: '#e5e5e5',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <button
                onClick={() => setStartDir(homeDir)}
                className="px-3 py-1.5 rounded-lg text-xs hover:bg-white/10 transition-colors border"
                style={{ border: '1px solid #2a2a2a', color: '#888' }}
              >
                Reset
              </button>
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <ToggleRow
              label="Confirm before delete"
              description="Show a confirmation dialog before deleting files"
              checked={confirmDelete}
              onChange={setConfirmDelete}
            />
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
          className="flex items-center justify-end gap-2 px-5 py-4 border-t"
          style={{ borderColor: '#2a2a2a' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm hover:bg-white/10 transition-colors"
            style={{ color: '#888' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: '#3b82f6', color: '#fff' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#2563eb')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#3b82f6')}
          >
            Save Changes
          </button>
        </div>
      </div>
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
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-xs font-medium" style={{ color: '#ccc' }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: '#555' }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative flex-shrink-0 w-9 h-5 rounded-full transition-colors mt-0.5"
        style={{ background: checked ? '#3b82f6' : '#333' }}
        role="switch"
        aria-checked={checked}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    </div>
  );
}
