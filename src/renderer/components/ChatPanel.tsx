import React, { useState, useRef, useEffect } from 'react';
import { FiSend, FiTrash2, FiAlertCircle, FiKey } from 'react-icons/fi';
import { useChat } from '../hooks/useChat';
import { AppSettings } from '../../types';

interface ChatPanelProps {
  currentPath: string;
  settings: AppSettings;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function ChatPanel({ currentPath, settings, onRefresh, onOpenSettings }: ChatPanelProps) {
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
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const hasApiKey = Boolean(settings.apiKey);

  return (
    <div className="h-full flex flex-col" style={{ background: '#1a1a1a' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: '#2a2a2a' }}
      >
        <div>
          <span className="font-medium text-sm" style={{ color: '#e5e5e5' }}>AI Assistant</span>
          <span className="ml-2 text-xs" style={{ color: '#555' }}>claude-opus-4-5</span>
        </div>
        <button
          onClick={clearHistory}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="Clear chat"
          style={{ color: '#666' }}
        >
          <FiTrash2 size={13} />
        </button>
      </div>

      {/* API key missing banner */}
      {!hasApiKey && (
        <div
          className="mx-2 mt-2 px-3 py-2 rounded-lg flex items-center gap-2 text-xs flex-shrink-0"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
        >
          <FiAlertCircle size={13} className="flex-shrink-0" />
          <span>API key not set.</span>
          <button
            onClick={onOpenSettings}
            className="underline hover:no-underline flex items-center gap-1"
          >
            <FiKey size={11} /> Open Settings
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: '#444' }}>
            <span style={{ fontSize: 28 }}>✦</span>
            <p className="text-xs text-center" style={{ color: '#555' }}>
              Ask me to find, rename, move,<br />or organize your files.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className="rounded-2xl px-3 py-2 text-xs max-w-[90%]"
              style={{
                background:
                  msg.role === 'user'
                    ? '#1e40af'
                    : msg.isError
                    ? 'rgba(239,68,68,0.1)'
                    : '#252525',
                color: msg.isError ? '#fca5a5' : '#e5e5e5',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                border: msg.isError ? '1px solid rgba(239,68,68,0.3)' : 'none',
                lineHeight: 1.5,
                fontFamily: 'Inter, sans-serif',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
              {msg.isStreaming && (
                <span
                  className="inline-block w-1.5 h-3 ml-0.5 animate-pulse"
                  style={{ background: '#3b82f6', borderRadius: 2, verticalAlign: 'middle' }}
                />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 p-2 border-t"
        style={{ borderColor: '#2a2a2a' }}
      >
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={hasApiKey ? 'Ask about your files…' : 'Set API key in settings to start'}
            disabled={!hasApiKey || isLoading}
            rows={1}
            className="flex-1 resize-none outline-none bg-transparent text-xs"
            style={{
              color: '#e5e5e5',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.5,
              maxHeight: 120,
              overflowY: 'auto',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!hasApiKey || !input.trim() || isLoading}
            className="p-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-30"
            style={{
              background: hasApiKey && input.trim() && !isLoading ? '#3b82f6' : '#222',
              color: '#fff',
            }}
          >
            {isLoading ? (
              <span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin block" />
            ) : (
              <FiSend size={13} />
            )}
          </button>
        </div>
        <p className="mt-1 text-center" style={{ color: '#444', fontSize: 10 }}>
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
