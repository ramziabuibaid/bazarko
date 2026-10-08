import ReceiptAttachments from '@/components/dashboard/receipts/ReceiptAttachments'
import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeetCheque } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة سند قبض مالي — Bazarko ERP',
}

export default async function PrintReceiptPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: voucher },
    { data: dbChecks }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase.from('vouchers').select('*, invoices(invoice_number), cash_boxes(name), bank_accounts(bank_name,account_number)').eq('id', params.id).eq('store_id', storeId).eq('type', 'receipt').single(),
    supabase.from('checks').select('check_number, bank_name, bank_code, branch_name, branch_code, account_number, drawer_name, amount, due_date').eq('voucher_id', params.id).eq('store_id', storeId)
  ])

  if (!store || !voucher) notFound()

  // If customer is attached, get full customer details
  let customer: any = null
  if (voucher.customer_id) {
    const { data: custData } = await supabase
      .from('customers')
      .select('*')
      .eq('id', voucher.customer_id)
      .single()
    customer = custData
  }

  const {data:canManageFiles}=voucher.payment_method==='bank'?await supabase.rpc('can_manage_cash_permissions',{p_store_id:storeId}):{data:false}
  const amount = Number(voucher.amount || 0)
  const currency = store.currency_code || 'ILS'
  const tafqeetText = tafqeetCheque(amount, currency)

  const paymentMethodLabel: Record<string, string> = {
    cash: 'نقداً',
    bank: 'تحويل بنكي',
    card: 'بطاقة ائتمانية',
    transfer: 'تحويل إلكتروني',
    cheque: 'شيكات مصرفية',
    split: 'نقدي + شيكات (دفع مركب)',
  }

  const rawChecks: any[] = (voucher.checks_data && voucher.checks_data.length > 0)
    ? voucher.checks_data
    : (dbChecks || [])

  const checks = rawChecks.map((chk: any) => {
    const matchingDbCheck = (dbChecks || []).find((dc: any) => String(dc.check_number) === String(chk.check_number))
    return {
      ...chk,
      bank_code: chk.bank_code || matchingDbCheck?.bank_code || null,
      branch_code: chk.branch_code || matchingDbCheck?.branch_code || null,
      branch_name: chk.branch_name || matchingDbCheck?.branch_name || null,
    }
  })

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      {/* ── Top Toolbar ── */}
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/accounting/receipts"
          className="text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لسندات القبض
        </Link>
        <PrintButton
          elementId="receipt-print-canvas"
          filename={`سند-قبض-${voucher.voucher_number}.pdf`}
          label="🖨️ طباعة السند (Print / PDF)"
          className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition"
        />
      </div>

      {canManageFiles&&<div className="mx-auto max-w-3xl mb-6 print:hidden"><ReceiptAttachments storeId={storeId} voucherId={voucher.id}/></div>}
      {/* ── Official Paper Canvas ── */}
      <div id="receipt-print-canvas" className="mx-auto max-w-3xl rounded-2xl border-2 border-slate-900 bg-white p-8 shadow-md print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div className="flex items-center gap-4">
            {store.logo_url && (
              <img
                src={store.logo_url}
                alt={store.name}
                className="h-16 w-16 rounded-xl object-contain border border-slate-200"
              />
            )}
            <div>
              <h1 className="text-2xl font-black text-slate-950">{store.name}</h1>
              <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
              {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-xl font-black text-emerald-900 border-2 border-emerald-900 px-6 py-1.5 rounded-xl inline-block bg-emerald-50">
              سند قبض مالي (Receipt Voucher)
            </h2>
            <p className="mt-1 font-mono text-sm font-bold text-slate-900" dir="ltr">
              No: {voucher.voucher_number}
            </p>
          </div>

          <div className="text-left text-xs space-y-1 font-mono">
            <div>التاريخ: <strong className="text-slate-900">{new Date(voucher.date).toLocaleDateString('en-GB')}</strong></div>
            <div>الوقت: <strong className="text-slate-900">{new Date(voucher.created_at || voucher.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong></div>
          </div>
        </div>

      {voucher.bank_accounts&&<p className="mx-auto max-w-3xl mb-4 rounded-xl bg-sky-50 p-4 text-sm">الحساب البنكي: {voucher.bank_accounts.bank_name} — {voucher.bank_accounts.account_number} · مرجع التحويل: {voucher.reference}</p>}
        {/* Voucher Body */}
        <div className="my-6 space-y-4 text-sm">
          {/* Received From */}
          <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
            <span className="font-bold text-slate-700 min-w-36">وصلنا من السيد / السادة:</span>
            <span className="flex-1 font-bold text-base text-slate-950 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              {voucher.party_name || customer?.name || 'مقبوض عام / نقدي'}
            </span>
          </div>

          {/* Amount Number & Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
              <span className="font-bold text-slate-700 min-w-36">مبلغاً وقدره بالأرقام:</span>
              <span className="font-mono font-black text-lg text-emerald-900 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200" dir="ltr">
                {amount.toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
              </span>
            </div>

            <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
              <span className="font-bold text-slate-700">طريقة الدفع والقبض:</span>
              <span className="font-bold text-slate-900 bg-slate-50 px-3 py-1 rounded-lg border border-slate-200">
                {paymentMethodLabel[voucher.payment_method] || voucher.payment_method}
              </span>
            </div>
          </div>

          {/* Breakdown for Cash & Cheques if Split or Cheque */}
          {(voucher.payment_method === 'split' || voucher.payment_method === 'cheque') && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <h4 className="text-xs font-black text-slate-800 border-b border-slate-200 pb-1.5">
                تفاصيل وسائل القبض المرفقة بالسند:
              </h4>

              {voucher.cash_amount > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">المبلغ المقبوض نقداً:</span>
                  <span className="font-mono font-bold text-slate-950" dir="ltr">
                    {Number(voucher.cash_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
                  </span>
                </div>
              )}

              {checks.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-bold text-xs text-slate-700 block">بيانات الشيكات:</span>
                  <table className="w-full text-right text-xs border border-slate-200 bg-white">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                        <th className="p-1.5">رقم الشيك</th>
                        <th className="p-1.5">البنك والفرع</th>
                        <th className="p-1.5">كود البنك / الفرع</th>
                        <th className="p-1.5">تاريخ الاستحقاق</th>
                        <th className="p-1.5">الساحب</th>
                        <th className="p-1.5 text-left">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {checks.map((chk: any, idx: number) => (
                        <tr key={idx}>
                          <td className="p-1.5 font-bold" dir="ltr">{chk.check_number}</td>
                          <td className="p-1.5 font-sans">
                            <span className="font-semibold">{chk.bank_name}</span>
                            {chk.branch_name && <span className="text-slate-500 text-[11px] block">{chk.branch_name}</span>}
                          </td>
                          <td className="p-1.5 font-mono text-[11px]" dir="ltr">
                            {chk.bank_code ? (
                              <span>
                                {chk.bank_code} {chk.branch_code ? `/ ${chk.branch_code}` : ''}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-1.5">{chk.due_date}</td>
                          <td className="p-1.5 font-sans">{chk.drawer_name || '—'}</td>
                          <td className="p-1.5 text-left font-bold" dir="ltr">
                            {Number(chk.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Tafqeet Words */}
          <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
            <span className="font-bold text-slate-700 min-w-36 pt-1">المبلغ كتابة بالحروف:</span>
            <span className="flex-1 font-bold text-slate-900 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 leading-relaxed">
              {tafqeetText}
            </span>
          </div>

          {/* Purpose / Description */}
          <div className="flex items-start gap-3 border-b border-slate-200 pb-3">
            <span className="font-bold text-slate-700 min-w-36 pt-1">وذلك لقاء (البيان):</span>
            <span className="flex-1 font-medium text-slate-900 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 min-h-[50px] whitespace-pre-line">
              {voucher.description || '—'}
            </span>
          </div>

          {/* Reference / Category / Linked Invoice */}
          <div className="grid grid-cols-3 gap-4 text-xs">
            {voucher.invoices?.invoice_number ? (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-bold">الفاتورة المسددة:</span>
                <span className="font-mono font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200" dir="ltr">
                  {voucher.invoices.invoice_number}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-bold">الربط:</span>
                <span className="text-slate-600 font-medium">قيد مباشر على كشف الحساب</span>
              </div>
            )}
            {voucher.reference && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-bold">رقم المرجع:</span>
                <span className="font-mono text-slate-800" dir="ltr">{voucher.reference}</span>
              </div>
            )}
            {voucher.category && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-bold">التصنيف المحاسبي:</span>
                <span className="text-slate-800 font-semibold">{voucher.category}</span>
              </div>
            )}
          </div>
        </div>

        {/* Official Signatures Box */}
        <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-3 gap-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-10">تنظيم المحاسب</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-10">أمين الصندوق / المستلم</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-10">توقيع المسلّم / الدافع</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3">
          تم إصدار هذا السند عبر نظام بازاركو (Bazarko Palestine ERP) • تاريخ الطباعة: {new Date().toLocaleDateString('en-GB')}
        </div>
      </div>
    </div>
  )
}
