/**
 * DeviceSidebar - Hamburger menu that slides out to show devices and widgets
 *
 * - Hidden by default, shows hamburger icon
 * - Slides out smoothly when opened
 * - Devices with editable names and subtitles
 * - Widgets section below divider
 * - Click outside to close
 */

import { useState, useRef, useEffect } from 'react';
import type { DeviceSummary, DeviceInfo } from '../types';
import { useDeviceNames } from '../hooks/useDeviceNames';

interface DeviceSidebarProps {
  devices: DeviceSummary[];
  openDeviceIds: Set<string>;
  showSequencer: boolean;
  showTriggerScripts: boolean;
  onDeviceClick: (device: DeviceSummary) => void;
  onSequencerClick: () => void;
  onTriggerScriptsClick: () => void;
  onScan: () => void;
  isScanning: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

interface EditableDeviceItemProps {
  info: DeviceInfo;
  isOpen: boolean;
  onClick: () => void;
}

function EditableDeviceItem({ info, isOpen, onClick }: EditableDeviceItemProps) {
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
    : info.type === 'oscilloscope' ? '📊'
    : '📉';

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(displayTitle);
    setEditSubtitle(displaySubtitle);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmedTitle = editTitle.trim();
    const trimmedSubtitle = editSubtitle.trim();

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

  const handleBlur = (e: React.FocusEvent) => {
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

  return (
    <div
      className={`px-3 py-2 cursor-pointer transition-colors ${
        isOpen ? 'bg-[var(--color-bg-secondary)]' : 'hover:bg-[var(--color-bg-secondary)]'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={!isEditing ? onClick : undefined}
    >
      <div className="flex items-start gap-2">
        <span className="text-base mt-0.5">{icon}</span>
        {isEditing ? (
          <div ref={editContainerRef} className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
            <input
              ref={titleInputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              className="block w-full font-medium text-sm leading-5 bg-transparent outline-none border-none text-[var(--color-text-primary)]"
              style={{ boxShadow: 'inset 0 -1px 0 var(--color-accent)' }}
            />
            <input
              type="text"
              value={editSubtitle}
              onChange={(e) => setEditSubtitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              className="block w-full text-xs leading-4 text-[var(--color-text-muted)] bg-transparent outline-none border-none mt-0.5"
              style={{ boxShadow: 'inset 0 -1px 0 var(--color-border-light)' }}
            />
          </div>
        ) : (
          <div className="flex-1 min-w-0 flex items-start justify-between gap-1">
            <div className="min-w-0">
              <div className="font-medium text-sm leading-5 truncate">{displayTitle}</div>
              <div className="text-xs leading-4 text-[var(--color-text-muted)] truncate">
                {displaySubtitle}
              </div>
            </div>
            {isHovered && (
              hasCustom ? (
                <button
                  onClick={handleReset}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors px-1 flex-shrink-0"
                  title="Reset to default"
                >
                  ↺
                </button>
              ) : (
                <button
                  onClick={handleStartEdit}
                  className="text-xs px-1 opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Click to edit"
                >
                  ✏️
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function DeviceSidebar({
  devices,
  openDeviceIds,
  showSequencer,
  showTriggerScripts,
  onDeviceClick,
  onSequencerClick,
  onTriggerScriptsClick,
  onScan,
  isScanning,
  isOpen,
  onToggle,
}: DeviceSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        onToggle();
      }
    };

    // Delay to avoid closing immediately on the toggle click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, onToggle]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onToggle]);

  return (
    <>
      {/* Hamburger button - always visible, vertically centered with header */}
      <button
        onClick={onToggle}
        className="fixed top-1.5 left-3 z-50 w-8 h-8 flex items-center justify-center rounded-md bg-[var(--color-bg-panel)] border border-[var(--color-border-dark)] hover:bg-[var(--color-bg-secondary)] transition-colors"
        title="Open menu"
      >
        <div className="flex flex-col gap-[3px]">
          <span className="block w-4 h-0.5 bg-current" />
          <span className="block w-4 h-0.5 bg-current" />
          <span className="block w-4 h-0.5 bg-current" />
        </div>
      </button>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onToggle}
      />

      {/* Sliding panel */}
      <div
        ref={sidebarRef}
        className={`fixed top-0 left-0 h-full w-72 z-50 bg-[var(--color-bg-panel)] border-r border-[var(--color-border-dark)] flex flex-col transform transition-transform duration-200 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--color-border-dark)]">
          <span className="text-sm font-medium">Devices & Widgets</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onScan}
              disabled={isScanning}
              className="px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-dark)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50 transition-colors"
              title="Rescan for devices"
            >
              {isScanning ? 'Scanning...' : 'Rescan'}
            </button>
            <button
              onClick={onToggle}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              title="Close menu"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-y-auto">
          {/* Hardware devices */}
          {devices.length === 0 ? (
            <div className="px-3 py-6 text-xs text-[var(--color-text-secondary)] text-center">
              No devices connected.<br />
              <button
                onClick={onScan}
                disabled={isScanning}
                className="mt-2 text-[var(--color-text-primary)] underline disabled:opacity-50"
              >
                {isScanning ? 'Scanning...' : 'Scan for devices'}
              </button>
            </div>
          ) : (
            <div className="py-1">
              {devices.map((device) => (
                <EditableDeviceItem
                  key={device.id}
                  info={device.info}
                  isOpen={openDeviceIds.has(device.id)}
                  onClick={() => onDeviceClick(device)}
                />
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="mx-3 my-2 border-t border-[var(--color-border-dark)]" />

          {/* Widgets */}
          <div className="py-1">
            <div
              className={`px-3 py-2 cursor-pointer transition-colors flex items-center gap-2 ${
                showSequencer ? 'bg-[var(--color-bg-secondary)]' : 'hover:bg-[var(--color-bg-secondary)]'
              }`}
              onClick={onSequencerClick}
            >
              <span className="text-base">🎛️</span>
              <div>
                <div className="font-medium text-sm leading-5">Sequencer</div>
                <div className="text-xs leading-4 text-[var(--color-text-muted)]">
                  Software AWG
                </div>
              </div>
            </div>
            <div
              className={`px-3 py-2 cursor-pointer transition-colors flex items-center gap-2 ${
                showTriggerScripts ? 'bg-[var(--color-bg-secondary)]' : 'hover:bg-[var(--color-bg-secondary)]'
              }`}
              onClick={onTriggerScriptsClick}
            >
              <span className="text-base">⚡</span>
              <div>
                <div className="font-medium text-sm leading-5">Trigger Scripts</div>
                <div className="text-xs leading-4 text-[var(--color-text-muted)]">
                  Reactive automation
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
