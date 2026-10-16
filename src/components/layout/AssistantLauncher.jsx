import React from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';

export default function AssistantLauncher({ onClick }) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <button
      type="button"
      onClick={onClick}
      className="assistant-launcher"
      aria-label="Open AI assistant"
      title="Open AI assistant"
    >
      <Bot size={23} strokeWidth={2.2} aria-hidden="true" />
    </button>,
    document.body
  );
}
