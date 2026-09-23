'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export interface CustomerStatementRow {
  id: string
  date: string
  type: string
  doc_no: string
  description: string
  debit: number
  credit: number
  balance: number
}

export interface CustomerStatementResult {
  success: boolean
  error?: string
  customer?: {
    id: string
    name: string
    phone: string | null
    email: string | null
    city: string | null
    address: string | null
    balance: number
    credit_limit: number
    customer_type: string
  }
  store?: {
    id: string
    name: string
    phone: string | null
    address: string | null
    currency_code: string
    logo_url: string | null
  }
  openingBalance: number
  rows: CustomerStatementRow[]
  totalDebit: number
  totalCredit: number
  closingBalance: number
}

export async function getCustomerStatement(
  customerId: string,
  fromDate?: string,
  toDate?: string
): Promise<CustomerStatementResult> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'غير مصرح', openingBalance: 0, rows: [], totalDebit: 0, totalCredit: 0, closingBalance: 0 }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود', openingBalance: 0, rows: [], totalDebit: 0, totalCredit: 0, closingBalance: 0 }

    const [{ data: store }, { data: customer }] = await Promise.all([
      supabase.from('stores').select('id, name, phone, address, currency_code, logo_url').eq('id', storeId).single(),
      supabase.from('customers').select('id, name, phone, email, city, address, balance, credit_limit, customer_type').eq('id', customerId).eq('store_id', storeId).single()
    ])

    if (!customer) {
      return { success: false, error: 'العميل غير موجود', openingBalance: 0, rows: [], totalDebit: 0, totalCredit: 0, closingBalance: 0 }
    }

    // تحقق أولاً من جدول customer_ledger
    const { data: ledgerEntries } = await supabase
      .from('customer_ledger')
      .select('*')
      .eq('customer_id', customerId)
      .eq('store_id', storeId)
      .order('date', { ascending: true })

    interface RawTx {
      id: string
      date: string
      type: string
      doc_no: string
      description: string
      debit: number
      credit: number
      created_at?: string
    }

    let allTxs: RawTx[] = []

    if (ledgerEntries && ledgerEntries.length > 0) {
      allTxs = ledgerEntries.map(e => {
        let typeLabel = 'حركة قيد'
        if (e.type === 'invoice' || e.type === 'sale') typeLabel = 'فاتورة مبيعات'
        else if (e.type === 'payment' || e.type === 'receipt') typeLabel = 'سند قبض'
        else if (e.type === 'refund' || e.type === 'disbursement') typeLabel = 'سند صرف'
        else if (e.type === 'return') typeLabel = 'مردود مبيعات'
        else if (e.type === 'opening') typeLabel = 'رصيد افتتاحي'

        return {
          id: e.id,
          date: e.date || (e.created_at ? e.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
          type: typeLabel,
          doc_no: e.reference_id ? String(e.reference_id).slice(-8) : '—',
          description: e.description || '',
          debit: Number(e.debit || 0),
          credit: Number(e.credit || 0),
          created_at: e.created_at,
        }
      })
    } else {
      // جلب الفواتير والسندات والمردودات مباشرة
      const [
        { data: invoices },
        { data: returns },
        { data: receipts }
      ] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, invoice_number, issue_date, total, status, notes, created_at')
          .eq('customer_id', customerId)
          .eq('store_id', storeId)
          .neq('status', 'cancelled'),
        supabase
          .from('sales_returns')
          .select('id, return_number, return_date, total_amount, reason, created_at')
          .eq('customer_id', customerId)
          .eq('store_id', storeId),
        supabase
          .from('vouchers')
          .select('id, voucher_number, date, amount, payment_method, type, description, created_at')
          .eq('customer_id', customerId)
          .eq('store_id', storeId)
      ])

      for (const inv of invoices || []) {
        allTxs.push({
          id: inv.id,
          date: inv.issue_date,
          type: 'فاتورة مبيعات',
          doc_no: inv.invoice_number,
          description: inv.notes || `فاتورة مبيعات (${inv.status === 'paid' ? 'مسددة' : 'آجلة'})`,
          debit: Number(inv.total || 0),
          credit: 0,
          created_at: inv.created_at,
        })
      }

      for (const ret of returns || []) {
        allTxs.push({
          id: ret.id,
          date: ret.return_date,
          type: 'مردود مبيعات',
          doc_no: ret.return_number,
          description: ret.reason || 'إرجاع بضاعة ومردود',
          debit: 0,
          credit: Number(ret.total_amount || 0),
          created_at: ret.created_at,
        })
      }

      for (const rcp of receipts || []) {
        const isReceipt = rcp.type === 'receipt'
        allTxs.push({
          id: rcp.id,
          date: rcp.date,
          type: isReceipt ? 'سند قبض' : 'سند صرف',
          doc_no: rcp.voucher_number,
          description: rcp.description || `${isReceipt ? 'سند قبض' : 'سند صرف'} (${rcp.payment_method || 'نقدي'})`,
          debit: isReceipt ? 0 : Number(rcp.amount || 0),
          credit: isReceipt ? Number(rcp.amount || 0) : 0,
          created_at: rcp.created_at,
        })
      }
    }

    // فرز تصاعدي زمني
    allTxs.sort((a, b) => {
      const cmp = new Date(a.date).getTime() - new Date(b.date).getTime()
      if (cmp !== 0) return cmp
      if (a.created_at && b.created_at) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      return 0
    })

    let openingBalance = 0
    const periodRows: CustomerStatementRow[] = []

    for (const tx of allTxs) {
      if (fromDate && tx.date < fromDate) {
        openingBalance += (tx.debit - tx.credit)
      } else if (toDate && tx.date > toDate) {
        continue
      } else {
        periodRows.push({
          id: tx.id,
          date: tx.date,
          type: tx.type,
          doc_no: tx.doc_no,
          description: tx.description,
          debit: tx.debit,
          credit: tx.credit,
          balance: 0,
        })
      }
    }

    let running = openingBalance
    for (const r of periodRows) {
      running += (r.debit - r.credit)
      r.balance = running
    }

    const totalDebit = periodRows.reduce((s, r) => s + r.debit, 0)
    const totalCredit = periodRows.reduce((s, r) => s + r.credit, 0)
    const closingBalance = running

    return {
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        city: customer.city,
        address: customer.address,
        balance: Number(customer.balance || 0),
        credit_limit: Number(customer.credit_limit || 0),
        customer_type: customer.customer_type || 'retail',
      },
      store: store ? {
        id: store.id,
        name: store.name,
        phone: store.phone,
        address: store.address,
        currency_code: store.currency_code || 'ILS',
        logo_url: store.logo_url,
      } : undefined,
      openingBalance,
      rows: periodRows,
      totalDebit,
      totalCredit,
      closingBalance,
    }
  } catch (error: any) {
    console.error('getCustomerStatement error:', error)
    return {
      success: false,
      error: error.message || 'حدث خطأ أثناء تحميل كشف الحساب',
      openingBalance: 0,
      rows: [],
      totalDebit: 0,
      totalCredit: 0,
      closingBalance: 0,
    }
  }
}
