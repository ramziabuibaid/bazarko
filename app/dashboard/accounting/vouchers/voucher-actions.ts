'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'
import { postReceiptVoucherEntry, postPaymentVoucherEntry, reverseJournalEntry } from '@/lib/accounting/engine'
import { revalidatePath } from 'next/cache'

export interface ChequeItem {
  check_number: string
  bank_name: string
  drawer_name?: string
  payee_name?: string
  amount: number
  due_date: string
  notes?: string
  images?: string[]
}

export interface CreateVoucherInput {
  type: 'receipt' | 'payment'
  date: string
  payment_method: 'cash' | 'cheque' | 'split' | 'bank' | 'transfer'
  amount: number
  cash_amount?: number
  checks_amount?: number
  cash_box_id?: string | null
  bank_account_id?: string | null
  customer_id?: string | null
  supplier_id?: string | null
  party_name: string
  category?: string | null
  description: string
  reference?: string | null
  invoice_id?: string | null
  purchase_invoice_id?: string | null
  checks?: ChequeItem[]
}

/**
 * جلب الفواتير المفتوحة (غير المدفوعة أو المدفوعة جزئياً) لزبون محدد لربطها اختيارياً
 */
export async function getCustomerOpenInvoices(customerId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return []

    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, issue_date, total, amount_paid, status')
      .eq('store_id', storeId)
      .eq('customer_id', customerId)
      .neq('status', 'paid')
      .neq('status', 'cancelled')
      .order('issue_date', { ascending: false })

    if (error) throw error
    return (data || []).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      total: Number(inv.total || 0),
      amount_paid: Number(inv.amount_paid || 0),
      remaining: Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)),
      status: inv.status,
    }))
  } catch (err) {
    console.error('Error fetching customer invoices:', err)
    return []
  }
}

/**
 * جلب فواتير المشتريات المفتوحة لمورد محدد لربطها اختيارياً
 */
export async function getSupplierOpenPurchases(supplierId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return []

    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('id, invoice_number, invoice_date, total_amount, paid_amount, payment_status')
      .eq('store_id', storeId)
      .eq('supplier_id', supplierId)
      .neq('payment_status', 'paid')
      .order('invoice_date', { ascending: false })

    if (error) throw error
    return (data || []).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      total: Number(inv.total_amount || 0),
      paid_amount: Number(inv.paid_amount || 0),
      remaining: Math.max(0, Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)),
      status: inv.payment_status,
    }))
  } catch (err) {
    console.error('Error fetching supplier purchase invoices:', err)
    return []
  }
}

/**
 * إنشاء سند قبض أو صرف مع دعم الدفع النقدي، الشيكات، أو (نقدي + شيكات)
 * والربط الاختياري بالفواتير
 */
export async function createVoucher(input: CreateVoucherInput) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    // التحقق من قفل الفترة المحاسبية
    const periodCheck = await checkIsPeriodClosed(storeId, input.date)
    if (periodCheck.isClosed) {
      return { success: false, error: `لا يمكن تسجيل سند في فترة محاسبية مقفلة (${periodCheck.periodName})` }
    }

    const totalAmount = Number(input.amount)
    if (isNaN(totalAmount) || totalAmount <= 0) {
      return { success: false, error: 'يرجى إدخال مبلغ صحيح وموجب للسند' }
    }

    if (!input.description?.trim()) {
      return { success: false, error: 'البيان / الوصف مطلوب' }
    }

    // احتساب وتدقيق مبالغ وسائل الدفع
    let effectiveCash = 0
    let effectiveChecks = 0

    if (input.payment_method === 'cash') {
      effectiveCash = totalAmount
      effectiveChecks = 0
    } else if (input.payment_method === 'cheque') {
      effectiveCash = 0
      effectiveChecks = totalAmount
      if (!input.checks || input.checks.length === 0) {
        return { success: false, error: 'يرجى إضافة شيك واحد على الأقل' }
      }
      const sumChecks = input.checks.reduce((sum, c) => sum + Number(c.amount || 0), 0)
      if (Math.abs(sumChecks - totalAmount) > 0.01) {
        return { success: false, error: `مجموع مبالغ الشيكات (${sumChecks}) لا يتطابق مع إجمالي السند (${totalAmount})` }
      }
    } else if (input.payment_method === 'split') {
      effectiveCash = Number(input.cash_amount || 0)
      effectiveChecks = Number(input.checks_amount || 0)
      if (effectiveCash <= 0) {
        return { success: false, error: 'يرجى إدخال المبلغ النقدي' }
      }
      if (!input.checks || input.checks.length === 0) {
        return { success: false, error: 'يرجى إدخال بيانات الشيكات' }
      }
      const sumChecks = input.checks.reduce((sum, c) => sum + Number(c.amount || 0), 0)
      if (Math.abs(sumChecks - effectiveChecks) > 0.01) {
        return { success: false, error: `مجموع قيم الشيكات المدخلة (${sumChecks}) لا يتطابق مع مبلغ الشيكات المحدد (${effectiveChecks})` }
      }
      if (Math.abs((effectiveCash + effectiveChecks) - totalAmount) > 0.01) {
        return { success: false, error: `مجموع (النقدي ${effectiveCash} + الشيكات ${effectiveChecks}) لا يتطابق مع إجمالي السند (${totalAmount})` }
      }
    } else {
      // bank or transfer
      effectiveCash = 0
      effectiveChecks = 0
    }

    // توليد رقم السند التسلسلي
    const { count } = await supabase
      .from('vouchers')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('type', input.type)

    const prefix = input.type === 'receipt' ? 'RCP' : 'PMT'
    const voucherNumber = `${prefix}-${String((count ?? 0) + 1).padStart(4, '0')}`

    // 1. إدراج السند في جدول vouchers
    const { data: voucher, error: voucherErr } = await supabase
      .from('vouchers')
      .insert({
        store_id: storeId,
        voucher_number: voucherNumber,
        type: input.type,
        date: input.date,
        amount: totalAmount,
        cash_amount: effectiveCash,
        checks_amount: effectiveChecks,
        checks_data: input.checks || [],
        cash_box_id: (effectiveCash > 0 && input.cash_box_id) ? input.cash_box_id : null,
        bank_account_id: input.bank_account_id || null,
        customer_id: input.customer_id || null,
        supplier_id: input.supplier_id || null,
        invoice_id: input.invoice_id || null,
        purchase_invoice_id: input.purchase_invoice_id || null,
        party_name: input.party_name.trim(),
        payment_method: input.payment_method,
        category: input.category || null,
        description: input.description.trim(),
        reference: input.reference?.trim() || null,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (voucherErr) throw voucherErr

    // 2. تسجيل حركة الصندوق الفعلي إذا كان هناك جزء نقدي
    if (effectiveCash > 0) {
      // جلب الصندوق الافتراضي إن لم يحدد
      let cashBoxId = input.cash_box_id
      if (!cashBoxId) {
        const { data: defBox } = await supabase
          .from('cash_boxes')
          .select('id')
          .eq('store_id', storeId)
          .eq('is_default', true)
          .maybeSingle()
        cashBoxId = defBox?.id || null
      }

      await supabase.from('cash_movements').insert({
        store_id: storeId,
        cash_box_id: cashBoxId,
        direction: input.type === 'receipt' ? 'in' : 'out',
        amount: effectiveCash,
        source: input.type === 'receipt' ? 'receipt_voucher' : 'payment_voucher',
        ref_id: voucher.id,
        party_name: input.party_name.trim(),
        payment_method: 'cash',
        description: `سند ${input.type === 'receipt' ? 'قبض' : 'صرف'} ${voucherNumber} — ${input.description.trim()}`,
        date: input.date,
        created_by: user.id,
      })
    }

    // 3. تحديث الحساب البنكي إذا كان الدفع بنكي
    if ((input.payment_method === 'bank' || input.payment_method === 'transfer') && input.bank_account_id) {
      const { data: bAcc } = await supabase
        .from('bank_accounts')
        .select('balance')
        .eq('id', input.bank_account_id)
        .single()

      if (bAcc) {
        const newBal = input.type === 'receipt'
          ? Number(bAcc.balance || 0) + totalAmount
          : Number(bAcc.balance || 0) - totalAmount
        await supabase
          .from('bank_accounts')
          .update({ balance: newBal, updated_at: new Date().toISOString() })
          .eq('id', input.bank_account_id)
      }
    }

    // 4. تسجيل الشيكات في محفظة الشيكات (checks table)
    if (input.checks && input.checks.length > 0) {
      const isReceipt = input.type === 'receipt'
      const checkRows = input.checks.map(c => ({
        store_id: storeId,
        type: isReceipt ? 'received' : 'issued',
        check_number: c.check_number.trim(),
        bank_name: c.bank_name.trim(),
        drawer_name: isReceipt ? (c.drawer_name?.trim() || input.party_name.trim()) : null,
        payee_name: !isReceipt ? (c.payee_name?.trim() || input.party_name.trim()) : null,
        amount: Number(c.amount),
        currency: 'ILS',
        exchange_rate: 1.0,
        amount_ils: Number(c.amount),
        due_date: c.due_date,
        issue_date: input.date,
        status: 'in_portfolio',
        customer_id: input.customer_id || null,
        supplier_id: input.supplier_id || null,
        notes: c.notes?.trim() || `محرر بموجب سند ${isReceipt ? 'قبض' : 'صرف'} ${voucherNumber}`,
        images: c.images || [],
        created_by: user.id,
      }))

      await supabase.from('checks').insert(checkRows)
    }

    // 5. كشف حساب العميل ورصيده (في سندات القبض أو دفعات الزبائن)
    if (input.customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('balance, total_paid')
        .eq('id', input.customer_id)
        .single()

      const currentBal = Number(cust?.balance || 0)
      const currentPaid = Number(cust?.total_paid || 0)

      if (input.type === 'receipt') {
        const balanceAfter = currentBal - totalAmount
        await supabase.from('customer_ledger').insert({
          store_id: storeId,
          customer_id: input.customer_id,
          type: 'payment',
          date: input.date,
          description: `سند قبض ${voucherNumber} — ${input.description.trim()}`,
          debit: 0,
          credit: totalAmount,
          balance: balanceAfter,
          reference_id: voucher.id,
          reference_type: 'voucher',
          created_by: user.id,
        })

        await supabase
          .from('customers')
          .update({
            balance: balanceAfter,
            total_paid: currentPaid + totalAmount,
          })
          .eq('id', input.customer_id)
      } else {
        // دفع للعميل (استرداد أو رصيد دائن)
        const balanceAfter = currentBal + totalAmount
        await supabase.from('customer_ledger').insert({
          store_id: storeId,
          customer_id: input.customer_id,
          type: 'refund',
          date: input.date,
          description: `سند صرف للعميل ${voucherNumber} — ${input.description.trim()}`,
          debit: totalAmount,
          credit: 0,
          balance: balanceAfter,
          reference_id: voucher.id,
          reference_type: 'voucher',
          created_by: user.id,
        })

        await supabase
          .from('customers')
          .update({ balance: balanceAfter })
          .eq('id', input.customer_id)
      }
    }

    // 6. الربط الاختياري بفاتورة المبيعات
    if (input.invoice_id) {
      const { data: inv } = await supabase
        .from('invoices')
        .select('total, amount_paid')
        .eq('id', input.invoice_id)
        .single()

      if (inv) {
        const newPaid = Number(inv.amount_paid || 0) + totalAmount
        const invTotal = Number(inv.total || 0)
        const newStatus = newPaid >= invTotal ? 'paid' : (newPaid > 0 ? 'partial' : 'draft')

        await supabase
          .from('invoices')
          .update({
            amount_paid: newPaid,
            status: newStatus,
            paid_date: newStatus === 'paid' ? input.date : null,
          })
          .eq('id', input.invoice_id)
      }
    }

    // 7. حساب المورد ورصيده (في سندات الصرف)
    if (input.supplier_id) {
      const { data: supp } = await supabase
        .from('suppliers')
        .select('balance')
        .eq('id', input.supplier_id)
        .single()

      if (supp) {
        const curBal = Number(supp.balance || 0)
        const newBal = input.type === 'payment'
          ? curBal - totalAmount
          : curBal + totalAmount
        await supabase
          .from('suppliers')
          .update({ balance: newBal })
          .eq('id', input.supplier_id)
      }
    }

    // 8. الربط الاختياري بفاتورة المشتريات
    if (input.purchase_invoice_id) {
      const { data: pInv } = await supabase
        .from('purchase_invoices')
        .select('total_amount, paid_amount')
        .eq('id', input.purchase_invoice_id)
        .single()

      if (pInv) {
        const newPaid = Number(pInv.paid_amount || 0) + totalAmount
        const pTotal = Number(pInv.total_amount || 0)
        const newStatus = newPaid >= pTotal ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid')

        await supabase
          .from('purchase_invoices')
          .update({
            paid_amount: newPaid,
            payment_status: newStatus,
          })
          .eq('id', input.purchase_invoice_id)
      }
    }

    // 9. توثيق العملية في سجل التدقيق المالي
    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: voucher.id,
      entityLabel: voucherNumber,
      action: 'create',
      actorId: user.id,
      details: {
        type: input.type,
        amount: totalAmount,
        cash_amount: effectiveCash,
        checks_amount: effectiveChecks,
        checks_count: input.checks?.length || 0,
        party: input.party_name.trim(),
        payment_method: input.payment_method,
        invoice_id: input.invoice_id || null,
        purchase_invoice_id: input.purchase_invoice_id || null,
      },
    })

    // 10. الترحيل الفوري لدفتر الأستاذ العام
    try {
      if (input.type === 'receipt') {
        await postReceiptVoucherEntry(voucher.id, user.id)
      } else {
        await postPaymentVoucherEntry(voucher.id, user.id)
      }
    } catch (glErr) {
      console.error('Error posting GL for voucher:', glErr)
    }

    revalidatePath('/dashboard/accounting/receipts')
    revalidatePath('/dashboard/accounting/payments')
    revalidatePath('/dashboard/accounting/treasury')
    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')

    return { success: true, voucher }
  } catch (err: any) {
    console.error('Error creating voucher:', err)
    return { success: false, error: err.message || 'حدث خطأ أثناء حفظ السند' }
  }
}

/**
 * حذف السند مع عكس الأثر المالي على الصندوق، الشيكات، كشف الحساب، والفواتير
 */
export async function deleteVoucher(voucherId: string) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: v, error: vErr } = await supabase
      .from('vouchers')
      .select('*')
      .eq('id', voucherId)
      .eq('store_id', storeId)
      .single()

    if (vErr || !v) return { success: false, error: 'السند غير موجود' }

    // التحقق من قفل الفترة المحاسبية لتاريخ السند
    const periodCheck = await checkIsPeriodClosed(storeId, v.date)
    if (periodCheck.isClosed) {
      return { success: false, error: `لا يمكن حذف سند يقع ضمن فترة محاسبية مقفلة (${periodCheck.periodName})` }
    }

    const amt = Number(v.amount || 0)
    const isReceipt = v.type === 'receipt'

    // 1. عكس حركة الصندوق
    await supabase
      .from('cash_movements')
      .delete()
      .eq('ref_id', v.id)
      .eq('store_id', storeId)

    // 2. عكس الشيكات المرتبطة إن وجدت
    if (v.checks_data && Array.isArray(v.checks_data) && v.checks_data.length > 0) {
      const checkNumbers = v.checks_data.map((c: any) => c.check_number)
      await supabase
        .from('checks')
        .delete()
        .eq('store_id', storeId)
        .in('check_number', checkNumbers)
    }

    // 3. عكس الحساب البنكي
    if ((v.payment_method === 'bank' || v.payment_method === 'transfer') && v.bank_account_id) {
      const { data: bAcc } = await supabase
        .from('bank_accounts')
        .select('balance')
        .eq('id', v.bank_account_id)
        .single()

      if (bAcc) {
        const revBal = isReceipt
          ? Number(bAcc.balance || 0) - amt
          : Number(bAcc.balance || 0) + amt
        await supabase
          .from('bank_accounts')
          .update({ balance: revBal })
          .eq('id', v.bank_account_id)
      }
    }

    // 4. عكس كشف حساب العميل
    if (v.customer_id) {
      await supabase
        .from('customer_ledger')
        .delete()
        .eq('reference_id', v.id)
        .eq('customer_id', v.customer_id)

      const { data: cust } = await supabase
        .from('customers')
        .select('balance, total_paid')
        .eq('id', v.customer_id)
        .single()

      if (cust) {
        const curBal = Number(cust.balance || 0)
        const curPaid = Number(cust.total_paid || 0)
        const revBal = isReceipt ? curBal + amt : curBal - amt
        const revPaid = isReceipt ? Math.max(0, curPaid - amt) : curPaid

        await supabase
          .from('customers')
          .update({ balance: revBal, total_paid: revPaid })
          .eq('id', v.customer_id)
      }
    }

    // 5. عكس فاتورة المبيعات المرتبطة إن وجدت
    if (v.invoice_id) {
      const { data: inv } = await supabase
        .from('invoices')
        .select('total, amount_paid')
        .eq('id', v.invoice_id)
        .single()

      if (inv) {
        const revPaid = Math.max(0, Number(inv.amount_paid || 0) - amt)
        const invTotal = Number(inv.total || 0)
        const revStatus = revPaid >= invTotal ? 'paid' : (revPaid > 0 ? 'partial' : 'draft')

        await supabase
          .from('invoices')
          .update({
            amount_paid: revPaid,
            status: revStatus,
            paid_date: revStatus === 'paid' ? v.date : null,
          })
          .eq('id', v.invoice_id)
      }
    }

    // 6. عكس رصيد المورد وفاتورة المشتريات
    if (v.supplier_id) {
      const { data: supp } = await supabase
        .from('suppliers')
        .select('balance')
        .eq('id', v.supplier_id)
        .single()

      if (supp) {
        const curBal = Number(supp.balance || 0)
        const revBal = isReceipt ? curBal - amt : curBal + amt
        await supabase
          .from('suppliers')
          .update({ balance: revBal })
          .eq('id', v.supplier_id)
      }
    }

    if (v.purchase_invoice_id) {
      const { data: pInv } = await supabase
        .from('purchase_invoices')
        .select('total_amount, paid_amount')
        .eq('id', v.purchase_invoice_id)
        .single()

      if (pInv) {
        const revPaid = Math.max(0, Number(pInv.paid_amount || 0) - amt)
        const pTotal = Number(pInv.total_amount || 0)
        const revStatus = revPaid >= pTotal ? 'paid' : (revPaid > 0 ? 'partial' : 'unpaid')

        await supabase
          .from('purchase_invoices')
          .update({
            paid_amount: revPaid,
            payment_status: revStatus,
          })
          .eq('id', v.purchase_invoice_id)
      }
    }

    // 6.5. عكس القيد المحاسبي في دفتر الأستاذ العام
    try {
      await reverseJournalEntry(v.id, `حذف سند #${v.voucher_number}`, user.id)
    } catch (glRevErr) {
      console.error('Error reversing voucher GL entry:', glRevErr)
    }

    // 7. حذف السند نفسه
    const { error: delErr } = await supabase
      .from('vouchers')
      .delete()
      .eq('id', v.id)

    if (delErr) throw delErr

    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: v.id,
      entityLabel: v.voucher_number,
      action: 'delete',
      actorId: user.id,
      details: { deletedVoucher: v },
    })

    revalidatePath('/dashboard/accounting/receipts')
    revalidatePath('/dashboard/accounting/payments')
    revalidatePath('/dashboard/accounting/treasury')
    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')

    return { success: true }
  } catch (err: any) {
    console.error('Error deleting voucher:', err)
    return { success: false, error: err.message || 'فشل حذف السند' }
  }
}
