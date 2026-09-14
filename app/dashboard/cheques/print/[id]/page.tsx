import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeet } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة بطاقة وسند الشيك — Bazarko ERP',
}

export default async function ChequePrintPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) redirect('/onboarding')

  const [
    { data: store },
    { data: check },
    { data: operations }
  ] = await Promise.all([
    supabase.from('stores').select('*').eq('id', storeId).single(),
    supabase
      .from('checks')
      .select('*, customer:customers(id, name, phone, national_id), supplier:suppliers(id, name, phone), deposit_bank:bank_accounts(id, bank_name, account_number, branch_name)')
      .eq('id', params.id)
      .eq('store_id', storeId)
      .single(),
    supabase
      .from('check_operations')
      .select('*, target_bank:bank_accounts(bank_name, account_number), target_supplier:suppliers(name)')
      .eq('check_id', params.id)
      .eq('store_id', storeId)
      .order('created_at', { ascending: true })
  ])

  if (!check || !store) notFound()

  const STATUS_DETAILS: Record<string, { label: string; en: string; color: string; border: string; bg: string }> = {
    in_portfolio: {
      label: check.type === 'received' ? 'وارد - بالحافظة / بالصندوق' : 'صادر - بالحافظة',
      en: 'IN PORTFOLIO / ON HAND',
      color: 'text-amber-800',
      border: 'border-amber-700',
      bg: 'bg-amber-50',
    },
    deposited: {
      label: 'مودع برسم التحصيل بالبنك',
      en: 'DEPOSITED FOR COLLECTION',
      color: 'text-sky-800',
      border: 'border-sky-700',
      bg: 'bg-sky-50',
    },
    collected: {
      label: 'محصّل ومودع بالحساب البنكي',
      en: 'COLLECTED & CLEARED',
      color: 'text-emerald-800',
      border: 'border-emerald-700',
      bg: 'bg-emerald-50',
    },
    bounced: {
      label: 'راجع / مرتد من البنك (مرتجع)',
      en: 'BOUNCED / RETURNED CHEQUE',
      color: 'text-rose-800',
      border: 'border-rose-700',
      bg: 'bg-rose-50',
    },
    endorsed: {
      label: 'مجيّر ومحوّل إلى مورد',
      en: 'ENDORSED TO THIRD PARTY',
      color: 'text-purple-800',
      border: 'border-purple-700',
      bg: 'bg-purple-50',
    },
    returned_to_drawer: {
      label: 'معاد ومسلّم للساحب',
      en: 'RETURNED TO DRAWER',
      color: 'text-slate-800',
      border: 'border-slate-700',
      bg: 'bg-slate-50',
    },
    returned_to_customer: {
      label: 'معاد ومسلّم للعميل',
      en: 'RETURNED TO CUSTOMER',
      color: 'text-slate-800',
      border: 'border-slate-700',
      bg: 'bg-slate-50',
    },
    supplier_returned: {
      label: 'معاد ومسترجع من المورد',
      en: 'RETURNED FROM SUPPLIER',
      color: 'text-orange-800',
      border: 'border-orange-700',
      bg: 'bg-orange-50',
    },
  }

  const statusInfo = STATUS_DETAILS[check.status] || {
    label: check.status,
    en: check.status,
    color: 'text-slate-900',
    border: 'border-slate-900',
    bg: 'bg-slate-100',
  }

  const hasImages = check.images && check.images.length > 0
  const primaryImage = hasImages ? check.images[0] : null

  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar (Hidden on Print) ── */}
      <div className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-4 text-white shadow-xl print:hidden">
        <Link
          href="/dashboard/cheques"
          className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لمحفظة الشيكات
        </Link>
        <div className="flex items-center gap-3">
          <PrintButton
            label="🖨️ طباعة المستند (Print / PDF)"
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition shadow"
          />
        </div>
      </div>

      {/* ── Official Printable Document Layout ── */}
      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white p-6 sm:p-8 shadow-md print:border-none print:shadow-none print:p-2 print:max-w-none">
        
        {/* Document Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
          <div className="text-right">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: <span dir="ltr">{store.phone}</span></p>}
            {store.tax_number && <p className="text-xs text-slate-600">الرقم الضريبي: {store.tax_number}</p>}
          </div>

          <div className="text-center">
            <div className="inline-block rounded-xl border-2 border-slate-900 bg-slate-50 px-6 py-2 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">
                {check.type === 'received' ? 'سند استلام وبطاقة شيك وارد' : 'سند صرف وبطاقة شيك صادر'}
              </h2>
              <p className="font-mono text-base font-bold text-slate-800 mt-0.5" dir="ltr">
                #{check.check_number}
              </p>
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-slate-500">
              تاريخ الطباعة: {new Date().toLocaleDateString('ar-u-nu-latn')}
            </p>
          </div>

          {/* Official Bank Stamp of Current Cheque Status */}
          <div className="text-left">
            <div className={`inline-block rotate-[-3deg] rounded-lg border-2 ${statusInfo.border} ${statusInfo.bg} px-3.5 py-1.5 text-center shadow-sm`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">حالة الشيك الحالية</p>
              <p className={`text-xs font-black ${statusInfo.color}`}>{statusInfo.label}</p>
              <p className="text-[9px] font-semibold text-slate-600 tracking-wider mt-0.5" dir="ltr">{statusInfo.en}</p>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════ */}
        {/* CHEQUE SPECIMEN & IMAGE SECTION — صورة الشيك المرفقة      */}
        {/* ══════════════════════════════════════════════════════════ */}
        <div className="my-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-300 mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>🖼️</span> صورة ومواصفات الشيك البنكي المرفقة
            </h3>
            {hasImages ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                ✓ تم إرفاق الصورة الأصلية
              </span>
            ) : (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                نموذج إلكتروني (لم تُرفق صورة ضوئية)
              </span>
            )}
          </div>

          {hasImages ? (
            /* High-resolution Real Cheque Image View */
            <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 shadow-inner">
              <div className="relative overflow-hidden rounded-lg border border-slate-400 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={primaryImage!}
                  alt={`صورة شيك ${check.check_number}`}
                  className="max-h-[340px] w-full object-contain mx-auto"
                />
              </div>
              {check.images.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto print:hidden">
                  {check.images.slice(1).map((imgUrl: string, idx: number) => (
                    <div key={idx} className="h-20 w-36 shrink-0 overflow-hidden rounded border border-slate-300">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgUrl} alt="" className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Styled Realistic Cheque Voucher Mockup */
            <div className="rounded-xl border-2 border-dashed border-sky-300 bg-gradient-to-r from-sky-50 to-indigo-50/40 p-6">
              <div className="flex justify-between items-start border-b border-sky-200 pb-3">
                <div>
                  <p className="text-lg font-black text-sky-950">{check.bank_name}</p>
                  <p className="text-xs text-sky-800">{check.branch_name || 'الفرع الرئيسي'}</p>
                </div>
                <div className="text-left font-mono">
                  <span className="text-xs text-slate-600">تاريخ الاستحقاق:</span>
                  <p className="text-base font-black text-rose-700" dir="ltr">
                    {new Date(check.due_date).toLocaleDateString('ar-u-nu-latn')}
                  </p>
                </div>
              </div>

              <div className="my-4 space-y-2 text-sm">
                <div className="flex justify-between border-b border-dotted border-sky-200 pb-1">
                  <span className="text-slate-600 font-medium">ادفعوا لأمر:</span>
                  <span className="font-bold text-slate-900">{check.payee_name || store.name}</span>
                </div>
                <div className="flex justify-between border-b border-dotted border-sky-200 pb-1">
                  <span className="text-slate-600 font-medium">مبلغ وقدره:</span>
                  <span className="font-bold text-slate-900">{tafqeet(Number(check.amount), check.currency)}</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <div className="rounded-lg border-2 border-slate-900 bg-white px-4 py-2 font-mono text-xl font-black text-slate-950">
                    {Number(check.amount).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} {check.currency}
                  </div>
                  <div className="text-left">
                    <p className="text-xs text-slate-500 font-mono">توقيع الساحب:</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{check.drawer_name || '—'}</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 border-t border-sky-200 pt-2 text-center font-mono text-xs tracking-widest text-slate-600" dir="ltr">
                ⑈{check.bank_code || '00'}⑈ ⑆{check.branch_code || '000'}⑆ {check.account_number || '0000000'}⑈ {check.check_number}⑈
              </div>
            </div>
          )}
        </div>

        {/* Amount Big Box */}
        <div className="my-5 rounded-xl border-2 border-slate-800 bg-slate-50 p-4 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">القيمة المالية للشيك</p>
          <p className="mt-1 text-3xl font-black text-slate-900 font-mono" dir="ltr">
            {Number(check.amount).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} {check.currency}
          </p>
          <p className="mt-1.5 text-sm font-bold text-slate-800">
            فقط {tafqeet(Number(check.amount), check.currency)} لا غير.
          </p>
          {check.currency !== 'ILS' && (
            <p className="mt-1 text-xs text-slate-500 font-mono">
              المعادل بالشيكل بسعر صرف ({check.exchange_rate}): {Number(check.amount_ils).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2 })} ₪
            </p>
          )}
        </div>

        {/* Cheque & Bank Metadata Grid */}
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="rounded-lg border border-slate-200 p-3.5 space-y-2 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 border-b pb-1 text-sm flex items-center justify-between">
              <span>بيانات البنك والفرع</span>
              <span className="font-mono text-slate-500 text-xs">PMA Directory</span>
            </h3>
            <p><span className="text-slate-500">اسم البنك المسحوب عليه:</span> <span className="font-bold text-slate-900">{check.bank_name}</span> {check.bank_code && `(كود: ${check.bank_code})`}</p>
            <p><span className="text-slate-500">الفرع:</span> <span className="font-semibold text-slate-900">{check.branch_name || 'الفرع الرئيسي'}</span> {check.branch_code && `(كود: ${check.branch_code})`}</p>
            <p><span className="text-slate-500">رقم حساب الشيك:</span> <span className="font-mono font-bold text-slate-900" dir="ltr">{check.account_number || '—'}</span></p>
            {check.deposit_bank && (
              <p><span className="text-slate-500">حساب الإيداع الخاص بالشركة:</span> <span className="font-semibold text-sky-800">{check.deposit_bank.bank_name} ({check.deposit_bank.account_number})</span></p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-3.5 space-y-2 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 border-b pb-1 text-sm">أطراف الشيك والجهات المرتبطة</h3>
            <p><span className="text-slate-500">الساحب (محرر الشيك):</span> <span className="font-bold text-slate-900">{check.drawer_name || '—'}</span></p>
            <p><span className="text-slate-500">المستفيد من الشيك:</span> <span className="font-bold text-slate-900">{check.payee_name || '—'}</span></p>
            {check.customer && (
              <p><span className="text-slate-500">العميل المقيد لحسابه:</span> <span className="font-bold text-slate-900">{check.customer.name} {check.customer.phone && `(${check.customer.phone})`}</span></p>
            )}
            {check.supplier && (
              <p><span className="text-slate-500">المورد المقيد لحسابه:</span> <span className="font-bold text-slate-900">{check.supplier.name}</span></p>
            )}
            <p><span className="text-slate-500">تاريخ التحرير:</span> <span className="font-medium" dir="ltr">{new Date(check.issue_date).toLocaleDateString('ar-u-nu-latn')}</span></p>
            <p><span className="text-slate-500">تاريخ الاستحقاق:</span> <span className="font-black text-rose-700" dir="ltr">{new Date(check.due_date).toLocaleDateString('ar-u-nu-latn')}</span></p>
          </div>
        </div>

        {/* Audit Trail / Operations History */}
        {operations && operations.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-bold text-slate-900 border-b pb-1.5 mb-2.5">
              سجل العمليات والتحركات على الشيك
            </h3>
            <table className="w-full text-right text-xs border border-slate-200">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b">
                  <th className="p-2 font-bold">التاريخ</th>
                  <th className="p-2 font-bold">نوع العملية</th>
                  <th className="p-2 font-bold">من حالة</th>
                  <th className="p-2 font-bold">إلى حالة</th>
                  <th className="p-2 font-bold">الجهة المستهدفة</th>
                  <th className="p-2 font-bold">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {operations.map((op: any) => (
                  <tr key={op.id}>
                    <td className="p-2 font-mono">{new Date(op.operation_date).toLocaleDateString('ar-u-nu-latn')}</td>
                    <td className="p-2 font-semibold text-slate-900">{op.operation_type}</td>
                    <td className="p-2 text-slate-600">{STATUS_DETAILS[op.from_status]?.label || op.from_status}</td>
                    <td className="p-2 font-bold text-slate-900">{STATUS_DETAILS[op.to_status]?.label || op.to_status}</td>
                    <td className="p-2">
                      {op.target_bank && `بنك: ${op.target_bank.bank_name}`}
                      {op.target_supplier && `مورد: ${op.target_supplier.name}`}
                      {!op.target_bank && !op.target_supplier && '—'}
                    </td>
                    <td className="p-2 text-slate-600">{op.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Official Signatures Section */}
        <div className="mt-10 grid grid-cols-4 gap-4 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
          <div>
            <p className="text-slate-500 mb-8">منشئ السند</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">أمين الصندوق / الحافظة</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المحاسب المالي</p>
            <p className="border-t border-dotted border-slate-400 pt-1">التوقيع</p>
          </div>
          <div>
            <p className="text-slate-500 mb-8">المدير العام / الاعتماد</p>
            <p className="border-t border-dotted border-slate-400 pt-1">الختم والتوقيع</p>
          </div>
        </div>

      </div>
    </div>
  )
}
