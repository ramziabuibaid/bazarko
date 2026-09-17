'use client'

interface ChequeData {
  id: string
  document: string
  cheque_number: string
  due_date: string | null
  bank_code: string
  bank_name?: string
  branch_code?: string
  branch_name?: string
  account_number?: string
  customer_code?: string
  customer_name?: string
  drawer_name?: string
  amount: number
  currency: string
  status: string
  status_name: string
  is_promoted?: boolean
}

interface Props {
  isOpen: boolean
  onClose: () => void
  cheque: ChequeData | null
  onOpenCustomerStatement?: (customerCode: string) => void
  onPromote?: (chequeDoc: string) => void
  currencyCode: string
}

const PALESTINIAN_BANKS: Record<string, string> = {
  '0089': 'بنك فلسطين',
  '0049': 'البنك الإسلامي الفلسطيني',
  '0081': 'البنك الإسلامي العربي',
  '0027': 'البنك العربي',
  '0073': 'بنك القدس',
  '0082': 'البنك الوطني',
  '0066': 'بنك القاهرة عمان',
  '0076': 'بنك الصفا',
  '0037': 'بنك الأردن',
  '0043': 'بنك الإسكان للتجارة',
  '0067': 'البنك الأهلي الأردني',
  '0078': 'بنك الاستثمار الفلسطيني',
  '0012': 'بنك لئومي',
  '0010': 'بنك هبوعليم',
  '0011': 'بنك ديسكونت',
  '0020': 'بنك مزراحي تفاحوت',
  '0031': 'البنك الدولي الأول',
}

const money = (n: number) =>
  Number(n || 0).toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ShamelChequeDetailModal({
  isOpen,
  onClose,
  cheque,
  onOpenCustomerStatement,
  onPromote,
  currencyCode,
}: Props) {
  if (!isOpen || !cheque) return null

  const bankName =
    cheque.bank_name || PALESTINIAN_BANKS[cheque.bank_code] || (cheque.bank_code ? `بنك (${cheque.bank_code})` : '—')

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto" dir="rtl">
      <div className="bg-slate-900 border border-white/10 text-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/10 bg-slate-800/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏦</span>
            <div>
              <h3 className="text-base font-bold text-white">
                بيانات الشيك رقم: <span className="font-mono text-sky-400">{cheque.cheque_number}</span>
              </h3>
              <p className="text-xs text-slate-400">سند رقم: <span className="font-mono text-slate-300">{cheque.document}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm transition border border-white/10"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* Amount Card */}
          <div className="p-4 bg-slate-950/80 rounded-xl border border-white/10 flex items-center justify-between">
            <div>
              <span className="text-slate-400 font-medium">مبلغ الشيك</span>
              <div className="text-2xl font-black text-white font-mono mt-0.5">
                {money(cheque.amount)} <span className="text-base font-bold text-sky-400">{cheque.currency || currencyCode}</span>
              </div>
            </div>
            <div>
              <span className={`text-xs px-3 py-1 rounded-full font-bold border ${
                cheque.status === 'collected' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                cheque.status === 'bounced' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                cheque.status === 'endorsed' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                'bg-sky-500/10 text-sky-400 border-sky-500/20'
              }`}>
                {cheque.status_name}
              </span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-800/60 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">تاريخ الاستحقاق</span>
              <span className="font-mono font-bold text-white text-sm">
                {cheque.due_date ? new Date(cheque.due_date).toLocaleDateString('ar-u-nu-latn') : '—'}
              </span>
            </div>

            <div className="p-3 bg-slate-800/60 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">البنك المسحوب عليه</span>
              <span className="font-bold text-white">{bankName}</span>
              {cheque.branch_code && (
                <span className="block text-[11px] text-slate-400 mt-0.5 font-mono">فرع: {cheque.branch_code}</span>
              )}
            </div>

            <div className="p-3 bg-slate-800/60 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">رقم الحساب المسحوب</span>
              <span className="font-mono font-bold text-white text-sm">{cheque.account_number || '—'}</span>
            </div>

            <div className="p-3 bg-slate-800/60 rounded-xl border border-white/10">
              <span className="text-slate-400 block mb-1">الحالة في بازاركو</span>
              {cheque.is_promoted ? (
                <span className="text-emerald-400 font-bold">✓ مرحّل لمحفظة بازاركو</span>
              ) : (
                <span className="text-slate-400 font-semibold">مستودع الشامل المعزول</span>
              )}
            </div>
          </div>

          {/* Customer info */}
          <div className="p-3.5 bg-slate-800/60 rounded-xl border border-white/10 flex items-center justify-between">
            <div>
              <span className="text-slate-400 block mb-0.5">العميل / الساحب</span>
              <span className="font-bold text-white text-sm">{cheque.customer_name || cheque.drawer_name || '—'}</span>
              {cheque.customer_code && (
                <span className="font-mono text-sky-400 block mt-0.5">كود: {cheque.customer_code}</span>
              )}
            </div>

            {cheque.customer_code && onOpenCustomerStatement && (
              <button
                onClick={() => {
                  onClose()
                  onOpenCustomerStatement(cheque.customer_code!)
                }}
                className="px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-lg font-bold text-xs transition flex items-center gap-1"
              >
                <span>كشف حساب العميل</span>
                <span>↗</span>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-slate-800/40 flex items-center justify-between">
          {onPromote && !cheque.is_promoted ? (
            <button
              onClick={() => onPromote(cheque.document)}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition"
            >
              ترحيل الشيك لبازاركو
            </button>
          ) : <div />}

          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition border border-white/10"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
