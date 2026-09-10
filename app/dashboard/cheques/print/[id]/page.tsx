import PrintButton from "@/components/dashboard/PrintButton"
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { tafqeet } from '@/lib/tafqeet'

export const metadata = {
  title: 'طباعة مستند وسجل الشيك — Bazarko ERP',
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

  const STATUS_LABELS: Record<string, string> = {
    in_portfolio: 'في الحافظة (جاهز)',
    deposited: 'برسم التحصيل لدى البنك',
    collected: 'محصل ومودع في الحساب',
    bounced: 'راجع / مرتد',
    endorsed: 'مجيّر لمورد',
    returned_to_drawer: 'معاد للساحب',
    returned_to_customer: 'معاد للعميل',
    supplier_returned: 'معاد من المورد',
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 text-slate-900 font-sans print:p-0 print:bg-white">
      {/* ── Toolbar (Hidden on Print) ── */}
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl bg-slate-900 p-4 text-white shadow-lg print:hidden">
        <Link
          href="/dashboard/cheques"
          className="flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white transition"
        >
          ← العودة لمحفظة الشيكات
        </Link>
        <div className="flex items-center gap-3">
          <PrintButton label="🖨️ طباعة المستند (Print / PDF)" className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition" />
        </div>
      </div>

      {/* ── Official Paper Document ── */}
      <div className="mx-auto max-w-4xl rounded-xl border border-slate-300 bg-white p-8 shadow-sm print:border-none print:shadow-none print:p-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-6">
          <div className="text-right">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">{store.name}</h1>
            <p className="text-xs text-slate-600 mt-1">{store.address || 'فلسطين'}</p>
            {store.phone && <p className="text-xs text-slate-600">هاتف: {store.phone}</p>}
            {store.tax_number && <p className="text-xs text-slate-600">الرقم الضريبي: {store.tax_number}</p>}
          </div>

          <div className="text-center">
            <div className="inline-block rounded-xl border-2 border-slate-900 bg-slate-50 px-6 py-2">
              <h2 className="text-lg font-black text-slate-900">
                {check.type === 'received' ? 'سند استلام وسجل شيك وارد' : 'سند إصدار وسجل شيك صادر'}
              </h2>
              <p className="font-mono text-sm font-bold text-slate-700 mt-0.5">#{check.check_number}</p>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              تاريخ الطباعة: {new Date().toLocaleDateString('en-GB')}
            </p>
          </div>

          <div className="text-left font-mono text-xs">
            <p><span className="text-slate-500">حالة الشيك:</span> <span className="font-bold text-slate-900">{STATUS_LABELS[check.status] || check.status}</span></p>
            <p className="mt-1"><span className="text-slate-500">تاريخ التحرير:</span> {new Date(check.issue_date).toLocaleDateString('en-GB')}</p>
            <p className="mt-1"><span className="text-slate-500">تاريخ الاستحقاق:</span> <span className="font-bold text-rose-700">{new Date(check.due_date).toLocaleDateString('en-GB')}</span></p>
          </div>
        </div>

        {/* Amount Big Box */}
        <div className="my-6 rounded-xl border-2 border-slate-800 bg-slate-50 p-4 text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">المبلغ الإجمالي للشيك</p>
          <p className="mt-1 text-3xl font-black text-slate-900 font-mono">
            {Number(check.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {check.currency}
          </p>
          <p className="mt-2 text-sm font-bold text-slate-800">
            فقط {tafqeet(Number(check.amount), check.currency)} لا غير.
          </p>
          {check.currency !== 'ILS' && (
            <p className="mt-1 text-xs text-slate-500 font-mono">
              المعادل بالشيكل بسعر صرف ({check.exchange_rate}): {Number(check.amount_ils).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪
            </p>
          )}
        </div>

        {/* Cheque & Bank Metadata Grid */}
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="rounded-lg border border-slate-200 p-3.5 space-y-2 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 border-b pb-1 text-sm">بيانات البنك والفرع (PMA)</h3>
            <p><span className="text-slate-500">اسم البنك:</span> <span className="font-bold text-slate-900">{check.bank_name}</span> (كود: {check.bank_code || '—'})</p>
            <p><span className="text-slate-500">الفرع:</span> <span className="font-semibold text-slate-900">{check.branch_name || 'الفرع الرئيسي'}</span> (كود: {check.branch_code || '—'})</p>
            <p><span className="text-slate-500">رقم حساب الشيك:</span> <span className="font-mono text-slate-900">{check.account_number || '—'}</span></p>
            {check.deposit_bank && (
              <p><span className="text-slate-500">بنك الإيداع والتحصيل:</span> <span className="font-semibold text-sky-800">{check.deposit_bank.bank_name} - {check.deposit_bank.account_number}</span></p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-3.5 space-y-2 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 border-b pb-1 text-sm">أطراف الشيك والجهات المرتبطة</h3>
            <p><span className="text-slate-500">الساحب (المحرر):</span> <span className="font-bold text-slate-900">{check.drawer_name || '—'}</span></p>
            <p><span className="text-slate-500">المستفيد:</span> <span className="font-bold text-slate-900">{check.payee_name || '—'}</span></p>
            {check.customer && (
              <p><span className="text-slate-500">العميل المقيد لحسابه:</span> <span className="font-bold text-slate-900">{check.customer.name}</span></p>
            )}
            {check.supplier && (
              <p><span className="text-slate-500">المورد المقيد لحسابه:</span> <span className="font-bold text-slate-900">{check.supplier.name}</span></p>
            )}
          </div>
        </div>

        {/* Audit Trail / Operations History */}
        <div className="mt-6">
          <h3 className="text-sm font-bold text-slate-900 border-b pb-2 mb-3">
            سجل العمليات وحركات الشيك (Audit Trail)
          </h3>
          <table className="w-full text-right text-xs border border-slate-200">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b">
                <th className="p-2.5 font-bold">التاريخ</th>
                <th className="p-2.5 font-bold">نوع العملية</th>
                <th className="p-2.5 font-bold">من حالة</th>
                <th className="p-2.5 font-bold">إلى حالة</th>
                <th className="p-2.5 font-bold">الجهة المستهدفة</th>
                <th className="p-2.5 font-bold">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {operations && operations.length > 0 ? (
                operations.map((op: any) => (
                  <tr key={op.id}>
                    <td className="p-2 font-mono">{new Date(op.operation_date).toLocaleDateString('en-GB')}</td>
                    <td className="p-2 font-semibold text-slate-900">{op.operation_type}</td>
                    <td className="p-2 text-slate-600">{STATUS_LABELS[op.from_status] || op.from_status}</td>
                    <td className="p-2 font-bold text-slate-900">{STATUS_LABELS[op.to_status] || op.to_status}</td>
                    <td className="p-2">
                      {op.target_bank && `بنك: ${op.target_bank.bank_name}`}
                      {op.target_supplier && `مورد: ${op.target_supplier.name}`}
                      {!op.target_bank && !op.target_supplier && '—'}
                    </td>
                    <td className="p-2 text-slate-600">{op.notes || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-slate-500">
                    تم إدراج الشيك بالحافظة ولم تتم عليه عمليات لاحقة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Cheque Image on Document if present */}
        {check.images && check.images.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <h3 className="text-xs font-bold text-slate-700 mb-2">صورة الشيك المرفقة:</h3>
            <div className="flex gap-4">
              {check.images.map((imgUrl: string, idx: number) => (
                <div key={idx} className="h-36 w-64 overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgUrl} alt={`شيك ${idx + 1}`} className="h-full w-full object-contain" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Official Signatures Section */}
        <div className="mt-12 grid grid-cols-4 gap-4 border-t-2 border-slate-900 pt-6 text-center text-xs font-bold text-slate-800">
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
