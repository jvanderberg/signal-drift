import { useState, useRef, useEffect } from 'react';
import type { DeviceInfo, ConnectionStatus } from '../types';
import { useDeviceNames } from '../hooks/useDeviceNames';

interface EditableDeviceHeaderProps {
  info: DeviceInfo;
  connectionStatus: ConnectionStatus;
  onClose?: () => void;
}

export function EditableDeviceHeader({
  info,
  connectionStatus,
  onClose,
}: EditableDeviceHeaderProps) {
  const { getCustomName, setCustomName, resetCustomName, hasCustomName } = useDeviceNames();
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editContainerRef = useRef<HTMLDivElement>(null);

  const customName = getCustomName(info.manufacturer, info.model);
  const defaultTitle = `${info.manufacturer} ${info.model}`;
  const typeLabel = info.type === 'power-supply' ? 'PSU'
    : info.type === 'oscilloscope' ? 'Scope'
    : 'Load';
  const defaultSubtitle = `${typeLabel}${info.serial ? ` · ${info.serial}` : ''}`;

  const displayTitle = customName?.title || defaultTitle;
  const displaySubtitle = customName?.subtitle || defaultSubtitle;
  const hasCustom = hasCustomName(info.manufacturer, info.model);

  const icon = info.type === 'power-supply' ? '⚡'
    : info.type === 'oscilloscope' ? '📈'
    : '📊';

  const handleStartEdit = () => {
    setEditTitle(displayTitle);
    setEditSubtitle(displaySubtitle);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmedTitle = editTitle.trim();
    const trimmedSubtitle = editSubtitle.trim();

    // Only save if something changed from defaults or existing custom
    if (trimmedTitle && (trimmedTitle !== defaultTitle || trimmedSubtitle !== defaultSubtitle)) {
      setCustomName(
        info.manufacturer,
        info.model,
        trimmedTitle || defaultTitle,
        trimmedSubtitle || defaultSubtitle
      );
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetCustomName(info.manufacturer, info.model);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  // Only save on blur if focus is leaving the edit container entirely
  const handleBlur = (e: React.FocusEvent) => {
    // Check if the new focus target is still within our edit container
    if (editContainerRef.current && !editContainerRef.current.contains(e.relatedTarget as Node)) {
      handleSave();
    }
  };

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditing]);

  const isConnected = connectionStatus === 'connected';

  return (
    <div className="bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] rounded-md p-3 mb-2">
      <div className="flex justify-between items-center">
        <div
          className="flex items-center gap-2.5 cursor-pointer group"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={!isEditing ? handleStartEdit : undefined}
        >
          <span className="text-lg">{icon}</span>
          {isEditing ? (
            <div ref={editContainerRef}>
              <input
                ref={titleInputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="block font-semibold text-sm leading-5 bg-transparent outline-none border-none"
                style={{
                  width: `${Math.max(editTitle.length + 1, 10)}ch`,
                  boxShadow: 'inset 0 -1px 0 var(--color-accent)'
                }}
              />
              <input
                type="text"
                value={editSubtitle}
                onChange={(e) => setEditSubtitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="block text-[11px] leading-4 text-[var(--color-text-muted)] bg-transparent outline-none border-none"
                style={{
                  width: `${Math.max(editSubtitle.length + 1, 10)}ch`,
                  boxShadow: 'inset 0 -1px 0 var(--color-border-light)'
                }}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="py-[2px]">
                <div className="font-semibold text-sm leading-5 group-hover:text-[var(--color-accent)] transition-colors">
                  {displayTitle}
                </div>
                <div className="text-[11px] leading-4 text-[var(--color-text-muted)]">
                  {displaySubtitle}
                </div>
              </div>
              {isHovered && (
                hasCustom ? (
                  <button
                    onClick={handleReset}
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors px-1"
                    title="Reset to default"
                  >
                    ↺
                  </button>
                ) : (
                  <span
                    className="text-sm px-1 opacity-60 hover:opacity-100 transition-opacity"
                    title="Click to edit"
                  >
                    ✏️
                  </span>
                )
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          <span className="text-xs">
            {connectionStatus === 'connected'
              ? 'Connected'
              : connectionStatus === 'error'
              ? 'Error'
              : 'Disconnected'}
          </span>
          {onClose && (
            <button
              className="w-6 h-6 flex items-center justify-center text-sm font-medium rounded bg-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:opacity-90"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
