'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'
import { postReceiptVoucherEntry, postPaymentVoucherEntry, reverseJournalEntry, deleteJournalEntryForRef } from '@/lib/accounting/engine'
import { revalidatePath } from 'next/cache'

export interface ChequeItem {
  check_number: string
  bank_name: string
  bank_code?: string
  branch_name?: string
  branch_code?: string
  account_number?: string
  drawer_name?: string
  payee_name?: string
  amount: number
  due_date: string
  date?: string // تاريخ تحرير الشيك
  notes?: string
  images?: string[]
}

/**
 * جلب الصناديق والخزائن المسموح للمستخدم باستخدامها في سندات القبض أو الصرف
 */
export async function getUserAllowedCashBoxes(
  storeId: string,
  userId: string,
  voucherType: 'receipt' | 'payment',
) {
  const supabase = createClient()

  // 1. فحص رتبة العضو في المتجر
  const { data: member } = await supabase
    .from('store_members')
    .select('role')
    .eq('store_id', storeId)
    .eq('profile_id', userId)
    .maybeSingle()

  // 2. جلب جميع الصناديق النشطة في المتجر
  const { data: allBoxes } = await supabase
    .from('cash_boxes')
    .select('id, name, type, is_default, is_active')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (!allBoxes || allBoxes.length === 0) return []

  // إذا كان المستخدم مالكاً أو مديراً للمتجر، تتاح له كافة الصناديق
  if (member?.role === 'owner' || member?.role === 'admin') {
    return allBoxes
  }

  // 3. فحص جدول الصلاحيات المقيدة للمستخدم
  const { data: perms } = await supabase
    .from('user_cash_box_permissions')
    .select('cash_box_id, can_receipt, can_payment')
    .eq('store_id', storeId)
    .eq('user_id', userId)

  // إذا لم يتم وضع قيود خاصة لهذا المستخدم، فإن السياسة الافتراضية هي إتاحة الكل
  if (!perms || perms.length === 0) {
    return allBoxes
  }

  const allowedIds = new Set(
    perms
      .filter(p => (voucherType === 'receipt' ? p.can_receipt : p.can_payment))
      .map(p => p.cash_box_id),
  )

  return allBoxes.filter(b => allowedIds.has(b.id))
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
 * تطبيع موحد لطريقة الدفع عبر السندات
 */
function normalizePaymentMethod(method?: string | null): 'cash' | 'cheque' | 'split' | 'bank' {
  const rawMethod = (method || 'cash').toLowerCase().trim()
  const isChequeMethod = rawMethod === 'cheque' || rawMethod === 'check' || rawMethod === 'cheques' || rawMethod === 'checks' || rawMethod.includes('شيك')
  const isSplitMethod = rawMethod === 'split' || rawMethod.includes('مختلط') || rawMethod.includes('مركب') || rawMethod.includes('مجزأ')
  const isBankMethod = rawMethod === 'bank' || rawMethod === 'transfer' || rawMethod.includes('بنك') || rawMethod.includes('تحويل')
  return isChequeMethod ? 'cheque' : isSplitMethod ? 'split' : isBankMethod ? 'bank' : 'cash'
}

/**
 * إنشاء سند قبض أو صرف مع دعم الدفع النقدي، الشيكات، أو (نقدي + شيكات)
 * والربط الاختياري بالفواتير
 */
export async function createVoucher(input: CreateVoucherInput) {
  if(input.type==='payment' && ['cash','cheque','split'].includes(normalizePaymentMethod(input.payment_method))) return {success:false,error:'سجّل الصرف النقدي أو إصدار الشيكات والمختلط من صفحة سندات الصرف لضمان الحفظ الذري'}
  if(input.type==='receipt' && ['cash','cheque','split','bank'].includes(normalizePaymentMethod(input.payment_method))) return {success:false,error:'سجّل القبض النقدي أو البنكي أو الشيكات والمختلط من صفحة سندات القبض لضمان الحفظ الذري'}
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

    // التحقق من صلاحية المستخدم على الصندوق المحدد إن وُجد
    if (input.cash_box_id) {
      const allowed = await getUserAllowedCashBoxes(storeId, user.id, input.type)
      if (!allowed.some(b => b.id === input.cash_box_id)) {
        return {
          success: false,
          error: `ليس لديك صلاحية لتسجيل سند ${input.type === 'receipt' ? 'قبض' : 'صرف'} على الصندوق المحدد`,
        }
      }
    }

    // تطبيع طريقة الدفع واحتساب وتدقيق مبالغ وسائل الدفع
    const rawMethod = (input.payment_method || 'cash').toLowerCase().trim()
    const isChequeMethod = rawMethod === 'cheque' || rawMethod === 'check' || rawMethod === 'cheques' || rawMethod === 'checks' || rawMethod.includes('شيك')
    const isSplitMethod = rawMethod === 'split' || rawMethod.includes('مختلط') || rawMethod.includes('مركب') || rawMethod.includes('مجزأ')
    const isBankMethod = rawMethod === 'bank' || rawMethod === 'transfer' || rawMethod.includes('بنك') || rawMethod.includes('تحويل')
    const normMethod: 'cash' | 'cheque' | 'split' | 'bank' = isChequeMethod ? 'cheque' : isSplitMethod ? 'split' : isBankMethod ? 'bank' : 'cash'

    let effectiveCash = 0
    let effectiveChecks = 0

    if (normMethod === 'cash') {
      effectiveCash = totalAmount
      effectiveChecks = 0
    } else if (normMethod === 'cheque') {
      effectiveCash = 0
      effectiveChecks = totalAmount
      if (!input.checks || input.checks.length === 0) {
        return { success: false, error: 'طريقة الدفع بشيكات تتطلب إدخال شيك واحد على الأقل مع كامل بياناته' }
      }
    } else if (normMethod === 'split') {
      effectiveCash = Number(input.cash_amount || 0)
      effectiveChecks = Number(input.checks_amount || 0)
      if (effectiveCash <= 0) {
        return { success: false, error: 'يرجى إدخال المبلغ النقدي المقبوض في السند المجزأ' }
      }
      if (!input.checks || input.checks.length === 0) {
        return { success: false, error: 'يرجى إدخال بيانات الشيكات المقبوضة في السند المجزأ' }
      }
    } else {
      // bank or transfer
      effectiveCash = 0
      effectiveChecks = 0
    }

    // تدقيق كامل وتفصيلي لكل شيك مستقل
    if (effectiveChecks > 0 || (input.checks && input.checks.length > 0)) {
      if (!input.checks || input.checks.length === 0) {
        return { success: false, error: 'يرجى إدخال تفاصيل الشيكات المسجلة بالسند' }
      }

      const sumChecks = input.checks.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
      if (Math.abs(sumChecks - effectiveChecks) > 0.01) {
        return {
          success: false,
          error: `مجموع مبالغ الشيكات المدخلة (${sumChecks.toLocaleString('en-GB', { minimumFractionDigits: 2 })}) لا يطابق إجمالي مبلغ الشيكات المطلوب (${effectiveChecks.toLocaleString('en-GB', { minimumFractionDigits: 2 })})`,
        }
      }

      if (normMethod === 'split' && Math.abs((effectiveCash + effectiveChecks) - totalAmount) > 0.01) {
        return {
          success: false,
          error: `مجموع (النقدي ${effectiveCash} + الشيكات ${effectiveChecks}) لا يتطابق مع إجمالي السند (${totalAmount})`,
        }
      }

      // التحقق من صحة بيانات كل شيك ومنع تكرار رقم الشيك داخل السند الواحد
      const checkNumbersSeen = new Set<string>()
      for (let i = 0; i < input.checks.length; i++) {
        const c = input.checks[i]
        const num = (c.check_number || '').trim()
        if (!num) {
          return { success: false, error: `الشيك رقم (${i + 1}): يرجى إدخال رقم الشيك` }
        }
        if (checkNumbersSeen.has(num)) {
          return { success: false, error: `رقم الشيك (${num}) مكرر أكثر من مرة داخل نفس السند!` }
        }
        checkNumbersSeen.add(num)

        if (!c.amount || Number(c.amount) <= 0) {
          return { success: false, error: `الشيك رقم (${num}): يرجى إدخال مبلغ صحيح وموجب` }
        }
        if (!c.due_date) {
          return { success: false, error: `الشيك رقم (${num}): يرجى تحديد تاريخ الاستحقاق` }
        }
        if (!c.bank_name?.trim()) {
          return { success: false, error: `الشيك رقم (${num}): يرجى تحديد البنك المسحوب عليه` }
        }
      }
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
        payment_method: normMethod,
        category: input.category || null,
        description: input.description.trim(),
        reference: input.reference?.trim() || null,
        created_by: user.id,
      })
      .select('*')
      .single()

    if (voucherErr) throw voucherErr

    // 2. تسجيل حركة الصندوق الفعلي إذا كان هناك جزء نقدي ولم ينشئها المشغل تلقائياً
    if (effectiveCash > 0) {
      const { data: existingMovement } = await supabase
        .from('cash_movements')
        .select('id')
        .eq('ref_id', voucher.id)
        .maybeSingle()

      if (!existingMovement) {
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
          source: 'voucher',
          ref_id: voucher.id,
          party_name: input.party_name.trim(),
          payment_method: 'cash',
          description: `سند ${input.type === 'receipt' ? 'قبض' : 'صرف'} ${voucherNumber} — ${input.description.trim()}`,
          date: input.date,
          created_by: user.id,
        })
      }
    }

    // 3. تحديث الحساب البنكي إذا كان الدفع بنكي
    if ((normMethod === 'bank' || input.payment_method === 'transfer') && input.bank_account_id) {
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

    // 4. تسجيل الشيكات كـ كيانات مستقلة في محفظة الشيكات (checks table) مع منع التكرار
    if (input.checks && input.checks.length > 0 && effectiveChecks > 0) {
      const isReceipt = input.type === 'receipt'
      const checkRows = input.checks.map(c => ({
        store_id: storeId,
        type: isReceipt ? 'received' : 'issued',
        check_number: c.check_number.trim(),
        bank_name: c.bank_name.trim(),
        bank_code: c.bank_code?.trim() || null,
        branch_name: c.branch_name?.trim() || null,
        branch_code: c.branch_code?.trim() || null,
        account_number: c.account_number?.trim() || null,
        drawer_name: isReceipt ? (c.drawer_name?.trim() || input.party_name.trim()) : null,
        payee_name: !isReceipt ? (c.payee_name?.trim() || input.party_name.trim()) : null,
        amount: Number(c.amount),
        currency: 'ILS',
        exchange_rate: 1.0,
        amount_ils: Number(c.amount),
        due_date: c.due_date,
        issue_date: c.date || input.date,
        voucher_id: voucher.id,
        cashbox_id: input.cash_box_id || null,
        status: 'in_portfolio',
        customer_id: input.customer_id || null,
        supplier_id: input.supplier_id || null,
        notes: c.notes?.trim() || `محرر بموجب سند ${isReceipt ? 'قبض' : 'صرف'} ${voucherNumber}`,
        images: c.images || [],
        created_by: user.id,
      }))

      // إدراج ذري لكل شيك مع منع التكرار
      const { data: insertedChecks, error: checksErr } = await supabase
        .from('checks')
        .upsert(checkRows, { onConflict: 'store_id,voucher_id,check_number' })
        .select('id, check_number, amount')

      if (checksErr) {
        console.error('Error inserting voucher checks:', checksErr)
        await supabase.from('vouchers').delete().eq('id', voucher.id)
        return {
          success: false,
          error: `فشل تسجيل الشيكات في محفظة الشيكات: ${checksErr.message || 'خطأ غير معروف'}`,
        }
      }

      if (insertedChecks && insertedChecks.length > 0) {
        const checkOps = insertedChecks.map((c: any) => ({
          store_id: storeId,
          check_id: c.id,
          operation_type: 'status_change',
          from_status: 'none',
          to_status: 'in_portfolio',
          operation_date: input.date,
          notes: isReceipt
            ? `استلام شيك في المحفظة بموجب سند قبض رقم ${voucherNumber}`
            : `تحرير شيك بموجب سند صرف رقم ${voucherNumber}`,
          performed_by: user.id,
        }))
        await supabase.from('check_operations').insert(checkOps)
      }
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

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/accounting')
    revalidatePath('/dashboard/finance')
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
    if(v.creation_request_id) return {success:false,error:'السند الذري لا يقبل الحذف من هذا المسار؛ يلزم عكس ذري مستقل'}

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

    // 2. عكس وحذف الشيكات المرتبطة وحركاتها في محفظة الشيكات
    const { data: linkedChecks } = await supabase
      .from('checks')
      .select('id, status, check_number')
      .eq('store_id', storeId)
      .eq('voucher_id', v.id)

    if (linkedChecks && linkedChecks.length > 0) {
      const advancedChecks = linkedChecks.filter(c => c.status && c.status !== 'in_portfolio')
      if (advancedChecks.length > 0) {
        const nums = advancedChecks.map(c => c.check_number).join('، ')
        return {
          success: false,
          error: `لا يمكن حذف السند لوجود شيكات مرتبطة به تمت عليها حركات لاحقة في محفظة الشيكات (رقم الشيك: ${nums}). يجب إلغاء تلك الحركات أو إعادة الشيك للمحفظة أولاً.`,
        }
      }
      const checkIds = linkedChecks.map(c => c.id)
      await supabase.from('check_operations').delete().in('check_id', checkIds)
      await supabase.from('checks').delete().eq('store_id', storeId).eq('voucher_id', v.id)
    }

    if (v.checks_data && Array.isArray(v.checks_data) && v.checks_data.length > 0) {
      const checkNumbers = v.checks_data.map((c: any) => c.check_number).filter(Boolean)
      if (checkNumbers.length > 0) {
        const { data: numChecks } = await supabase
          .from('checks')
          .select('id, status, check_number')
          .eq('store_id', storeId)
          .in('check_number', checkNumbers)
        if (numChecks && numChecks.length > 0) {
          const advancedChecks = numChecks.filter(c => c.status && c.status !== 'in_portfolio')
          if (advancedChecks.length > 0) {
            const nums = advancedChecks.map(c => c.check_number).join('، ')
            return {
              success: false,
              error: `لا يمكن حذف السند لوجود شيكات مرتبطة به تمت عليها حركات لاحقة في محفظة الشيكات (رقم الشيك: ${nums}). يجب إلغاء تلك الحركات أو إعادة الشيك للمحفظة أولاً.`,
            }
          }
          await supabase.from('check_operations').delete().in('check_id', numChecks.map(c => c.id))
          await supabase.from('checks').delete().eq('store_id', storeId).in('check_number', checkNumbers)
        }
      }
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

    // 6.5. عكس وحذف القيد المحاسبي وحركاته بالكامل من دفتر الأستاذ وحسابات الشجرة
    await deleteJournalEntryForRef(supabase, storeId, v.id, 'voucher', user.id)

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

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/accounting')
    revalidatePath('/dashboard/finance')
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

export interface UpdateVoucherInput {
  id: string
  date: string
  payment_method: 'cash' | 'cheque' | 'split' | 'bank' | 'transfer'
  amount: number
  cash_amount?: number
  checks_amount?: number
  cash_box_id?: string | null
  bank_account_id?: string | null
  customer_id?: string | null
  supplier_id?: string | null
  invoice_id?: string | null
  purchase_invoice_id?: string | null
  party_name: string
  category?: string | null
  description: string
  reference?: string | null
  checks?: ChequeItem[]
}

/**
 * تعديل السند المحاسبي وعكس الأثر القديم بالكامل وتحديث الحسابات والخزينة والشيكات
 * لا ينشئ أي قيد مالي مكرر أو أثر مالي مضاعف
 */
export async function updateVoucher(input: UpdateVoucherInput) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    // التحقق من قفل الفترة المحاسبية لتاريخ السند الجديد والقديم
    const periodCheck = await checkIsPeriodClosed(storeId, input.date)
    if (periodCheck.isClosed) {
      return { success: false, error: `لا يمكن تعديل سند في فترة محاسبية مقفلة (${periodCheck.periodName})` }
    }

    const { data: oldV, error: oldErr } = await supabase
      .from('vouchers')
      .select('*')
      .eq('id', input.id)
      .eq('store_id', storeId)
      .single()

    if (oldErr || !oldV) return { success: false, error: 'السند غير موجود' }
    if(oldV.creation_request_id) return {success:false,error:'السند الذري لا يقبل التعديل من هذا المسار؛ يلزم عكس ذري مستقل'}

    const totalAmount = Number(input.amount)
    if (isNaN(totalAmount) || totalAmount <= 0) {
      return { success: false, error: 'يرجى إدخال مبلغ صحيح وموجب للسند' }
    }

    const normMethod = normalizePaymentMethod(input.payment_method)
    let effectiveCash = 0
    let effectiveChecks = 0
    if (normMethod === 'cash') {
      effectiveCash = totalAmount
    } else if (normMethod === 'cheque') {
      effectiveChecks = totalAmount
    } else if (normMethod === 'split') {
      effectiveCash = Number(input.cash_amount || 0)
      effectiveChecks = Number(input.checks_amount || 0)

      if (effectiveCash < 0 || effectiveChecks < 0) {
        return { success: false, error: 'مبالغ النقد والشيكات لا يمكن أن تكون سالبة' }
      }
      if (Math.abs((effectiveCash + effectiveChecks) - totalAmount) > 0.01) {
        return {
          success: false,
          error: `مجموع النقد (${effectiveCash.toLocaleString()}) والشيكات (${effectiveChecks.toLocaleString()}) لا يتطابق مع إجمالي السند (${totalAmount.toLocaleString()})`,
        }
      }
    }

    // التحقق الصارم من بيانات الشيكات إذا كان هناك جزء شيكات
    if (effectiveChecks > 0) {
      if (!input.checks || !Array.isArray(input.checks) || input.checks.length === 0) {
        return { success: false, error: 'يجب إدخال تفاصيل الشيكات (رقم الشيك، المبلغ، تاريخ الاستحقاق، البنك)' }
      }

      const sumChecks = input.checks.reduce((acc, c) => acc + (Number(c.amount) || 0), 0)
      if (Math.abs(sumChecks - effectiveChecks) > 0.01) {
        return {
          success: false,
          error: `مجموع مبالغ الشيكات (${sumChecks.toLocaleString()}) لا يتطابق مع قيمة الشيكات المحددة في السند (${effectiveChecks.toLocaleString()})`,
        }
      }

      const checkNums = new Set<string>()
      for (const [idx, c] of input.checks.entries()) {
        const cNum = c.check_number?.trim()
        if (!cNum) {
          return { success: false, error: `رقم الشيك في السطر ${idx + 1} مطلوب` }
        }
        if (checkNums.has(cNum)) {
          return { success: false, error: `رقم الشيك (${cNum}) مكرر داخل نفس السند` }
        }
        checkNums.add(cNum)

        if (!c.amount || Number(c.amount) <= 0) {
          return { success: false, error: `مبلغ الشيك (${cNum}) يجب أن يكون أكبر من صفر` }
        }
        if (!c.due_date) {
          return { success: false, error: `تاريخ استحقاق الشيك (${cNum}) مطلوب` }
        }
        if (!c.bank_name?.trim()) {
          return { success: false, error: `اسم بنك الشيك (${cNum}) مطلوب` }
        }
      }
    }

    const oldAmt = Number(oldV.amount || 0)
    const isReceipt = oldV.type === 'receipt'

    // ─────────────────────────────────────────────────────────────
    // 1. عكس الأثر القديم للسند بالكامل قبل التحديث
    // ─────────────────────────────────────────────────────────────

    // أ) عكس وحذف القيد المحاسبي القديم من الأستاذ العام والأرصدة
    await deleteJournalEntryForRef(supabase, storeId, oldV.id, 'voucher', user.id)

    // ب) عكس رصيد وكشف حساب العميل القديم
    if (oldV.customer_id) {
      await supabase
        .from('customer_ledger')
        .delete()
        .eq('reference_id', oldV.id)
        .eq('customer_id', oldV.customer_id)

      const { data: oldCust } = await supabase
        .from('customers')
        .select('balance, total_paid')
        .eq('id', oldV.customer_id)
        .single()

      if (oldCust) {
        const curBal = Number(oldCust.balance || 0)
        const curPaid = Number(oldCust.total_paid || 0)
        const revBal = isReceipt ? curBal + oldAmt : curBal - oldAmt
        const revPaid = isReceipt ? Math.max(0, curPaid - oldAmt) : curPaid
        await supabase
          .from('customers')
          .update({ balance: revBal, total_paid: revPaid })
          .eq('id', oldV.customer_id)
      }
    }

    // ج) عكس رصيد المورد القديم
    if (oldV.supplier_id) {
      const { data: oldSupp } = await supabase
        .from('suppliers')
        .select('balance')
        .eq('id', oldV.supplier_id)
        .single()

      if (oldSupp) {
        const curBal = Number(oldSupp.balance || 0)
        const revBal = isReceipt ? curBal - oldAmt : curBal + oldAmt
        await supabase
          .from('suppliers')
          .update({ balance: revBal })
          .eq('id', oldV.supplier_id)
      }
    }

    // د) عكس الفاتورة المرتبطة القديمة
    if (oldV.invoice_id) {
      const { data: oldInv } = await supabase
        .from('invoices')
        .select('total, amount_paid')
        .eq('id', oldV.invoice_id)
        .single()

      if (oldInv) {
        const revPaid = Math.max(0, Number(oldInv.amount_paid || 0) - oldAmt)
        const invTotal = Number(oldInv.total || 0)
        const revStatus = revPaid >= invTotal ? 'paid' : (revPaid > 0 ? 'partial' : 'draft')
        await supabase
          .from('invoices')
          .update({ amount_paid: revPaid, status: revStatus })
          .eq('id', oldV.invoice_id)
      }
    }

    // هـ) عكس فاتورة الشراء المرتبطة القديمة
    if (oldV.purchase_invoice_id) {
      const { data: oldPInv } = await supabase
        .from('purchase_invoices')
        .select('total_amount, paid_amount')
        .eq('id', oldV.purchase_invoice_id)
        .single()

      if (oldPInv) {
        const revPaid = Math.max(0, Number(oldPInv.paid_amount || 0) - oldAmt)
        const pTotal = Number(oldPInv.total_amount || 0)
        const revStatus = revPaid >= pTotal ? 'paid' : (revPaid > 0 ? 'partial' : 'unpaid')
        await supabase
          .from('purchase_invoices')
          .update({ paid_amount: revPaid, payment_status: revStatus })
          .eq('id', oldV.purchase_invoice_id)
      }
    }

    // و) عكس رصيد البنك القديم
    if ((oldV.payment_method === 'bank' || oldV.payment_method === 'transfer') && oldV.bank_account_id) {
      const { data: oldBank } = await supabase
        .from('bank_accounts')
        .select('balance')
        .eq('id', oldV.bank_account_id)
        .single()

      if (oldBank) {
        const revBal = isReceipt
          ? Number(oldBank.balance || 0) - oldAmt
          : Number(oldBank.balance || 0) + oldAmt
        await supabase
          .from('bank_accounts')
          .update({ balance: revBal })
          .eq('id', oldV.bank_account_id)
      }
    }

    // ز) التحقق من الشيكات القديمة وحذفها
    const { data: oldChecks } = await supabase
      .from('checks')
      .select('id, status, check_number')
      .eq('store_id', storeId)
      .eq('voucher_id', oldV.id)

    if (oldChecks && oldChecks.length > 0) {
      const advancedChecks = oldChecks.filter(c => c.status && c.status !== 'in_portfolio')
      if (advancedChecks.length > 0) {
        const nums = advancedChecks.map(c => c.check_number).join('، ')
        return {
          success: false,
          error: `لا يمكن تعديل السند لوجود شيكات مرتبطة به تمت عليها حركات لاحقة في محفظة الشيكات (رقم الشيك: ${nums}). يجب إلغاء تلك الحركات أو إعادة الشيك للمحفظة أولاً.`,
        }
      }
      const checkIds = oldChecks.map(c => c.id)
      await supabase.from('check_operations').delete().in('check_id', checkIds)
      await supabase.from('checks').delete().eq('store_id', storeId).eq('voucher_id', oldV.id)
    }

    // ─────────────────────────────────────────────────────────────
    // 2. تحديث بيانات السند في جدول vouchers
    // ─────────────────────────────────────────────────────────────
    const { data: updatedVoucher, error: updErr } = await supabase
      .from('vouchers')
      .update({
        date: input.date,
        amount: totalAmount,
        cash_amount: effectiveCash,
        checks_amount: effectiveChecks,
        checks_data: input.checks || [],
        cash_box_id: (effectiveCash > 0 && input.cash_box_id) ? input.cash_box_id : (input.cash_box_id || null),
        bank_account_id: input.bank_account_id || null,
        customer_id: input.customer_id || null,
        supplier_id: input.supplier_id || null,
        invoice_id: input.invoice_id !== undefined ? input.invoice_id : oldV.invoice_id,
        purchase_invoice_id: input.purchase_invoice_id !== undefined ? input.purchase_invoice_id : oldV.purchase_invoice_id,
        party_name: input.party_name.trim(),
        payment_method: normMethod,
        category: input.category || null,
        description: input.description.trim(),
        reference: input.reference?.trim() || null,
      })
      .eq('id', input.id)
      .select('*')
      .single()

    if (updErr) throw updErr

    // ─────────────────────────────────────────────────────────────
    // 3. تطبيق الأثر الجديد للسند
    // ─────────────────────────────────────────────────────────────

    // أ) تحديث حركة الخزينة المرتبطة
    if (effectiveCash > 0) {
      const { data: existMovement } = await supabase
        .from('cash_movements')
        .select('id')
        .eq('ref_id', input.id)
        .maybeSingle()

      let boxId = input.cash_box_id
      if (!boxId) {
        const { data: defBox } = await supabase
          .from('cash_boxes')
          .select('id')
          .eq('store_id', storeId)
          .eq('is_default', true)
          .maybeSingle()
        boxId = defBox?.id || null
      }

      if (existMovement) {
        await supabase
          .from('cash_movements')
          .update({
            cash_box_id: boxId,
            amount: effectiveCash,
            party_name: input.party_name.trim(),
            description: `سند ${oldV.type === 'receipt' ? 'قبض' : 'صرف'} ${oldV.voucher_number} — ${input.description.trim()}`,
            date: input.date,
          })
          .eq('id', existMovement.id)
      } else {
        await supabase
          .from('cash_movements')
          .insert({
            store_id: storeId,
            cash_box_id: boxId,
            direction: oldV.type === 'receipt' ? 'in' : 'out',
            amount: effectiveCash,
            source: 'voucher',
            ref_id: input.id,
            party_name: input.party_name.trim(),
            payment_method: 'cash',
            description: `سند ${oldV.type === 'receipt' ? 'قبض' : 'صرف'} ${oldV.voucher_number} — ${input.description.trim()}`,
            date: input.date,
            created_by: user.id,
          })
      }
    } else {
      await supabase
        .from('cash_movements')
        .delete()
        .eq('ref_id', input.id)
        .eq('store_id', storeId)
    }

    // ب) إدراج الشيكات الجديدة كـ كيانات مستقلة وحركاتها
    if (input.checks && input.checks.length > 0 && effectiveChecks > 0) {
      const checkRows = input.checks.map(c => ({
        store_id: storeId,
        type: isReceipt ? 'received' : 'issued',
        check_number: c.check_number.trim(),
        bank_name: c.bank_name.trim(),
        bank_code: c.bank_code?.trim() || null,
        branch_name: c.branch_name?.trim() || null,
        branch_code: c.branch_code?.trim() || null,
        account_number: c.account_number?.trim() || null,
        drawer_name: isReceipt ? (c.drawer_name?.trim() || input.party_name.trim()) : null,
        payee_name: !isReceipt ? (c.payee_name?.trim() || input.party_name.trim()) : null,
        amount: Number(c.amount),
        currency: 'ILS',
        exchange_rate: 1.0,
        amount_ils: Number(c.amount),
        due_date: c.due_date,
        issue_date: c.date || input.date,
        voucher_id: input.id,
        cashbox_id: input.cash_box_id || null,
        status: 'in_portfolio',
        customer_id: input.customer_id || null,
        supplier_id: input.supplier_id || null,
        notes: c.notes?.trim() || `محرر بموجب سند ${isReceipt ? 'قبض' : 'صرف'} ${oldV.voucher_number}`,
        images: c.images || [],
        created_by: user.id,
      }))

      const { data: insertedNewChecks, error: newChecksErr } = await supabase
        .from('checks')
        .upsert(checkRows, { onConflict: 'store_id,voucher_id,check_number' })
        .select('id, check_number')

      if (newChecksErr) {
        console.error('Error inserting updated voucher checks:', newChecksErr)
        return {
          success: false,
          error: `فشل تسجيل الشيكات في محفظة الشيكات: ${newChecksErr.message || 'خطأ غير معروف'}`,
        }
      }

      if (insertedNewChecks && insertedNewChecks.length > 0) {
        const checkOps = insertedNewChecks.map((c: any) => ({
          store_id: storeId,
          check_id: c.id,
          operation_type: 'status_change',
          from_status: 'none',
          to_status: 'in_portfolio',
          operation_date: input.date,
          notes: isReceipt
            ? `تحديث شيك بموجب تعديل سند قبض رقم ${oldV.voucher_number}`
            : `تحديث شيك بموجب تعديل سند صرف رقم ${oldV.voucher_number}`,
          performed_by: user.id,
        }))
        await supabase.from('check_operations').insert(checkOps)
      }
    }

    // ج) تطبيق أثر العميل الجديد
    if (input.customer_id) {
      const { data: newCust } = await supabase
        .from('customers')
        .select('balance, total_paid')
        .eq('id', input.customer_id)
        .single()

      if (newCust) {
        const curBal = Number(newCust.balance || 0)
        const curPaid = Number(newCust.total_paid || 0)

        if (isReceipt) {
          const balanceAfter = curBal - totalAmount
          await supabase.from('customer_ledger').insert({
            store_id: storeId,
            customer_id: input.customer_id,
            type: 'payment',
            date: input.date,
            description: `سند قبض ${oldV.voucher_number} — ${input.description.trim()}`,
            debit: 0,
            credit: totalAmount,
            balance: balanceAfter,
            reference_id: input.id,
            reference_type: 'voucher',
            created_by: user.id,
          })

          await supabase
            .from('customers')
            .update({
              balance: balanceAfter,
              total_paid: curPaid + totalAmount,
            })
            .eq('id', input.customer_id)
        } else {
          const balanceAfter = curBal + totalAmount
          await supabase.from('customer_ledger').insert({
            store_id: storeId,
            customer_id: input.customer_id,
            type: 'refund',
            date: input.date,
            description: `سند صرف للعميل ${oldV.voucher_number} — ${input.description.trim()}`,
            debit: totalAmount,
            credit: 0,
            balance: balanceAfter,
            reference_id: input.id,
            reference_type: 'voucher',
            created_by: user.id,
          })

          await supabase
            .from('customers')
            .update({ balance: balanceAfter })
            .eq('id', input.customer_id)
        }
      }
    }

    // د) تطبيق أثر المورد الجديد
    if (input.supplier_id) {
      const { data: newSupp } = await supabase
        .from('suppliers')
        .select('balance')
        .eq('id', input.supplier_id)
        .single()

      if (newSupp) {
        const curBal = Number(newSupp.balance || 0)
        const newBal = isReceipt ? curBal + totalAmount : curBal - totalAmount
        await supabase
          .from('suppliers')
          .update({ balance: newBal })
          .eq('id', input.supplier_id)
      }
    }

    // هـ) تطبيق أثر الفاتورة الجديدة إن وُجدت
    const effectiveInvoiceId = input.invoice_id || oldV.invoice_id
    if (effectiveInvoiceId) {
      const { data: inv } = await supabase
        .from('invoices')
        .select('total, amount_paid')
        .eq('id', effectiveInvoiceId)
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
          .eq('id', effectiveInvoiceId)
      }
    }

    // و) تطبيق أثر البنك الجديد
    if ((input.payment_method === 'bank' || input.payment_method === 'transfer') && input.bank_account_id) {
      const { data: bAcc } = await supabase
        .from('bank_accounts')
        .select('balance')
        .eq('id', input.bank_account_id)
        .single()

      if (bAcc) {
        const newBal = isReceipt
          ? Number(bAcc.balance || 0) + totalAmount
          : Number(bAcc.balance || 0) - totalAmount
        await supabase
          .from('bank_accounts')
          .update({ balance: newBal, updated_at: new Date().toISOString() })
          .eq('id', input.bank_account_id)
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ترحيل القيد المحاسبي الجديد في دفتر الأستاذ العام
    // ─────────────────────────────────────────────────────────────
    try {
      if (oldV.type === 'receipt') {
        await postReceiptVoucherEntry(input.id, user.id)
      } else {
        await postPaymentVoucherEntry(input.id, user.id)
      }
    } catch (glErr) {
      console.error('Error updating voucher GL entry:', glErr)
    }

    // توثيق في سجل التدقيق المالي
    await logFinancialEvent({
      storeId,
      entityType: 'voucher',
      entityId: input.id,
      entityLabel: oldV.voucher_number,
      action: 'update',
      actorId: user.id,
      details: { old: oldV, updated: updatedVoucher },
    })

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/accounting')
    revalidatePath('/dashboard/finance')
    revalidatePath('/dashboard/accounting/receipts')
    revalidatePath('/dashboard/accounting/payments')
    revalidatePath('/dashboard/accounting/treasury')
    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')

    return { success: true, voucher: updatedVoucher }
  } catch (err: any) {
    console.error('Error updating voucher:', err)
    return { success: false, error: err.message || 'فشل تعديل السند' }
  }
}
