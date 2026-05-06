import React, { useState, useRef, useEffect } from 'react';
import { FiSend, FiTrash2, FiAlertCircle, FiKey, FiX } from 'react-icons/fi';
import { useChat } from '../hooks/useChat';
import { AppSettings } from '../../types';

interface ChatPanelProps {
  currentPath: string;
  settings: AppSettings;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function ChatPanel({ currentPath, settings, onRefresh, onOpenSettings, onClose }: ChatPanelProps) {
  const { messages, isLoading, sendMessage, clearHistory } = useChat(currentPath, onRefresh);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading || !settings.apiKey) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage(text, settings.apiKey);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
  };

  const hasApiKey = Boolean(settings.apiKey);

  return (
    <div
      className="h-full flex flex-col"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.012), transparent 40%)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          padding: '12px 14px',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            style={{
              width: 22, height: 22,
              borderRadius: 6,
              background: 'linear-gradient(135deg, var(--accent-hover), var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px -3px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ✦
          </div>
          <div className="flex flex-col">
            <span style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              AI Assistant
            </span>
            <span style={{ color: 'var(--text-faint)', fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.01em' }}>
              claude-opus-4-5
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={clearHistory}
            className="fp-btn-ghost flex items-center justify-center"
            style={{ width: 26, height: 26 }}
            title="Clear chat"
          >
            <FiTrash2 size={12} />
          </button>
          <button
            onClick={onClose}
            className="fp-btn-ghost flex items-center justify-center"
            style={{ width: 26, height: 26 }}
            title="Close panel"
          >
            <FiX size={13} />
          </button>
        </div>
      </div>

      {/* API key missing banner */}
      {!hasApiKey && (
        <div
          className="flex-shrink-0 flex items-center gap-2"
          style={{
            margin: '10px 10px 0',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--danger-soft)',
            border: '1px solid rgba(240,110,126,0.22)',
            color: '#ffb4bd',
            fontSize: 11.5,
            letterSpacing: '-0.005em',
          }}
        >
          <FiAlertCircle size={13} className="flex-shrink-0" />
          <span>API key not set.</span>
          <button
            onClick={onOpenSettings}
            className="underline hover:no-underline flex items-center gap-1 ml-auto"
            style={{ fontWeight: 500 }}
          >
            <FiKey size={11} /> Open Settings
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3" style={{ padding: '14px 12px' }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div
              style={{
                width: 52, height: 52, borderRadius: 14,
                background: 'linear-gradient(135deg, var(--accent-soft), transparent)',
                border: '1px solid var(--accent-strong)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
                color: 'var(--accent-text)',
                boxShadow: '0 12px 32px -12px var(--accent-glow)',
              }}
            >
              ✦
            </div>
            <p
              className="text-center"
              style={{ color: 'var(--text-dim)', fontSize: 12.5, maxWidth: 220, lineHeight: 1.55, letterSpacing: '-0.005em' }}
            >
              Ask me to find, rename, move, or organize your files in this folder.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={msg.role === 'user' ? 'fp-chat-bubble-user' : msg.isError ? '' : 'fp-chat-bubble-asst'}
              style={{
                ...(msg.isError ? {
                  background: 'var(--danger-soft)',
                  color: '#ffb4bd',
                  border: '1px solid rgba(240,110,126,0.22)',
                } : {}),
                padding: '9px 13px',
                fontSize: 12.5,
                maxWidth: '90%',
                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                lineHeight: 1.55,
                letterSpacing: '-0.005em',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
              {msg.isStreaming && (
                <span
                  className="inline-block ml-0.5 animate-pulse"
                  style={{
                    width: 2, height: 13,
                    background: msg.role === 'user' ? '#fff' : 'var(--accent)',
                    borderRadius: 1,
                    verticalAlign: 'middle',
                  }}
                />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0" style={{ padding: 10, borderTop: '1px solid var(--border-subtle)' }}>
        <div
          className="flex items-end gap-2 transition-all"
          style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '8px 10px',
          }}
          onFocusCapture={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
          onBlurCapture={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={hasApiKey ? 'Ask about your files…' : 'Set API key in settings to start'}
            disabled={!hasApiKey || isLoading}
            rows={1}
            className="flex-1 resize-none outline-none bg-transparent"
            style={{
              color: 'var(--text)',
              fontFamily: 'Geist, sans-serif',
              fontSize: 12.5,
              lineHeight: 1.55,
              letterSpacing: '-0.005em',
              maxHeight: 140,
              overflowY: 'auto',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!hasApiKey || !input.trim() || isLoading}
            className="transition-all flex-shrink-0 disabled:opacity-30 flex items-center justify-center"
            style={{
              width: 28, height: 28,
              borderRadius: 8,
              background: hasApiKey && input.trim() && !isLoading
                ? 'linear-gradient(180deg, var(--accent-hover), var(--accent))'
                : 'rgba(255,255,255,0.05)',
              color: hasApiKey && input.trim() && !isLoading ? '#fff' : 'var(--text-faint)',
              boxShadow: hasApiKey && input.trim() && !isLoading
                ? '0 4px 12px -3px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.18)'
                : 'none',
            }}
          >
            {isLoading ? (
              <span className="rounded-full animate-spin block" style={{ width: 12, height: 12, border: '1.5px solid #fff', borderTopColor: 'transparent' }} />
            ) : (
              <FiSend size={12} />
            )}
          </button>
        </div>
        <p
          className="mt-1.5 text-center"
          style={{ color: 'var(--text-ghost)', fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.02em' }}
        >
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
