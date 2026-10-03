import {getCustomerStatement} from '@/app/dashboard/customers/ledger/customer-statement-actions'
import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export const metadata = {
  title: 'طباعة كشف حساب زبون — Bazarko ERP',
}

interface Props {
  params: { id: string }
  searchParams?: { from?: string; to?: string }
}

export default async function PrintCustomerStatementPage({ params, searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const fromDate = searchParams?.from || ''
  const toDate = searchParams?.to || ''

  const result=await getCustomerStatement(params.id,fromDate||undefined,toDate||undefined)
  if(!result.success||!result.store||!result.customer)return <div role="alert" className="rounded-xl border border-rose-500/30 p-6 text-rose-300">{result.error||'تعذر تحميل كشف الحساب'} <Link href="/dashboard/customers/ledger">العودة لحسابات العملاء</Link></div>
  const store=result.store,customer=result.customer
  const currency=store.currency_code||'ILS'
  const fmt=(n:number)=>Number(n||0).toLocaleString('ar-u-nu-latn',{minimumFractionDigits:2,maximumFractionDigits:2})
  const {openingBalance,totalDebit:totalPeriodDebit,totalCredit:totalPeriodCredit,closingBalance:finalBalance}=result
  const rows=result.rows.map(row=>({...row,notes:row.description}))
  const cleanPhone = customer.phone ? customer.phone.replace(/\D/g, '') : ''
  const waText = encodeURIComponent(
    `مرحباً ${customer.name} المحترم،\n` +
    `مرفق ملخص كشف الحساب المالي لدى ${store.name}:\n` +
    (fromDate || toDate ? `📅 الفترة: من ${fromDate || 'البداية'} إلى ${toDate || 'تاريخه'}\n` : '') +
    `📌 الرصيد الافتتاحي: ${fmt(openingBalance)} ${currency}\n` +
    `➕ إجمالي الحركات المدينة: ${fmt(totalPeriodDebit)} ${currency}\n` +
    `➖ إجمالي الحركات الدائنة: ${fmt(totalPeriodCredit)} ${currency}\n` +
    `⚖️ صافي الرصيد المستحق: ${fmt(finalBalance)} ${currency}\n\n` +
    `شاكرين حسن تعاونكم معنا 🙏`
  )

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background: #ffffff !important;
          }
          tr {
            page-break-inside: avoid !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}} />

      {!fromDate&&!toDate&&Math.abs(finalBalance-customer.balance)>0.01&&<p role="alert" className="mx-auto mb-4 max-w-4xl rounded-xl border border-amber-500 bg-amber-50 p-4 text-amber-950">رصيد الحركات {fmt(finalBalance)} {currency} يختلف عن رصيد العميل المسجل {fmt(customer.balance)} {currency}. راجع الأرصدة والحركات قبل اعتماد هذا الكشف.</p>}
      {/* ── شريط الأدوات العلوي ── */}
      <div className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-white shadow-xl print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/customers/ledger"
            className="text-xs font-bold text-slate-300 hover:text-white transition flex items-center gap-1.5"
          >
            <span>←</span>
            <span>كشوف حسابات العملاء</span>
          </Link>
          <span className="text-slate-600">|</span>
          <Link
            href={`/dashboard/customers/${customer.id}`}
            className="text-xs text-slate-400 hover:text-white transition"
          >
            ملف الزبون
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {cleanPhone && (
            <a
              href={`https://wa.me/${cleanPhone}?text=${waText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white transition flex items-center gap-1.5"
            >
              <span>💬</span>
              <span>مشاركة عبر واتساب</span>
            </a>
          )}
          <PrintButton
            label="🖨️ طباعة كشف الحساب الرسمى (PDF)"
            className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition shadow-sm"
          />
        </div>
      </div>

      {/* ── المستند الرسمي ── */}
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-0">
        {/* الترويسة الرئيسية */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div className="flex items-center gap-4">
            {store.logo_url ? (
              <img
                src={store.logo_url}
                alt={store.name}
                className="h-16 w-16 object-contain rounded-xl border border-slate-200 p-1"
              />
            ) : (
              <div className="h-14 w-14 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xl font-black">
                {store.name?.slice(0, 1) || 'B'}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-black text-slate-950">{store.name}</h1>
              <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
              {store.phone && <p className="text-xs text-slate-600 font-mono" dir="ltr">هاتف: {store.phone}</p>}
            </div>
          </div>

          <div className="text-center">
            <h2 className="text-xl font-black text-slate-900 border-2 border-slate-900 px-6 py-1.5 rounded-xl inline-block bg-slate-50 shadow-sm">
              كشف حساب عميل (Statement)
            </h2>
            <p className="mt-1.5 text-xs text-slate-500">
              تاريخ الطباعة: <span className="font-mono font-bold text-slate-800">{new Date().toISOString().slice(0, 10)}</span>
            </p>
          </div>

          <div className="text-left text-xs space-y-1 font-sans">
            <div>الفترة المحاسبية:</div>
            <div className="font-mono font-bold text-slate-900">
              {fromDate ? fromDate : 'البداية'} — {toDate ? toDate : 'حتى تاريخه'}
            </div>
            <div className="text-slate-500">العملة الأساسية: <strong>{currency}</strong></div>
          </div>
        </div>

        {/* بطاقة بيانات العميل والرصيد */}
        <div className="my-5 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div>
            <span className="text-slate-500 block mb-0.5">اسم العميل:</span>
            <strong className="text-slate-950 text-sm">{customer.name}</strong>
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5">رقم الهاتف:</span>
            <strong className="font-mono text-slate-900" dir="ltr">{customer.phone || '—'}</strong>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-slate-500 block mb-0.5">صافي الرصيد الحالي:</span>
            <strong className={`font-mono text-base ${finalBalance > 0 ? 'text-rose-700 font-black' : finalBalance < 0 ? 'text-emerald-700 font-black' : 'text-slate-700'}`} dir="ltr">
              {fmt(Math.abs(finalBalance))} {currency} {finalBalance > 0 ? '(مدين / عليه)' : finalBalance < 0 ? '(دائن / له)' : '(مسدد)'}
            </strong>
          </div>
        </div>

        {/* جدول الحركات التاريخية والتراكمية */}
        <table className="w-full text-right text-xs border border-slate-200">
          <thead>
            <tr className="bg-slate-900 text-white border-b">
              <th className="p-2.5 text-center">التاريخ</th>
              <th className="p-2.5">نوع المستند</th>
              <th className="p-2.5 text-center">رقم المرجع</th>
              <th className="p-2.5">البيان / الملاحظات</th>
              <th className="p-2.5 text-left">مدين (+)</th>
              <th className="p-2.5 text-left">دائن (-)</th>
              <th className="p-2.5 text-left bg-slate-800">الرصيد التراكمي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-slate-800">
            {/* سطر الرصيد الافتتاحي السابق */}
            {fromDate && (
              <tr className="bg-amber-50/50 font-bold border-b border-amber-200">
                <td className="p-2.5 text-center font-mono text-slate-600">{fromDate}</td>
                <td className="p-2.5" colSpan={3}>
                  📌 رصيد سابق ما قبل الفترة المحددة (Opening Balance)
                </td>
                <td className="p-2.5 text-left font-mono">{openingBalance > 0 ? fmt(openingBalance) : '—'}</td>
                <td className="p-2.5 text-left font-mono">{openingBalance < 0 ? fmt(Math.abs(openingBalance)) : '—'}</td>
                <td className="p-2.5 text-left font-mono font-black text-slate-950 bg-amber-50">
                  {fmt(openingBalance)} {currency}
                </td>
              </tr>
            )}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  لا توجد حركات مسجلة خلال الفترة المحددة
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2.5 text-center font-mono text-slate-600">{row.date}</td>
                  <td className="p-2.5 font-semibold text-slate-900">{row.type}</td>
                  <td className="p-2.5 text-center font-mono text-sky-900 font-bold" dir="ltr">{row.doc_no}</td>
                  <td className="p-2.5 text-slate-600 max-w-xs truncate">{row.notes}</td>
                  <td className="p-2.5 text-left font-mono font-bold text-slate-900" dir="ltr">
                    {row.debit > 0 ? fmt(row.debit) : '—'}
                  </td>
                  <td className="p-2.5 text-left font-mono font-bold text-emerald-700" dir="ltr">
                    {row.credit > 0 ? fmt(row.credit) : '—'}
                  </td>
                  <td className="p-2.5 text-left font-mono font-black text-slate-950 bg-slate-50" dir="ltr">
                    {fmt(row.balance)} {currency}
                  </td>
                </tr>
              ))
            )}
          </tbody>

          {/* تذييل الجدول والإجماليات */}
          <tfoot className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
            <tr>
              <td colSpan={4} className="p-3 text-right">إجمالي حركات الفترة المحددة:</td>
              <td className="p-3 text-left font-mono text-slate-950" dir="ltr">{fmt(totalPeriodDebit)} {currency}</td>
              <td className="p-3 text-left font-mono text-emerald-700" dir="ltr">{fmt(totalPeriodCredit)} {currency}</td>
              <td className="p-3 text-left font-mono font-black text-base text-sky-950 bg-slate-100" dir="ltr">
                {fmt(finalBalance)} {currency}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* التواقيع الرسمية وتأكيد الرصيد */}
        <div className="mt-14 pt-6 border-t-2 border-slate-900 grid grid-cols-2 gap-8 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">المحاسب المسؤول / تدقيق الحسابات</p>
            <p className="border-t border-dashed border-slate-400 pt-1">التوقيع والختم</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">مصادقة العميل على صحة الرصيد المذكور</p>
            <p className="border-t border-dashed border-slate-400 pt-1">توقيع العميل</p>
          </div>
        </div>

        <div className="mt-8 text-center text-[10px] text-slate-400 border-t border-slate-100 pt-3 font-mono">
          كشف حساب رسمي صادر من نظام بازاركو • تم التدقيق آلياً
        </div>
      </div>
    </div>
  )
}
