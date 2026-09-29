'use server'

import { createClient } from '@/lib/supabase/server'
import { logFinancialEvent } from '@/lib/accounting/audit'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'
import {
  resolveAccount,
  validateAccountForOperation,
  type AccountTagCode,
  type AccountResolutionResult,
} from '@/lib/accounting/resolver'

export interface JournalLineInput {
  account_id: string
  debit: number
  credit: number
  currency?: string
  exchange_rate?: number
  description?: string
  account_tag_used?: string | null
  source_rule?: string | null
}

export interface PostJournalEntryParams {
  storeId: string
  date: string
  description: string
  source: 'invoice' | 'purchase' | 'voucher' | 'sales_return' | 'purchase_return' | 'manual' | 'reversal' | 'closing' | 'check_op' | 'inventory' | 'transfer'
  refId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  sourceNumber?: string | null
  sourceUrl?: string | null
  accountingRule?: string | null
  sourceModule?: string | null
  lines: JournalLineInput[]
  actorId?: string | null
}

/**
 * المحرك المركزي لتسجيل وترحيل قيود اليومية المزدوجة (Post Journal Entry)
 * يضمن:
 * 1. فحص إقفال الفترة المحاسبية
 * 2. التوازن الحسابي الدقيق (إجمالي المدين = إجمالي الدائن)
 * 3. فحص الحسابات (نشطة وليست حسابات تجميعية)
 * 4. الترحيل الفوري وتحديث الأرصدة
 * 5. التتبع المحاسبي الكامل عبر accounting_rule و source_module و account_tag_used لكل سطر
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
    .select('id, name, code, is_group, is_active, normal_balance, balance, account_tag')
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

  // استنتاج القاعدة المحاسبية والوحدة المرجعية في حال لم تُمرر
  const effectiveRule = params.accountingRule || (
    params.source === 'invoice' ? 'SALE_POSTED' :
    params.source === 'purchase' ? 'PURCHASE_POSTED' :
    params.source === 'voucher' ? (params.sourceType === 'receipt_voucher' ? 'CUSTOMER_PAYMENT_RECEIVED' : 'SUPPLIER_PAYMENT_MADE') :
    params.source === 'sales_return' ? 'SALES_RETURNED' :
    params.source === 'purchase_return' ? 'PURCHASE_RETURNED' :
    params.source === 'check_op' ? 'CHECK_OPERATION' :
    params.source === 'inventory' ? 'INVENTORY_MOVEMENT' :
    params.source === 'transfer' ? 'TREASURY_TRANSFER' :
    'MANUAL_JOURNAL'
  )

  const effectiveModule = params.sourceModule || (
    params.source === 'invoice' ? 'SALES' :
    params.source === 'purchase' ? 'PURCHASES' :
    params.source === 'voucher' ? 'TREASURY' :
    params.source === 'sales_return' ? 'SALES' :
    params.source === 'purchase_return' ? 'PURCHASES' :
    params.source === 'check_op' ? 'CHEQUES' :
    params.source === 'inventory' ? 'INVENTORY' :
    params.source === 'transfer' ? 'TREASURY' :
    'MANUAL'
  )

  // 5. إدراج رأس القيد في journal_entries بالحالة POSTED مع الربط الوثيق بالحركة الأصلية ووسوم التتبع
  const effectiveSourceId = params.sourceId || params.refId || null
  const { data: entry, error: entryErr } = await supabase
    .from('journal_entries')
    .insert({
      store_id: params.storeId,
      entry_number: entryNumber,
      date: params.date,
      description: params.description.trim(),
      source: params.source,
      ref_id: effectiveSourceId,
      source_id: effectiveSourceId,
      source_type: params.sourceType || params.source,
      source_number: params.sourceNumber || null,
      source_url: params.sourceUrl || null,
      accounting_rule: effectiveRule,
      source_module: effectiveModule,
      status: 'posted',
      created_by: params.actorId || null,
    })
    .select('id')
    .single()

  if (entryErr) {
    console.error('Error inserting journal entry:', entryErr)
    return { success: false, error: entryErr.message || 'فشل إدراج القيد' }
  }

  // تحديث العلاقة العكسية journal_entry_id في الجدول المصدري
  if (effectiveSourceId) {
    if (params.source === 'voucher') {
      await supabase.from('vouchers').update({ journal_entry_id: entry.id }).eq('id', effectiveSourceId)
    } else if (params.source === 'invoice') {
      await supabase.from('invoices').update({ journal_entry_id: entry.id }).eq('id', effectiveSourceId)
    } else if (params.source === 'purchase') {
      await supabase.from('purchase_invoices').update({ journal_entry_id: entry.id }).eq('id', effectiveSourceId)
    } else if (params.source === 'sales_return') {
      await supabase.from('sales_returns').update({ journal_entry_id: entry.id }).eq('id', effectiveSourceId)
    } else if (params.source === 'purchase_return') {
      await supabase.from('purchase_returns').update({ journal_entry_id: entry.id }).eq('id', effectiveSourceId)
    }
  }

  // 6. إدراج بنود القيد في journal_lines مع حفظ الوسم المستخدم
  const linePayloads = params.lines.map((l, idx) => ({
    journal_entry_id: entry.id,
    account_id: l.account_id,
    debit: Number(l.debit) || 0,
    credit: Number(l.credit) || 0,
    currency: l.currency || 'ILS',
    exchange_rate: l.exchange_rate || 1.0,
    description: l.description?.trim() || params.description.trim(),
    sort_order: idx + 1,
    account_tag_used: l.account_tag_used || accMap.get(l.account_id)?.account_tag || null,
    source_rule: l.source_rule || effectiveRule,
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
        accountingRule: effectiveRule,
        totalDebit,
        linesCount: params.lines.length,
      },
    })
  }

  return { success: true, entryId: entry.id, entryNumber }
}

/**
 * إنشاء وترحيل قيد فاتورة مبيعات مع تكلفة المخزون عبر الـ Account Resolver
 * 1. قيد تكلفة المبيعات:
 *    Debit: COGS (تكلفة البضاعة المباعة)
 *    Credit: INVENTORY (المخزون السلعي)
 * 2. قيد البيع والتحصيل:
 *    - بيع نقدي: Debit: CASH (الصندوق المحدد) / Credit: SALES_REVENUE
 *    - بيع آجل: Debit: CUSTOMER_RECEIVABLE (الزبون المحدد) / Credit: SALES_REVENUE
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

  const date = inv.issue_date || new Date().toISOString().slice(0, 10)

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

  // 1. قيد تكلفة المبيعات عبر الـ Account Resolver
  if (totalCost > 0) {
    const cogsAcc = await resolveAccount(supabase, 'COGS', { storeId })
    const invAcc = await resolveAccount(supabase, 'INVENTORY', { storeId })

    await postJournalEntry({
      storeId,
      date,
      description: `قيد تكلفة البضاعة والمخزون - فاتورة مبيعات #${inv.invoice_number}`,
      source: 'invoice',
      refId: inv.id,
      sourceType: 'sales_invoice',
      sourceId: inv.id,
      sourceNumber: inv.invoice_number,
      sourceUrl: `/dashboard/accounting/invoices/${inv.id}`,
      accountingRule: 'SALE_COGS_INVENTORY_OUT',
      sourceModule: 'SALES',
      lines: [
        {
          account_id: cogsAcc.accountId,
          debit: totalCost,
          credit: 0,
          description: `تكلفة بضاعة مباعة فاتورة #${inv.invoice_number}`,
          account_tag_used: 'COGS',
          source_rule: 'SALE_COGS',
        },
        {
          account_id: invAcc.accountId,
          debit: 0,
          credit: totalCost,
          description: `إخراج مخزون بضاعة مباعة فاتورة #${inv.invoice_number}`,
          account_tag_used: 'INVENTORY',
          source_rule: 'INVENTORY_OUT',
        },
      ],
      actorId,
    })
  }

  // 2. قيد البيع والتحصيل (نقدي) أو قيد البيع الآجل (آجل) عبر الـ Account Resolver
  const salesAcc = await resolveAccount(supabase, 'SALES_REVENUE', { storeId })
  let debitAccResult: AccountResolutionResult

  const isCash = inv.payment_method === 'cash'

  if (isCash) {
    let cashBoxId: string | null = null
    const { data: cm } = await supabase
      .from('cash_movements')
      .select('cash_box_id')
      .or(`ref_id.eq.${inv.id}${inv.order_id ? `,ref_id.eq.${inv.order_id}` : ''}`)
      .limit(1)
      .maybeSingle()
    if (cm?.cash_box_id) {
      cashBoxId = cm.cash_box_id
    }
    debitAccResult = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId })
  } else {
    debitAccResult = await resolveAccount(supabase, 'CUSTOMER_RECEIVABLE', {
      storeId,
      customerId: inv.customer_id,
      customerName: inv.customer_name,
    })
  }

  const salesRule = isCash ? 'SALE_CASH_POSTED' : 'SALE_CREDIT_POSTED'
  const salesLines: JournalLineInput[] = [
    {
      account_id: debitAccResult.accountId,
      debit: total,
      credit: 0,
      description: isCash
        ? `قبض مبيعات نقدية فاتورة #${inv.invoice_number}`
        : `استحقاق مبيعات آجلة فاتورة #${inv.invoice_number} - ${inv.customer_name || 'عميل آجل'}`,
      account_tag_used: debitAccResult.accountTag,
      source_rule: salesRule,
    },
    {
      account_id: salesAcc.accountId,
      debit: 0,
      credit: total,
      description: `إيرادات مبيعات فاتورة #${inv.invoice_number}`,
      account_tag_used: 'SALES_REVENUE',
      source_rule: salesRule,
    },
  ]

  return await postJournalEntry({
    storeId,
    date,
    description: isCash
      ? `قيد البيع والتحصيل النقدي - فاتورة مبيعات #${inv.invoice_number}`
      : `قيد البيع الآجل - فاتورة مبيعات #${inv.invoice_number} - ${inv.customer_name || 'عميل آجل'}`,
    source: 'invoice',
    refId: inv.id,
    sourceType: 'sales_invoice',
    sourceId: inv.id,
    sourceNumber: inv.invoice_number,
    sourceUrl: `/dashboard/accounting/invoices/${inv.id}`,
    accountingRule: salesRule,
    sourceModule: 'SALES',
    lines: salesLines,
    actorId,
  })
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
  cashBoxId?: string | null
  totalAmount: number
  totalCost: number
  amountPaid: number
  actorId?: string | null
}

/**
 * تسجيل القيود المحاسبية لنقطة البيع (POS) عبر الـ Account Resolver
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

  // 1. القيد الأول: تكلفة البضاعة المباعة والمخزون
  if (totalCost > 0) {
    try {
      const cogsAcc = await resolveAccount(supabase, 'COGS', { storeId })
      const invAcc = await resolveAccount(supabase, 'INVENTORY', { storeId })

      const cogsLines: JournalLineInput[] = [
        {
          account_id: cogsAcc.accountId,
          debit: totalCost,
          credit: 0,
          description: `تكلفة بضاعة مباعة - نقطة البيع #${effectiveDocNumber}`,
          account_tag_used: 'COGS',
          source_rule: 'POS_COGS',
        },
        {
          account_id: invAcc.accountId,
          debit: 0,
          credit: totalCost,
          description: `صرف مخزون مباع - نقطة البيع #${effectiveDocNumber}`,
          account_tag_used: 'INVENTORY',
          source_rule: 'POS_INVENTORY_OUT',
        },
      ]

      const cogsRes = await postJournalEntry({
        storeId,
        date,
        description: `قيد تكلفة البضاعة والمخزون - نقطة البيع #${effectiveDocNumber}`,
        source: 'invoice',
        refId: effectiveRefId,
        accountingRule: 'POS_COGS_INVENTORY_OUT',
        sourceModule: 'SALES',
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
      const salesAcc = await resolveAccount(supabase, 'SALES_REVENUE', { storeId })

      let effectiveCashBoxId = params.cashBoxId
      if (!effectiveCashBoxId && effectiveRefId) {
        const { data: cm } = await supabase
          .from('cash_movements')
          .select('cash_box_id')
          .or(`ref_id.eq.${effectiveRefId},ref_id.eq.${orderId}`)
          .limit(1)
          .maybeSingle()
        if (cm?.cash_box_id) {
          effectiveCashBoxId = cm.cash_box_id
        }
      }

      const cashAcc = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId: effectiveCashBoxId })
      const salesLines: JournalLineInput[] = []
      const posRule = mode === 'pos' ? 'POS_SALE_CASH_POSTED' : 'POS_SALE_CREDIT_POSTED'

      if (mode === 'pos') {
        salesLines.push(
          {
            account_id: cashAcc.accountId,
            debit: totalAmount,
            credit: 0,
            description: `مقبوضات مبيعات نقدية POS #${effectiveDocNumber}`,
            account_tag_used: 'CASH',
            source_rule: posRule,
          },
          {
            account_id: salesAcc.accountId,
            debit: 0,
            credit: totalAmount,
            description: `إيرادات مبيعات نقدية POS #${effectiveDocNumber}`,
            account_tag_used: 'SALES_REVENUE',
            source_rule: posRule,
          }
        )
      } else {
        const custAcc = await resolveAccount(supabase, 'CUSTOMER_RECEIVABLE', { storeId, customerId, customerName })
        const cashPortion = Math.max(0, Math.min(amountPaid, totalAmount))
        const creditPortion = totalAmount - cashPortion

        if (cashPortion > 0) {
          salesLines.push({
            account_id: cashAcc.accountId,
            debit: cashPortion,
            credit: 0,
            description: `دفعة نقدية فورية طلبية #${effectiveDocNumber}`,
            account_tag_used: 'CASH',
            source_rule: posRule,
          })
        }

        if (creditPortion > 0) {
          salesLines.push({
            account_id: custAcc.accountId,
            debit: creditPortion,
            credit: 0,
            description: `مبيعات آجلة على الحساب - ${customerName || 'عميل آجل'} #${effectiveDocNumber}`,
            account_tag_used: 'CUSTOMER_RECEIVABLE',
            source_rule: posRule,
          })
        }

        salesLines.push({
          account_id: salesAcc.accountId,
          debit: 0,
          credit: totalAmount,
          description: `إيرادات مبيعات آجلة POS #${effectiveDocNumber} - ${customerName || 'عميل آجل'}`,
          account_tag_used: 'SALES_REVENUE',
          source_rule: posRule,
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
        accountingRule: posRule,
        sourceModule: 'SALES',
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
 * إنشاء وترحيل قيد سند قبض عبر الـ Account Resolver
 * Debit: الصندوق المحدد بدقة أو البنك أو محفظة الشيكات
 * Credit: ذمم العملاء (أو إيرادات متنوعة)
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
  if (total <= 0) return { success: false, error: 'مبلغ سند القبض صفر أو سالب' }

  const lines: JournalLineInput[] = []
  const cashAmount = Number(v.cash_amount ?? (v.payment_method === 'cash' ? total : 0))
  const checksAmount = Number(v.checks_amount ?? (v.payment_method === 'check' || v.payment_method === 'cheque' ? total : 0))

  let accountingRule = 'CUSTOMER_PAYMENT_CASH'

  // الطرف المدين: الصندوق أو البنك أو محفظة الشيكات
  if ((v.payment_method === 'bank' || v.payment_method === 'transfer') && v.bank_account_id) {
    accountingRule = 'CUSTOMER_PAYMENT_BANK'
    const bankRes = await resolveAccount(supabase, 'BANK', { storeId, bankAccountId: v.bank_account_id })
    lines.push({
      account_id: bankRes.accountId,
      debit: total,
      credit: 0,
      description: `قبض بنكي/تحويل بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
      account_tag_used: 'BANK',
      source_rule: accountingRule,
    })
  } else if (cashAmount > 0 && checksAmount > 0) {
    // سند مركب (نقد + شيكات)
    accountingRule = 'CUSTOMER_PAYMENT_SPLIT'
    const cashRes = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId: v.cash_box_id })
    const checkRes = await resolveAccount(supabase, 'CHEQUES_IN_HAND', { storeId })
    lines.push({
      account_id: cashRes.accountId,
      debit: cashAmount,
      credit: 0,
      description: `قبض نقدي بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
      account_tag_used: 'CASH',
      source_rule: accountingRule,
    })
    lines.push({
      account_id: checkRes.accountId,
      debit: checksAmount,
      credit: 0,
      description: `قبض شيكات بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
      account_tag_used: 'CHEQUES_IN_HAND',
      source_rule: accountingRule,
    })
  } else if (checksAmount > 0 || v.payment_method === 'check' || v.payment_method === 'cheque') {
    // شيكات فقط: محفظة الشيكات الواردة (CHEQUES_IN_HAND)
    accountingRule = 'CUSTOMER_PAYMENT_CHECK'
    const checkRes = await resolveAccount(supabase, 'CHEQUES_IN_HAND', { storeId })
    lines.push({
      account_id: checkRes.accountId,
      debit: total,
      credit: 0,
      description: `قبض شيكات بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
      account_tag_used: 'CHEQUES_IN_HAND',
      source_rule: accountingRule,
    })
  } else {
    // نقد فقط: الصندوق المحدد بدقة
    accountingRule = 'CUSTOMER_PAYMENT_CASH'
    const cashRes = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId: v.cash_box_id })
    lines.push({
      account_id: cashRes.accountId,
      debit: total,
      credit: 0,
      description: `قبض نقدي بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
      account_tag_used: 'CASH',
      source_rule: accountingRule,
    })
  }

  // الطرف الدائن: العميل (حساب ذمم الزبائن) أو إيرادات أخرى
  let creditRes: AccountResolutionResult
  if (v.customer_id || v.party_name) {
    creditRes = await resolveAccount(supabase, 'CUSTOMER_RECEIVABLE', {
      storeId,
      customerId: v.customer_id,
      customerName: v.party_name,
    })
  } else {
    creditRes = await resolveAccount(supabase, 'OTHER_REVENUE', { storeId })
  }

  lines.push({
    account_id: creditRes.accountId,
    debit: 0,
    credit: total,
    description: `سداد/قبض من ${v.party_name || 'العميل'} بموجب سند #${v.voucher_number}`,
    account_tag_used: creditRes.accountTag,
    source_rule: accountingRule,
  })

  return await postJournalEntry({
    storeId,
    date: v.date ? (typeof v.date === 'string' ? v.date.slice(0, 10) : new Date(v.date).toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10),
    description: `سند قبض #${v.voucher_number} - ${v.description || v.party_name || ''}`,
    source: 'voucher',
    refId: v.id,
    sourceType: 'receipt_voucher',
    sourceId: v.id,
    sourceNumber: v.voucher_number,
    sourceUrl: `/dashboard/accounting/receipts/print/${v.id}`,
    accountingRule,
    sourceModule: 'TREASURY',
    lines,
    actorId,
  })
}

/**
 * إنشاء وترحيل قيد سند صرف عبر الـ Account Resolver
 * Debit: ذمم الموردين أو المصروف
 * Credit: الصندوق المحدد بدقة، محفظة الشيكات، أو البنك
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
  if (total <= 0) return { success: false, error: 'مبلغ سند الصرف صفر أو سالب' }

  const lines: JournalLineInput[] = []

  // الطرف المدين: المورد (ذمم الموردين) أو المصروف
  let debitRes: AccountResolutionResult
  if (v.supplier_id || v.party_name) {
    debitRes = await resolveAccount(supabase, 'SUPPLIER_PAYABLE', {
      storeId,
      supplierId: v.supplier_id,
      supplierName: v.party_name,
    })
  } else {
    debitRes = await resolveAccount(supabase, 'GENERAL_EXPENSE', { storeId })
  }

  let accountingRule = 'SUPPLIER_PAYMENT_CASH'

  // الطرف الدائن: الصندوق المحدد، محفظة الشيكات، أو البنك
  const cashAmount = Number(v.cash_amount ?? (v.payment_method === 'cash' ? total : 0))
  const checksAmount = Number(v.checks_amount ?? ((v.payment_method === 'check' || v.payment_method === 'cheque') ? total : 0))

  if ((v.payment_method === 'bank' || v.payment_method === 'transfer') && v.bank_account_id) {
    accountingRule = 'SUPPLIER_PAYMENT_BANK'
    const bankRes = await resolveAccount(supabase, 'BANK', { storeId, bankAccountId: v.bank_account_id })
    lines.push({
      account_id: bankRes.accountId,
      debit: 0,
      credit: total,
      description: `صرف بنكي/تحويل بموجب سند #${v.voucher_number}`,
      account_tag_used: 'BANK',
      source_rule: accountingRule,
    })
  } else if (cashAmount > 0 && checksAmount > 0) {
    accountingRule = 'SUPPLIER_PAYMENT_SPLIT'
    const cashRes = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId: v.cash_box_id })
    const checkRes = await resolveAccount(supabase, 'CHEQUES_IN_HAND', { storeId })
    lines.push({
      account_id: cashRes.accountId,
      debit: 0,
      credit: cashAmount,
      description: `صرف نقدي بموجب سند #${v.voucher_number}`,
      account_tag_used: 'CASH',
      source_rule: accountingRule,
    })
    lines.push({
      account_id: checkRes.accountId,
      debit: 0,
      credit: checksAmount,
      description: `صرف شيكات بموجب سند #${v.voucher_number}`,
      account_tag_used: 'CHEQUES_IN_HAND',
      source_rule: accountingRule,
    })
  } else if (checksAmount > 0 || v.payment_method === 'check' || v.payment_method === 'cheque') {
    accountingRule = 'SUPPLIER_PAYMENT_CHECK'
    const checkRes = await resolveAccount(supabase, 'CHEQUES_IN_HAND', { storeId })
    lines.push({
      account_id: checkRes.accountId,
      debit: 0,
      credit: total,
      description: `صرف شيكات بموجب سند #${v.voucher_number}`,
      account_tag_used: 'CHEQUES_IN_HAND',
      source_rule: accountingRule,
    })
  } else {
    accountingRule = 'SUPPLIER_PAYMENT_CASH'
    const cashRes = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId: v.cash_box_id })
    lines.push({
      account_id: cashRes.accountId,
      debit: 0,
      credit: total,
      description: `صرف نقدي بموجب سند #${v.voucher_number}`,
      account_tag_used: 'CASH',
      source_rule: accountingRule,
    })
  }

  // سطر المدين
  lines.unshift({
    account_id: debitRes.accountId,
    debit: total,
    credit: 0,
    description: `صرف لـ ${v.party_name || 'جهة'} سند #${v.voucher_number}`,
    account_tag_used: debitRes.accountTag,
    source_rule: accountingRule,
  })

  return await postJournalEntry({
    storeId,
    date: v.date ? (typeof v.date === 'string' ? v.date.slice(0, 10) : new Date(v.date).toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10),
    description: `سند صرف #${v.voucher_number} - ${v.description || v.party_name || ''}`,
    source: 'voucher',
    refId: v.id,
    sourceType: 'payment_voucher',
    sourceId: v.id,
    sourceNumber: v.voucher_number,
    sourceUrl: `/dashboard/accounting/payments/print/${v.id}`,
    accountingRule,
    sourceModule: 'TREASURY',
    lines,
    actorId,
  })
}

/**
 * إنشاء وترحيل قيد فاتورة مشتريات عبر الـ Account Resolver
 * Debit: INVENTORY (المخزون السلعي)
 * Credit: SUPPLIER_PAYABLE (المورد) أو CASH (الصندوق)
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

  const invRes = await resolveAccount(supabase, 'INVENTORY', { storeId })
  let creditRes: AccountResolutionResult
  let accountingRule = 'PURCHASE_CREDIT_POSTED'

  if (p.payment_method === 'cash') {
    accountingRule = 'PURCHASE_CASH_POSTED'
    creditRes = await resolveAccount(supabase, 'CASH', { storeId })
  } else {
    accountingRule = 'PURCHASE_CREDIT_POSTED'
    creditRes = await resolveAccount(supabase, 'SUPPLIER_PAYABLE', {
      storeId,
      supplierId: p.supplier_id,
      supplierName: p.supplier_name,
    })
  }

  const lines: JournalLineInput[] = [
    {
      account_id: invRes.accountId,
      debit: total,
      credit: 0,
      description: `مشتريات بضاعة فاتورة #${p.invoice_number}`,
      account_tag_used: 'INVENTORY',
      source_rule: accountingRule,
    },
    {
      account_id: creditRes.accountId,
      debit: 0,
      credit: total,
      description: `استحقاق مشتريات فاتورة #${p.invoice_number}`,
      account_tag_used: creditRes.accountTag,
      source_rule: accountingRule,
    },
  ]

  return await postJournalEntry({
    storeId,
    date: p.invoice_date || new Date().toISOString().slice(0, 10),
    description: `إثبات فاتورة مشتريات #${p.invoice_number}`,
    source: 'purchase',
    refId: p.id,
    sourceType: 'purchase_invoice',
    sourceId: p.id,
    sourceNumber: p.invoice_number,
    sourceUrl: `/dashboard/purchases/${p.id}`,
    accountingRule,
    sourceModule: 'PURCHASES',
    lines,
    actorId,
  })
}

/**
 * توفير التوافقية مع الدوال المساعدة السابقة بالربط مع الـ Account Resolver
 */
export async function getOrEnsureAccount(
  supabase: any,
  storeId: string,
  code: string,
  defaultName: string,
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  normalBalance: 'debit' | 'credit' = type === 'asset' || type === 'expense' ? 'debit' : 'credit',
  accountTag?: string | null
): Promise<string> {
  const effectiveTag = accountTag || (
    code === '5001' ? 'COGS' :
    code === '1201' ? 'INVENTORY' :
    code === '4001' ? 'SALES_REVENUE' :
    code === '4002' ? 'SERVICE_REVENUE' :
    code === '4003' ? 'OTHER_REVENUE' :
    code === '1320' ? 'CHECKS_UNDER_COLLECTION' :
    code === '1330' ? 'CHECKS_BOUNCED' :
    code === '1110' ? 'CHECKS_PORTFOLIO' :
    code === '1400' ? 'CUSTOMER_RECEIVABLE' :
    code === '2100' ? 'SUPPLIER_PAYABLE' :
    code === '5199' ? 'GENERAL_EXPENSE' :
    null
  )

  if (effectiveTag) {
    const res = await resolveAccount(supabase, effectiveTag, { storeId })
    return res.accountId
  }

  // بحث بالكود إن لم يوجد وسم
  const { data: byCode } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('code', code)
    .maybeSingle()

  if (byCode) {
    if (!byCode.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', byCode.id)
    }
    return byCode.id
  }

  const { data: newAcc } = await supabase
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

  return newAcc?.id || ''
}

export async function getCashBoxAccount(
  supabase: any,
  storeId: string,
  cashBoxId?: string | null
): Promise<string> {
  const res = await resolveAccount(supabase, 'CASH', { storeId, cashBoxId })
  return res.accountId
}

export async function getChecksPortfolioAccount(supabase: any, storeId: string): Promise<string> {
  const res = await resolveAccount(supabase, 'CHEQUES_IN_HAND', { storeId })
  return res.accountId
}

export async function getCustomerAccount(
  supabase: any,
  storeId: string,
  customerId?: string | null,
  customerName?: string | null
): Promise<string> {
  const res = await resolveAccount(supabase, 'CUSTOMER_RECEIVABLE', { storeId, customerId, customerName })
  return res.accountId
}

export async function getSupplierAccount(
  supabase: any,
  storeId: string,
  supplierId?: string | null,
  supplierName?: string | null
): Promise<string> {
  const res = await resolveAccount(supabase, 'SUPPLIER_PAYABLE', { storeId, supplierId, supplierName })
  return res.accountId
}

/**
 * حذف قيد اليومية الخاص بعملية مالية وعكس كامل أثره من أرصدة الحسابات
 */
export async function deleteJournalEntryForRef(
  supabase: any,
  storeId: string,
  refId: string,
  source: string,
  actorId?: string | null
) {
  const { data: entries, error } = await supabase
    .from('journal_entries')
    .select('id, entry_number, store_id, lines:journal_lines(id, account_id, debit, credit)')
    .eq('store_id', storeId)
    .eq('ref_id', refId)
    .eq('source', source)

  if (error || !entries || entries.length === 0) return { success: true }

  for (const entry of entries) {
    // عكس أثر سطور القيد على أرصدة شجرة الحسابات
    for (const line of entry.lines || []) {
      const { data: acc } = await supabase
        .from('accounts')
        .select('id, balance, normal_balance')
        .eq('id', line.account_id)
        .single()

      if (acc) {
        const d = Number(line.debit || 0)
        const c = Number(line.credit || 0)
        const delta = acc.normal_balance === 'credit' ? (c - d) : (d - c)
        await supabase
          .from('accounts')
          .update({ balance: Number(acc.balance || 0) - delta })
          .eq('id', acc.id)
      }
    }

    // حذف سطور القيد ثم رأس القيد
    await supabase.from('journal_lines').delete().eq('journal_entry_id', entry.id)
    const { error: delErr } = await supabase.from('journal_entries').delete().eq('id', entry.id)
    if (delErr) {
      await supabase.from('journal_entries').update({ status: 'voided' }).eq('id', entry.id)
    }

    if (actorId) {
      await logFinancialEvent({
        storeId,
        entityType: 'voucher',
        entityId: entry.id,
        entityLabel: entry.entry_number,
        action: 'delete',
        actorId,
        details: { action: 'delete_journal_entry', refId, source },
      })
    }
  }

  return { success: true }
}

/**
 * إلغاء وعكس قيد محاسبي عبر حذف أثره وإرجاع رصيد الحسابات
 */
export async function reverseJournalEntry(refId: string, reason: string, actorId?: string | null) {
  const supabase = createClient()
  const { data: original } = await supabase
    .from('journal_entries')
    .select('id, store_id, source')
    .eq('ref_id', refId)
    .maybeSingle()

  if (!original) return { success: true }

  return await deleteJournalEntryForRef(supabase, original.store_id, refId, original.source, actorId)
}

/**
 * المزامنة التلقائية لدفتر الأستاذ العام (Backfill Sync)
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
