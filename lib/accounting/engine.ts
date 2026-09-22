'use server'

import { createClient } from '@/lib/supabase/server'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'

export interface JournalLineInput {
  account_id: string
  debit: number
  credit: number
  currency?: string
  exchange_rate?: number
  description?: string
}

export interface PostJournalEntryParams {
  storeId: string
  date: string
  description: string
  source: 'invoice' | 'purchase' | 'voucher' | 'sales_return' | 'purchase_return' | 'manual' | 'reversal' | 'closing'
  refId?: string | null
  lines: JournalLineInput[]
  actorId?: string | null
}

/**
 * جلب أو ضمان وجود حساب محاسبي قياسي للمتجر
 */
export async function getOrEnsureAccount(
  supabase: any,
  storeId: string,
  code: string,
  defaultName: string,
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  normalBalance: 'debit' | 'credit' = type === 'asset' || type === 'expense' ? 'debit' : 'credit'
): Promise<string> {
  // 0. فحص ربط الصندوق الافتراضي إن كان الحساب المطلوب هو حساب الصندوق
  if (code === '1001' || defaultName.includes('صندوق') || defaultName.includes('الصندوق')) {
    const { data: defBox } = await supabase
      .from('cash_boxes')
      .select('account_id')
      .eq('store_id', storeId)
      .eq('is_default', true)
      .maybeSingle()

    if (defBox?.account_id) {
      return defBox.account_id
    }
  }

  // 1. البحث بالكود أولاً
  const { data: byCode } = await supabase
    .from('accounts')
    .select('id, is_group, is_active')
    .eq('store_id', storeId)
    .eq('code', code)
    .maybeSingle()

  if (byCode) {
    if (!byCode.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', byCode.id)
    }
    return byCode.id
  }

  // 2. البحث بالاسم والنوع
  const { data: byName } = await supabase
    .from('accounts')
    .select('id, is_group, is_active')
    .eq('store_id', storeId)
    .eq('type', type)
    .ilike('name', `%${defaultName.split(' ')[0]}%`)
    .eq('is_group', false)
    .maybeSingle()

  if (byName) return byName.id

  // 3. إنشاء الحساب إن لم يوجد
  const { data: newAcc, error } = await supabase
    .from('accounts')
    .insert({
      store_id: storeId,
      code,
      name: defaultName,
      type,
      is_group: false,
      is_active: true,
      is_system: true,
      normal_balance: normalBalance,
      balance: 0,
      currency: 'ILS',
    })
    .select('id')
    .single()

  if (error) {
    console.error(`Error creating system account ${code}:`, error)
    // fallback to any non-group account of same type
    const { data: fallback } = await supabase
      .from('accounts')
      .select('id')
      .eq('store_id', storeId)
      .eq('type', type)
      .eq('is_group', false)
      .limit(1)
      .maybeSingle()
    if (fallback) return fallback.id
    throw error
  }

  return newAcc.id
}

/**
 * المحرك المركزي لتسجيل وترحيل قيود اليومية المزدوجة (Post Journal Entry)
 * يضمن:
 * 1. فحص إقفال الفترة المحاسبية
 * 2. التوازن الحسابي الدقيق (إجمالي المدين = إجمالي الدائن)
 * 3. فحص الحسابات (نشطة وليست حسابات تجميعية)
 * 4. الترحيل الفوري وتحديث الأرصدة
 */
export async function postJournalEntry(params: PostJournalEntryParams) {
  const supabase = createClient()

  // 1. التحقق من قفل الفترة
  const periodCheck = await checkIsPeriodClosed(params.storeId, params.date)
  if (periodCheck.isClosed) {
    return {
      success: false,
      error: `لا يمكن ترحيل القيد في فترة محاسبية مقفلة (${periodCheck.periodName})`,
    }
  }

  // 2. التحقق من التوازن الحسابي الصارم
  const totalDebit = params.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
  const totalCredit = params.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
  const diff = Math.abs(totalDebit - totalCredit)

  if (diff > 0.01 || totalDebit <= 0) {
    return {
      success: false,
      error: `القيد المحاسبي غير متوازن! إجمالي المدين (${totalDebit.toFixed(2)}) لا يتطابق مع إجمالي الدائن (${totalCredit.toFixed(2)})`,
    }
  }

  // 3. التحقق من الحسابات ومنع الترحيل على الحسابات التجميعية
  const accountIds = params.lines.map(l => l.account_id)
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, name, code, is_group, is_active, normal_balance, balance')
    .in('id', accountIds)

  if (accErr || !accounts || accounts.length === 0) {
    return { success: false, error: 'تعذر التحقق من الحسابات المحاسبية' }
  }

  const accMap = new Map<string, any>()
  for (const acc of accounts) {
    accMap.set(acc.id, acc)
    if (acc.is_group) {
      return {
        success: false,
        error: `لا يجوز الترحيل المباشر على الحساب التجميعي (${acc.name} - ${acc.code})، يجب اختيار حساب فرعي تحليلي`,
      }
    }
    if (acc.is_active === false) {
      return {
        success: false,
        error: `الحساب المحاسبي (${acc.name} - ${acc.code}) معطل ولا يقبل قيوداً جديدة`,
      }
    }
  }

  // 4. توليد رقم القيد التسلسلي
  const { count } = await supabase
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', params.storeId)

  const datePrefix = params.date.replace(/-/g, '').slice(0, 6)
  const entryNumber = `JV-${datePrefix}-${String((count ?? 0) + 1).padStart(4, '0')}`

  // 5. إدراج رأس القيد في journal_entries بالحالة POSTED
  const { data: entry, error: entryErr } = await supabase
    .from('journal_entries')
    .insert({
      store_id: params.storeId,
      entry_number: entryNumber,
      date: params.date,
      description: params.description.trim(),
      source: params.source,
      ref_id: params.refId || null,
      status: 'posted',
      created_by: params.actorId || null,
    })
    .select('id')
    .single()

  if (entryErr) {
    console.error('Error inserting journal entry:', entryErr)
    return { success: false, error: entryErr.message || 'فشل إدراج القيد' }
  }

  // 6. إدراج بنود القيد في journal_lines
  const linePayloads = params.lines.map((l, idx) => ({
    journal_entry_id: entry.id,
    account_id: l.account_id,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    currency: l.currency || 'ILS',
    exchange_rate: l.exchange_rate || 1.0,
    description: l.description?.trim() || params.description.trim(),
    sort_order: idx + 1,
  }))

  const { error: linesErr } = await supabase.from('journal_lines').insert(linePayloads)
  if (linesErr) {
    console.error('Error inserting journal lines:', linesErr)
    await supabase.from('journal_entries').delete().eq('id', entry.id)
    return { success: false, error: linesErr.message || 'فشل إدراج سطور القيد' }
  }

  // 7. تحديث رصيد الحسابات
  for (const line of params.lines) {
    const acc = accMap.get(line.account_id)
    if (acc) {
      const curBal = Number(acc.balance || 0)
      const d = Number(line.debit || 0)
      const c = Number(line.credit || 0)
      const delta = acc.normal_balance === 'credit' ? (c - d) : (d - c)
      await supabase
        .from('accounts')
        .update({ balance: curBal + delta })
        .eq('id', acc.id)
    }
  }

  // 8. توثيق في سجل التدقيق المالي
  if (params.actorId) {
    await logFinancialEvent({
      storeId: params.storeId,
      entityType: 'voucher',
      entityId: entry.id,
      entityLabel: entryNumber,
      action: 'create',
      actorId: params.actorId,
      details: {
        action: 'post_journal_entry',
        source: params.source,
        totalDebit,
        linesCount: params.lines.length,
      },
    })
  }

  return { success: true, entryId: entry.id, entryNumber }
}

/**
 * إنشاء وترحيل قيد فاتورة مبيعات
 * مدين: العميل أو الصندوق
 * دائن: إيرادات المبيعات
 * (وفي حال وجود تكلفة مخزون: مدين تكلفة المبيعات / دائن المخزون)
 */
export async function postSalesInvoiceEntry(invoiceId: string, actorId?: string | null) {
  const supabase = createClient()

  const { data: inv } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*, product:products(cost_price))')
    .eq('id', invoiceId)
    .single()

  if (!inv || inv.status === 'cancelled') return { success: false, error: 'الفاتورة غير موجودة أو ملغاة' }

  // فحص هل تم ترحيلها مسبقاً
  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('store_id', inv.store_id)
    .eq('ref_id', invoiceId)
    .eq('source', 'invoice')
    .eq('status', 'posted')
    .maybeSingle()

  if (existing) return { success: true, entryId: existing.id }

  const storeId = inv.store_id
  const total = Number(inv.total || 0)
  if (total <= 0) return { success: false, error: 'مبلغ الفاتورة صفر أو سالب' }

  // حسابات الإيراد والذمم والنقدية
  const salesAccId = await getOrEnsureAccount(supabase, storeId, '4001', 'إيرادات المبيعات', 'revenue', 'credit')
  let debitAccId = ''

  if (inv.payment_method === 'cash') {
    debitAccId = await getOrEnsureAccount(supabase, storeId, '1001', 'الصندوق', 'asset', 'debit')
  } else {
    debitAccId = await getCustomerAccount(supabase, storeId, inv.customer_id, inv.customer_name)
  }

  const lines: JournalLineInput[] = [
    {
      account_id: debitAccId,
      debit: total,
      credit: 0,
      description: `فاتورة مبيعات #${inv.invoice_number} - ${inv.customer_name || 'عميل نقدي'}`,
    },
    {
      account_id: salesAccId,
      debit: 0,
      credit: total,
      description: `مبيعات فاتورة #${inv.invoice_number}`,
    },
  ]

  // احتساب تكلفة البضاعة المباعة COGS إن وجدت
  let totalCost = 0
  if (inv.items && inv.items.length > 0) {
    for (const item of inv.items) {
      const cost = Number(item.product?.cost_price || 0)
      if (cost > 0) {
        totalCost += cost * Number(item.quantity || 1)
      }
    }
  }

  if (totalCost > 0) {
    const cogsAccId = await getOrEnsureAccount(supabase, storeId, '5001', 'تكلفة البضاعة المباعة', 'expense', 'debit')
    const invAccId = await getOrEnsureAccount(supabase, storeId, '1201', 'المخزون', 'asset', 'debit')

    lines.push({
      account_id: cogsAccId,
      debit: totalCost,
      credit: 0,
      description: `تكلفة بضاعة فاتورة #${inv.invoice_number}`,
    })
    lines.push({
      account_id: invAccId,
      debit: 0,
      credit: totalCost,
      description: `إخراج مخزون فاتورة #${inv.invoice_number}`,
    })
  }

  return await postJournalEntry({
    storeId,
    date: inv.issue_date || new Date().toISOString().slice(0, 10),
    description: `إثبات فاتورة مبيعات #${inv.invoice_number} - ${inv.customer_name || 'عميل نقدي'}`,
    source: 'invoice',
    refId: inv.id,
    lines,
    actorId,
  })
}

/**
 * جلب أو ربط الحساب المحاسبي الخاص بالعميل في دليل الحسابات
 * يربطه تحت الحساب الرئيسي "ذمم الزبائن" (1101)
 */
export async function getCustomerAccount(
  supabase: any,
  storeId: string,
  customerId?: string | null,
  customerName?: string | null
): Promise<string> {
  const controlAccId = await getOrEnsureAccount(supabase, storeId, '1101', 'ذمم الزبائن', 'asset', 'debit')

  if (!customerId && !customerName) {
    return controlAccId
  }

  const targetName = (customerName || '').trim()

  if (targetName) {
    const { data: subAcc } = await supabase
      .from('accounts')
      .select('id, is_active')
      .eq('store_id', storeId)
      .ilike('name', `%${targetName}%`)
      .eq('type', 'asset')
      .eq('is_group', false)
      .maybeSingle()

    if (subAcc) {
      if (!subAcc.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', subAcc.id)
      }
      return subAcc.id
    }
  }

  return controlAccId
}

export interface PostPosSaleJournalEntriesParams {
  storeId: string
  orderId: string
  orderNumber: string
  invoiceId?: string | null
  invoiceNumber?: string | null
  date: string
  mode: 'pos' | 'account'
  customerId?: string | null
  customerName?: string | null
  totalAmount: number
  totalCost: number
  amountPaid: number
  actorId?: string | null
}

/**
 * تسجيل القيود المحاسبية لنقطة البيع (POS):
 * 1. القيد الأول: تكلفة البضاعة والمخزون (مدين تكلفة البضاعة 5001 / دائن المخزون 1201)
 * 2. القيد الثاني: المبيعات النقدية أو الآجلة:
 *    - بيع نقدي: مدين الصندوق 1001 / دائن المبيعات 4001
 *    - بيع آجل: مدين حساب العميل (أو 1101) / دائن المبيعات 4001
 */
export async function postPosSaleJournalEntries(params: PostPosSaleJournalEntriesParams) {
  const supabase = createClient()
  const {
    storeId,
    orderId,
    orderNumber,
    date,
    mode,
    customerId,
    customerName,
    totalAmount,
    totalCost,
    amountPaid,
    actorId,
  } = params

  const effectiveRefId = params.invoiceId || orderId
  const effectiveDocNumber = params.invoiceNumber || orderNumber

  const results: { cogsEntryId?: string; salesEntryId?: string; errors: string[] } = { errors: [] }

  // 1. القيد الأول: تكلفة البضاعة المباعة والمخزون (إذا كانت هناك تكلفة مسجلة للمنتجات)
  if (totalCost > 0) {
    try {
      const cogsAccId = await getOrEnsureAccount(supabase, storeId, '5001', 'تكلفة البضاعة المباعة', 'expense', 'debit')
      const invAccId = await getOrEnsureAccount(supabase, storeId, '1201', 'المخزون', 'asset', 'debit')

      const cogsLines: JournalLineInput[] = [
        {
          account_id: cogsAccId,
          debit: totalCost,
          credit: 0,
          description: `تكلفة بضاعة مباعة - نقطة البيع #${effectiveDocNumber}`,
        },
        {
          account_id: invAccId,
          debit: 0,
          credit: totalCost,
          description: `صرف مخزون مباع - نقطة البيع #${effectiveDocNumber}`,
        },
      ]

      const cogsRes = await postJournalEntry({
        storeId,
        date,
        description: `قيد تكلفة البضاعة والمخزون - نقطة البيع #${effectiveDocNumber}`,
        source: 'invoice',
        refId: effectiveRefId,
        lines: cogsLines,
        actorId,
      })

      if (cogsRes.success && cogsRes.entryId) {
        results.cogsEntryId = cogsRes.entryId
      } else if (cogsRes.error) {
        results.errors.push(`قيد التكلفة: ${cogsRes.error}`)
      }
    } catch (err: any) {
      console.error('Error posting POS COGS entry:', err)
      results.errors.push(`خطأ في قيد التكلفة: ${err?.message || 'غير معروف'}`)
    }
  }

  // 2. القيد الثاني: إثبات المبيعات وإيراداتها
  if (totalAmount > 0) {
    try {
      const salesAccId = await getOrEnsureAccount(supabase, storeId, '4001', 'إيرادات المبيعات', 'revenue', 'credit')
      const cashAccId = await getOrEnsureAccount(supabase, storeId, '1001', 'الصندوق', 'asset', 'debit')

      const salesLines: JournalLineInput[] = []

      if (mode === 'pos') {
        // بيع نقدي: مدين الصندوق 1001 / دائن المبيعات 4001
        salesLines.push(
          {
            account_id: cashAccId,
            debit: totalAmount,
            credit: 0,
            description: `مقبوضات مبيعات نقدية POS #${effectiveDocNumber}`,
          },
          {
            account_id: salesAccId,
            debit: 0,
            credit: totalAmount,
            description: `إيرادات مبيعات نقدية POS #${effectiveDocNumber}`,
          }
        )
      } else {
        // بيع آجل: مدين حساب العميل / دائن المبيعات 4001
        const customerAccId = await getCustomerAccount(supabase, storeId, customerId, customerName)
        const cashPortion = Math.max(0, Math.min(amountPaid, totalAmount))
        const creditPortion = totalAmount - cashPortion

        if (cashPortion > 0) {
          salesLines.push({
            account_id: cashAccId,
            debit: cashPortion,
            credit: 0,
            description: `دفعة نقدية فورية طلبية #${effectiveDocNumber}`,
          })
        }

        if (creditPortion > 0) {
          salesLines.push({
            account_id: customerAccId,
            debit: creditPortion,
            credit: 0,
            description: `مبيعات آجلة على الحساب - ${customerName || 'عميل آجل'} #${effectiveDocNumber}`,
          })
        }

        salesLines.push({
          account_id: salesAccId,
          debit: 0,
          credit: totalAmount,
          description: `إيرادات مبيعات آجلة POS #${effectiveDocNumber} - ${customerName || 'عميل آجل'}`,
        })
      }

      const salesRes = await postJournalEntry({
        storeId,
        date,
        description: mode === 'pos'
          ? `قيد تسجيل المبيعات النقدية - نقطة البيع #${effectiveDocNumber}`
          : `قيد تسجيل المبيعات الآجلة (${customerName || 'على الحساب'}) - نقطة البيع #${effectiveDocNumber}`,
        source: 'invoice',
        refId: effectiveRefId,
        lines: salesLines,
        actorId,
      })

      if (salesRes.success && salesRes.entryId) {
        results.salesEntryId = salesRes.entryId
      } else if (salesRes.error) {
        results.errors.push(`قيد المبيعات: ${salesRes.error}`)
      }
    } catch (err: any) {
      console.error('Error posting POS Sales entry:', err)
      results.errors.push(`خطأ في قيد المبيعات: ${err?.message || 'غير معروف'}`)
    }
  }

  return {
    success: results.errors.length === 0,
    cogsEntryId: results.cogsEntryId,
    salesEntryId: results.salesEntryId,
    errors: results.errors,
  }
}

/**
 * إنشاء وترحيل قيد سند قبض
 * مدين: الصندوق / محفظة الشيكات
 * دائن: العميل / إيرادات أخرى
 */
export async function postReceiptVoucherEntry(voucherId: string, actorId?: string | null) {
  const supabase = createClient()

  const { data: v } = await supabase
    .from('vouchers')
    .select('*')
    .eq('id', voucherId)
    .single()

  if (!v || v.type !== 'receipt') return { success: false, error: 'سند القبض غير موجود' }

  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('store_id', v.store_id)
    .eq('ref_id', voucherId)
    .eq('source', 'voucher')
    .eq('status', 'posted')
    .maybeSingle()

  if (existing) return { success: true, entryId: existing.id }

  const storeId = v.store_id
  const total = Number(v.amount || 0)
  const cashAmt = Number(v.cash_amount || (v.payment_method === 'cash' ? total : 0))
  const checksAmt = Number(v.checks_amount || (v.payment_method === 'cheque' ? total : 0))

  const lines: JournalLineInput[] = []

  // المدين: الصندوق والشيكات
  if (cashAmt > 0) {
    const cashAccId = await getOrEnsureAccount(supabase, storeId, '1001', 'الصندوق', 'asset', 'debit')
    lines.push({
      account_id: cashAccId,
      debit: cashAmt,
      credit: 0,
      description: `قبض نقدي سند #${v.voucher_number}`,
    })
  }

  if (checksAmt > 0) {
    const checkAccId = await getOrEnsureAccount(supabase, storeId, '1110', 'محفظة الشيكات الواردة (أوراق قبض)', 'asset', 'debit')
    lines.push({
      account_id: checkAccId,
      debit: checksAmt,
      credit: 0,
      description: `قبض شيكات سند #${v.voucher_number}`,
    })
  }

  // إذا لم يكن نقداً ولا شيكاً وكان بنكياً
  if (lines.length === 0 && total > 0) {
    const bankAccId = await getOrEnsureAccount(supabase, storeId, '1002', 'البنك', 'asset', 'debit')
    lines.push({
      account_id: bankAccId,
      debit: total,
      credit: 0,
      description: `قبض بنكي سند #${v.voucher_number}`,
    })
  }

  // الدائن: العميل أو إيراد متنوع
  let creditAccId = ''
  if (v.customer_id) {
    creditAccId = await getCustomerAccount(supabase, storeId, v.customer_id, v.party_name)
  } else {
    creditAccId = await getOrEnsureAccount(supabase, storeId, '4003', 'إيرادات وأرباح متنوعة', 'revenue', 'credit')
  }

  lines.push({
    account_id: creditAccId,
    debit: 0,
    credit: total,
    description: `سداد/قبض من ${v.party_name || 'عميل'} سند #${v.voucher_number}`,
  })

  return await postJournalEntry({
    storeId,
    date: v.date || new Date().toISOString().slice(0, 10),
    description: `سند قبض #${v.voucher_number} - ${v.description || v.party_name || ''}`,
    source: 'voucher',
    refId: v.id,
    lines,
    actorId,
  })
}

/**
 * إنشاء وترحيل قيد سند صرف
 * مدين: المورد / حساب المصروف
 * دائن: الصندوق / البنك / شيكات صادرة
 */
export async function postPaymentVoucherEntry(voucherId: string, actorId?: string | null) {
  const supabase = createClient()

  const { data: v } = await supabase
    .from('vouchers')
    .select('*')
    .eq('id', voucherId)
    .single()

  if (!v || v.type !== 'payment') return { success: false, error: 'سند الصرف غير موجود' }

  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('store_id', v.store_id)
    .eq('ref_id', voucherId)
    .eq('source', 'voucher')
    .eq('status', 'posted')
    .maybeSingle()

  if (existing) return { success: true, entryId: existing.id }

  const storeId = v.store_id
  const total = Number(v.amount || 0)
  const cashAmt = Number(v.cash_amount || (v.payment_method === 'cash' ? total : 0))
  const checksAmt = Number(v.checks_amount || (v.payment_method === 'cheque' ? total : 0))

  const lines: JournalLineInput[] = []

  // المدين: المورد أو المصروف
  let debitAccId = ''
  if (v.supplier_id) {
    debitAccId = await getOrEnsureAccount(supabase, storeId, '2001', 'ذمم الموردين', 'liability', 'credit')
  } else {
    debitAccId = await getOrEnsureAccount(supabase, storeId, '5199', 'مصاريف إدارية وتشغيلية متنوعة', 'expense', 'debit')
  }

  lines.push({
    account_id: debitAccId,
    debit: total,
    credit: 0,
    description: `صرف لـ ${v.party_name || 'جهة'} سند #${v.voucher_number}`,
  })

  // الدائن: الصندوق أو البنك أو الشيكات الصادرة
  if (cashAmt > 0) {
    const cashAccId = await getOrEnsureAccount(supabase, storeId, '1001', 'الصندوق', 'asset', 'debit')
    lines.push({
      account_id: cashAccId,
      debit: 0,
      credit: cashAmt,
      description: `صرف نقدي سند #${v.voucher_number}`,
    })
  }

  if (checksAmt > 0) {
    const checkPayableId = await getOrEnsureAccount(supabase, storeId, '2110', 'شيكات صادرة للموردين (أوراق دفع)', 'liability', 'credit')
    lines.push({
      account_id: checkPayableId,
      debit: 0,
      credit: checksAmt,
      description: `صرف شيك سند #${v.voucher_number}`,
    })
  }

  if (lines.length === 1 && total > 0) {
    const bankAccId = await getOrEnsureAccount(supabase, storeId, '1002', 'البنك', 'asset', 'debit')
    lines.push({
      account_id: bankAccId,
      debit: 0,
      credit: total,
      description: `صرف بنكي سند #${v.voucher_number}`,
    })
  }

  return await postJournalEntry({
    storeId,
    date: v.date || new Date().toISOString().slice(0, 10),
    description: `سند صرف #${v.voucher_number} - ${v.description || v.party_name || ''}`,
    source: 'voucher',
    refId: v.id,
    lines,
    actorId,
  })
}

/**
 * إنشاء وترحيل قيد فاتورة مشتريات
 * مدين: المخزون السلعي
 * دائن: المورد أو الصندوق
 */
export async function postPurchaseInvoiceEntry(purchaseId: string, actorId?: string | null) {
  const supabase = createClient()

  const { data: p } = await supabase
    .from('purchase_invoices')
    .select('*')
    .eq('id', purchaseId)
    .single()

  if (!p) return { success: false, error: 'فاتورة المشتريات غير موجودة' }

  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('store_id', p.store_id)
    .eq('ref_id', purchaseId)
    .eq('source', 'purchase')
    .eq('status', 'posted')
    .maybeSingle()

  if (existing) return { success: true, entryId: existing.id }

  const storeId = p.store_id
  const total = Number(p.total_amount || 0)
  if (total <= 0) return { success: false, error: 'مبلغ الشراء صفر' }

  const invAccId = await getOrEnsureAccount(supabase, storeId, '1201', 'المخزون', 'asset', 'debit')
  let creditAccId = ''

  if (p.payment_method === 'cash') {
    creditAccId = await getOrEnsureAccount(supabase, storeId, '1001', 'الصندوق', 'asset', 'debit')
  } else {
    creditAccId = await getOrEnsureAccount(supabase, storeId, '2001', 'ذمم الموردين', 'liability', 'credit')
  }

  const lines: JournalLineInput[] = [
    {
      account_id: invAccId,
      debit: total,
      credit: 0,
      description: `مشتريات بضاعة فاتورة #${p.invoice_number}`,
    },
    {
      account_id: creditAccId,
      debit: 0,
      credit: total,
      description: `استحقاق مشتريات فاتورة #${p.invoice_number}`,
    },
  ]

  return await postJournalEntry({
    storeId,
    date: p.invoice_date || new Date().toISOString().slice(0, 10),
    description: `إثبات فاتورة مشتريات #${p.invoice_number}`,
    source: 'purchase',
    refId: p.id,
    lines,
    actorId,
  })
}

/**
 * إلغاء وعكس قيد محاسبي عبر قيد عكسي Reversal Entry
 */
export async function reverseJournalEntry(refId: string, reason: string, actorId?: string | null) {
  const supabase = createClient()

  const { data: original } = await supabase
    .from('journal_entries')
    .select('*, lines:journal_lines(*)')
    .eq('ref_id', refId)
    .eq('status', 'posted')
    .maybeSingle()

  if (!original) return { success: true } // لا يوجد قيد لعكسه

  const lines: JournalLineInput[] = (original.lines || []).map((l: any) => ({
    account_id: l.account_id,
    debit: Number(l.credit || 0), // عكس المدين والدائن
    credit: Number(l.debit || 0),
    description: `عكس قيد #${original.entry_number}: ${reason}`,
  }))

  const res = await postJournalEntry({
    storeId: original.store_id,
    date: new Date().toISOString().slice(0, 10),
    description: `قيد عكسي للقيد #${original.entry_number} (${reason})`,
    source: 'reversal',
    refId: original.id,
    lines,
    actorId,
  })

  if (res.success) {
    await supabase
      .from('journal_entries')
      .update({ status: 'cancelled' })
      .eq('id', original.id)
  }

  return res
}

/**
 * المزامنة التلقائية لدفتر الأستاذ العام (Backfill Sync)
 * تضمن ترحيل كل العمليات والفواتير السابقة في قيود يومية مزدوجة متوازنة
 */
export async function syncStoreGeneralLedger(storeId: string, actorId?: string | null) {
  const supabase = createClient()

  const [
    { data: invoices },
    { data: vouchers },
    { data: purchases },
  ] = await Promise.all([
    supabase.from('invoices').select('id').eq('store_id', storeId).neq('status', 'cancelled'),
    supabase.from('vouchers').select('id, type').eq('store_id', storeId),
    supabase.from('purchase_invoices').select('id').eq('store_id', storeId),
  ])

  let postedCount = 0

  if (invoices) {
    for (const inv of invoices) {
      const res = await postSalesInvoiceEntry(inv.id, actorId)
      if (res.success) postedCount++
    }
  }

  if (vouchers) {
    for (const v of vouchers) {
      if (v.type === 'receipt') {
        const res = await postReceiptVoucherEntry(v.id, actorId)
        if (res.success) postedCount++
      } else if (v.type === 'payment') {
        const res = await postPaymentVoucherEntry(v.id, actorId)
        if (res.success) postedCount++
      }
    }
  }

  if (purchases) {
    for (const p of purchases) {
      const res = await postPurchaseInvoiceEntry(p.id, actorId)
      if (res.success) postedCount++
    }
  }

  return { success: true, postedCount }
}
