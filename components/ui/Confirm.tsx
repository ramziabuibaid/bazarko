'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

interface ConfirmOpts {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>

const Ctx = createContext<ConfirmFn | null>(null)

export function useConfirm() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return c
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o)
    return new Promise<boolean>(res => { resolver.current = res })
  }, [])

  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null) }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {opts && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 print:hidden"
          onClick={() => close(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-right"
            onClick={e => e.stopPropagation()}>
            {opts.title && <h3 className="mb-2 text-base font-semibold text-white">{opts.title}</h3>}
            <p className="text-sm text-slate-300">{opts.message}</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => close(false)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5">
                {opts.cancelLabel ?? 'إلغاء'}
              </button>
              <button onClick={() => close(true)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors ${
                  opts.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500'
                }`}>
                {opts.confirmLabel ?? 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
