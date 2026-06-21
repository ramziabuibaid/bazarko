'use client'

import { createContext, useCallback, useContext, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: number; message: string; type: ToastType }
interface ToastCtx { toast: (message: string, type?: ToastType) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used within <ToastProvider>')
  return c.toast
}

const STYLES: Record<ToastType, { cls: string; icon: string }> = {
  success: { cls: 'border-emerald-500/30 bg-emerald-950/90 text-emerald-200', icon: '✅' },
  error:   { cls: 'border-red-500/30 bg-red-950/90 text-red-200',             icon: '⛔' },
  info:    { cls: 'border-sky-500/30 bg-sky-950/90 text-sky-200',             icon: 'ℹ️' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random()
    setItems(p => [...p, { id, message, type }])
    setTimeout(() => setItems(p => p.filter(t => t.id !== id)), 3500)
  }, [])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 print:hidden">
        {items.map(t => {
          const s = STYLES[t.type]
          return (
            <div key={t.id}
              className={`pointer-events-auto flex w-full items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-sm ${s.cls}`}
              style={{ animation: 'toast-in .25s ease-out' }}>
              <span className="text-base">{s.icon}</span>
              <span className="flex-1">{t.message}</span>
            </div>
          )
        })}
      </div>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </Ctx.Provider>
  )
}
