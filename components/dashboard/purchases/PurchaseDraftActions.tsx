'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postPurchaseDraft, cancelPurchaseDraft } from '@/app/dashboard/purchases/purchase-draft-actions'

interface Props {
  storeId: string
  purchaseId: string
  invoiceNumber: string
  totalAmount: number
  currency: string
}

export default function PurchaseDraftActions({
  storeId,
  purchaseId,
  invoiceNumber,
  totalAmount,
  currency,
}: Props) {
  const router = useRouter()
  const [loadingAction, setLoadingAction] = useState<'post' | 'cancel' | null>(null)
  const [confirming, setConfirming] = useState<'post' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePost = async () => {
    setError(null)
    setLoadingAction('post')
    try {
      const res = await postPurchaseDraft(storeId, purchaseId)
      if (res.ok) {
        setConfirming(null)
        router.refresh()
      } else {
        setError(res.error || 'تعذر اعتماد الفاتورة')
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء اعتماد الفاتورة')
    } finally {
      setLoadingAction(null)
    }
  }

  const handleCancel = async () => {
    setError(null)
    setLoadingAction('cancel')
    try {
      const res = await cancelPurchaseDraft(storeId, purchaseId)
      if (res.ok) {
        setConfirming(null)
        router.refresh()
      } else {
        setError(res.error || 'تعذر إلغاء المسودة')
      }
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء إلغاء المسودة')
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className="bg-amber-950/40 border border-amber-600/50 rounded-xl p-4 sm:p-5 print:hidden space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
            <h3 className="font-bold text-amber-200 text-lg">فاتورة مشتريات مسودة (غير معتمدة)</h3>
          </div>
          <p className="text-sm text-slate-300 mt-1">
            هذه الفاتورة محفوظة كمسودة فقط، ولم يتم ترحيل بنودها إلى المخزون أو تسجيل أثرها المالي في الحسابات حتى الآن.
          </p>
        </div>

        {!confirming && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={() => {
                setError(null)
                setConfirming('post')
              }}
              className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <span>✓</span>
              <span>اعتماد وترحيل الفاتورة</span>
            </button>
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={() => {
                setError(null)
                setConfirming('cancel')
              }}
              className="px-4 py-2.5 rounded-lg bg-rose-700/80 hover:bg-rose-600 text-white font-semibold text-sm transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <span>✕</span>
              <span>إلغاء المسودة</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-rose-950/80 border border-rose-500/60 rounded-lg p-3 text-sm text-rose-200">
          ⚠️ {error}
        </div>
      )}

      {confirming === 'post' && (
        <div className="bg-slate-900 border border-emerald-500/50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-slate-200 font-medium">
            هل أنت متأكد من اعتماد وترحيل فاتورة المشتريات رقم <strong className="text-emerald-400 font-mono">{invoiceNumber}</strong> بقيمة <strong className="text-emerald-400">{totalAmount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</strong>؟
            <br />
            <span className="text-xs text-slate-400 mt-1 block">
              سيتم فوراً: زيادة أرصدة الأصناف بالمخزون، تحديث تكلفة الشراء، تسجيل ذمة المورد، وإنشاء القيد المحاسبي.
            </span>
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={loadingAction === 'post'}
              onClick={handlePost}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow transition disabled:opacity-50 cursor-pointer"
            >
              {loadingAction === 'post' ? 'جارٍ الاعتماد والترحيل...' : 'نعم، اعتمد الفاتورة الآن'}
            </button>
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={() => setConfirming(null)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition cursor-pointer"
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      {confirming === 'cancel' && (
        <div className="bg-slate-900 border border-rose-500/50 rounded-lg p-4 space-y-3">
          <p className="text-sm text-slate-200 font-medium">
            هل أنت متأكد من إلغاء المسودة رقم <strong className="text-rose-400 font-mono">{invoiceNumber}</strong>؟
            <br />
            <span className="text-xs text-slate-400 mt-1 block">
              سيتم تحويل حالة الفاتورة إلى «ملغاة» ولن يكون لها أي أثر محاسبي أو مخزني.
            </span>
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={loadingAction === 'cancel'}
              onClick={handleCancel}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow transition disabled:opacity-50 cursor-pointer"
            >
              {loadingAction === 'cancel' ? 'جارٍ الإلغاء...' : 'نعم، ألغِ المسودة'}
            </button>
            <button
              type="button"
              disabled={loadingAction !== null}
              onClick={() => setConfirming(null)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition cursor-pointer"
            >
              تراجع
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
