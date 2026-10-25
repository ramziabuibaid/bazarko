import Link from 'next/link'
import PrintButton from '@/components/dashboard/PrintButton'
import PurchaseDocument, { type PurchaseStore } from './PurchaseDocument'
import PurchaseDraftActions from './PurchaseDraftActions'
import { type Purchase, type PurchaseItem, purchaseRemaining } from '@/lib/purchases/presentation'

export default function PurchaseDetail({
  purchase,
  items,
  store,
  vouchers,
  printOnly = false,
}: {
  purchase: Purchase
  items: PurchaseItem[]
  store: PurchaseStore
  vouchers: { id: string; voucher_number: string; amount: number; date: string; payment_method: string }[]
  printOnly?: boolean
}) {
  const paid = Number(purchase.paid_amount)
  const linked = vouchers.reduce((s, v) => s + Number(v.amount), 0)
  const lineTotal = items.reduce((s, i) => s + Number(i.total_price), 0)
  const mismatch =
    Math.abs(lineTotal - Number(purchase.subtotal)) > 0.005 ||
    Math.abs(Number(purchase.subtotal) - Number(purchase.discount) + Number(purchase.tax_amount) - Number(purchase.total_amount)) > 0.005

  return (
    <main dir="rtl" className="p-4 sm:p-6 text-slate-100 space-y-5">
      <header className="flex flex-wrap justify-between items-center gap-3 print:hidden">
        <div>
          <Link href="/dashboard/purchases" className="text-sky-300">
            ← العودة لفواتير المشتريات
          </Link>
          <h1 className="text-2xl font-bold mt-3">{printOnly ? 'طباعة فاتورة مشتريات' : 'تفاصيل فاتورة المشتريات'}</h1>
        </div>
        <div className="flex items-center gap-2">
          {purchase.status !== 'cancelled' && (
            <Link
              href={`/dashboard/purchases/${purchase.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-600/20 px-3.5 py-2 text-xs font-bold text-sky-200 hover:bg-sky-600/30 transition shadow-sm"
            >
              <span>✏️</span> تعديل الفاتورة
            </Link>
          )}
          <PrintButton
            elementId="purchase-document"
            label="طباعة الفاتورة PDF"
            filename={`purchase-${purchase.invoice_number.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`}
          />
        </div>
      </header>

      {!printOnly && purchase.status === 'draft' && store.id && (
        <PurchaseDraftActions
          storeId={store.id}
          purchaseId={purchase.id}
          invoiceNumber={purchase.invoice_number}
          totalAmount={Number(purchase.total_amount)}
          currency={purchase.currency}
        />
      )}

      {!printOnly && (
        <section className="bg-slate-900 border border-slate-700 rounded-xl p-5 print:hidden">
          <h2 className="font-bold">الترحيل والدفعات المرتبطة</h2>
          <p className="text-sm text-slate-400 mt-3">
            {purchase.journal_entry_id ? 'يوجد قيد محاسبي مرتبط.' : 'لا يوجد قيد محاسبي مرتبط بهذه الفاتورة.'}
          </p>
          {mismatch && (
            <p role="alert" className="text-amber-300 mt-3">
              توجد فروق بين البنود أو الملخص المسجل؛ راجع الفاتورة قبل الاعتماد على أرقامها.
            </p>
          )}
          {purchase.status === 'completed' && (Math.abs(linked - paid) > 0.005 || paid < 0 || purchaseRemaining(purchase) < 0) && (
            <p role="alert" className="text-amber-300 mt-3">
              المدفوع المسجل لا يتطابق مع سندات الصرف المرتبطة أو يتجاوز الإجمالي. قد توجد دفعات قديمة غير مربوطة؛ يلزم مراجعتها.
            </p>
          )}
          {purchase.status === 'cancelled' && (
            <p className="text-rose-400 mt-3 font-semibold">هذه الفاتورة ملغاة ولا يوجد لها أي أثر محاسبي أو مخزني.</p>
          )}
          {purchase.status === 'draft' && (
            <p className="text-amber-300 mt-3">
              الفاتورة مسودة حالياً؛ يمكنك اعتمادها وترحيلها أو إلغاؤها من الأزرار المتاحة في الأعلى.
            </p>
          )}
          <ul className="mt-4 space-y-2">
            {vouchers.map((v) => (
              <li key={v.id}>
                <Link className="text-sky-300" href={`/dashboard/accounting/payments/print/${v.id}`}>
                  {v.voucher_number}
                </Link>{' '}
                · {v.date} · {Number(v.amount).toLocaleString('en-GB')} {purchase.currency}
              </li>
            ))}
          </ul>
          {!vouchers.length && purchase.status === 'completed' && (
            <p className="text-sm text-slate-400 mt-3">لا توجد سندات صرف مرتبطة.</p>
          )}
        </section>
      )}

      <PurchaseDocument purchase={purchase} items={items} store={store} />
    </main>
  )
}

