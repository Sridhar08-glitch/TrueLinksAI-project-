import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';

type ToastVariant = 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${
              t.variant === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {t.variant === 'success'
              ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />}
            <span className="flex-1 break-words">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="opacity-50 hover:opacity-100 flex-shrink-0 mt-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
