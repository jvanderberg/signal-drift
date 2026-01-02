import type { Toast } from '../stores';

interface ToastContainerProps {
  toasts: Toast[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 z-50 flex flex-col gap-1.5">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`toast px-3 py-2 rounded text-xs text-white max-w-[260px] ${toast.type}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
