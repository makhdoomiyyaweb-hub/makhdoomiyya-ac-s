import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function DropdownMenu({ children, trigger, items = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const popupRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target) && !popupRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        aria-label="Record actions"
        aria-expanded={isOpen}
        className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500 transition-colors focus:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const height = Math.min(300, (items.length || React.Children.count(children)) * 44 + 8);
          setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)), left: Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)) });
          setIsOpen(!isOpen);
        }}
      >
        {trigger ? <span aria-hidden="true">{trigger.props.children}</span> : <MoreVertical size={18} />}
      </button>

      {isOpen && createPortal(
        <div ref={popupRef} role="group" aria-label="Record actions menu" style={position} onKeyDown={e => { if (e.key === 'Escape') setIsOpen(false); }} className="fixed w-48 max-h-[300px] overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-black/5 z-[60] focus:outline-none">
          <div className="p-1 flex flex-col gap-1" onClick={() => setIsOpen(false)}>
            {children}
            {items.map((item, index) => (
              <button type="button" key={index} onClick={item.onClick} disabled={item.disabled}
                className={`flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md ${item.danger ? 'text-danger hover:bg-red-50' : 'text-text hover:bg-gray-100'}`}>
                {item.icon && <item.icon size={16} />}{item.label}
              </button>
            ))}
          </div>
        </div>, document.body
      )}
    </div>
  );
}
