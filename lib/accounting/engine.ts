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
  source: 'invoice' | 'purchase' | 'voucher' | 'sales_return' | 'purchase_return' | 'manual' | 'reversal' | 'closing' | 'check_op' | 'inventory' | 'transfer'
  refId?: string | null
  sourceType?: string | null
  sourceId?: string | null
  sourceNumber?: string | null
  sourceUrl?: string | null
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
  normalBalance: 'debit' | 'credit' = type === 'asset' || type === 'expense' ? 'debit' : 'credit',
  accountTag?: string | null
): Promise<string> {
  // 1. استنتاج أو استخدام وسم الحساب (Account Tag) المعتمد في النظام
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

  // البحث أولاً بواسطة وسم الحساب (Account Tag)
  if (effectiveTag) {
    const { data: byTag } = await supabase
      .from('accounts')
      .select('id, is_group, is_active')
      .eq('store_id', storeId)
      .eq('account_tag', effectiveTag)
      .eq('is_group', false)
      .limit(1)
      .maybeSingle()

    if (byTag) {
      if (!byTag.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', byTag.id)
      }
      return byTag.id
    }
  }

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

  // 2. البحث بالكود أولاً
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

  // 3. البحث بالاسم والنوع
  const { data: byName } = await supabase
    .from('accounts')
    .select('id, is_group, is_active')
    .eq('store_id', storeId)
    .eq('type', type)
    .ilike('name', `%${defaultName.split(' ')[0]}%`)
    .eq('is_group', false)
    .maybeSingle()

  if (byName) return byName.id

  // 4. إنشاء الحساب مع إسناد الوسم المناسب له
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
      account_tag: effectiveTag || null,
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

  // 5. إدراج رأس القيد في journal_entries بالحالة POSTED مع الربط الوثيق بالحركة الأصلية
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

  // 1. قيد تكلفة المبيعات: Depit: تكلفة البضاعة المباعة (5001) / Cridet: مخزون البضاعة (1201)
  if (totalCost > 0) {
    const cogsAccId = await getOrEnsureAccount(supabase, storeId, '5001', 'تكلفة البضاعة المباعة', 'expense', 'debit')
    const invAccId = await getOrEnsureAccount(supabase, storeId, '1201', 'المخزون', 'asset', 'debit')

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
      lines: [
        {
          account_id: cogsAccId,
          debit: totalCost,
          credit: 0,
          description: `تكلفة بضاعة مباعة فاتورة #${inv.invoice_number}`,
        },
        {
          account_id: invAccId,
          debit: 0,
          credit: totalCost,
          description: `إخراج مخزون بضاعة مباعة فاتورة #${inv.invoice_number}`,
        },
      ],
      actorId,
    })
  }

  // 2. قيد البيع والتحصيل (نقدي) أو قيد البيع الآجل (آجل):
  // مبيعات نقدية: Depit: الصندوق المحدد في عملية القبض / Cridet: إيراد المبيعات (4001)
  // بيع آجل: Depit: حساب الزبون المحدد / Cridet: إيراد المبيعات (4001)
  const salesAccId = await getOrEnsureAccount(supabase, storeId, '4001', 'إيرادات المبيعات', 'revenue', 'credit')
  let debitAccId = ''

  if (inv.payment_method === 'cash') {
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
    debitAccId = await getCashBoxAccount(supabase, storeId, cashBoxId)
  } else {
    debitAccId = await getCustomerAccount(supabase, storeId, inv.customer_id, inv.customer_name)
  }

  const isCash = inv.payment_method === 'cash'
  const salesLines: JournalLineInput[] = [
    {
      account_id: debitAccId,
      debit: total,
      credit: 0,
      description: isCash
        ? `قبض مبيعات نقدية فاتورة #${inv.invoice_number}`
        : `استحقاق مبيعات آجلة فاتورة #${inv.invoice_number} - ${inv.customer_name || 'عميل آجل'}`,
    },
    {
      account_id: salesAccId,
      debit: 0,
      credit: total,
      description: `إيرادات مبيعات فاتورة #${inv.invoice_number}`,
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
    lines: salesLines,
    actorId,
  })
}

/**
 * جلب حساب محفظة الشيكات الواردة (أوراق قبض)
 */
export async function getChecksPortfolioAccount(supabase: any, storeId: string): Promise<string> {
  // 1. البحث أولاً بواسطة وسم الحساب CHECKS_PORTFOLIO
  const { data: tagged } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', 'CHECKS_PORTFOLIO')
    .eq('is_group', false)
    .limit(1)
    .maybeSingle()

  if (tagged) {
    if (!tagged.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', tagged.id)
    }
    return tagged.id
  }

  // 2. الرجوع للكود والاسم كبديل احتياطي
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('store_id', storeId)
    .eq('type', 'asset')
    .eq('is_group', false)

  if (accounts && accounts.length > 0) {
    const match = accounts.find((a: any) =>
      a.code === '1110' ||
      a.code === '1300' ||
      a.name.includes('محفظة الشيكات') ||
      a.name.includes('أوراق قبض') ||
      (a.name.includes('شيكات واردة') && !a.name.includes('صندوق'))
    )
    if (match) return match.id
  }

  return await getOrEnsureAccount(supabase, storeId, '1110', 'محفظة الشيكات الواردة (أوراق قبض)', 'asset', 'debit', 'CHECKS_PORTFOLIO')
}

/**
 * جلب أو ربط الحساب المحاسبي الخاص بالعميل في دليل الحسابات
 * يربطه تحت الحساب الرئيسي "ذمم الزبائن / ذمم مدينة" (مع تجنب أي تضارب مع الصناديق والبنوك)
 */
export async function getCustomerAccount(
  supabase: any,
  storeId: string,
  customerId?: string | null,
  customerName?: string | null
): Promise<string> {
  const targetName = (customerName || '').trim()

  // 1. نبحث أولاً عن حساب فرعي تحليلي مخصص للعميل باسمه (مع استبعاد الصناديق والبنوك والشيكات)
  if (targetName) {
    const { data: subAcc } = await supabase
      .from('accounts')
      .select('id, is_active')
      .eq('store_id', storeId)
      .ilike('name', `%${targetName}%`)
      .eq('type', 'asset')
      .eq('is_group', false)
      .not('name', 'ilike', '%صندوق%')
      .not('name', 'ilike', '%بنك%')
      .not('name', 'ilike', '%شيك%')
      .maybeSingle()

    if (subAcc) {
      if (!subAcc.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', subAcc.id)
      }
      return subAcc.id
    }
  }

  // 2. البحث عن الحساب الرئيسي لذمم الزبائن بواسطة وسم CUSTOMER_RECEIVABLE
  const { data: taggedCustAcc } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', 'CUSTOMER_RECEIVABLE')
    .eq('is_group', false)
    .limit(1)
    .maybeSingle()

  if (taggedCustAcc) {
    if (!taggedCustAcc.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', taggedCustAcc.id)
    }
    return taggedCustAcc.id
  }

  // 3. البحث بالاسم والكود 1400 كبديل احتياطي
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, is_active')
    .eq('store_id', storeId)
    .eq('type', 'asset')
    .eq('is_group', false)
    .not('name', 'ilike', '%صندوق%')
    .not('name', 'ilike', '%بنك%')
    .not('name', 'ilike', '%شيك%')

  if (accounts && accounts.length > 0) {
    const bestMatch = accounts.find((a: any) =>
      a.code === '1400' ||
      a.name.includes('ذمم مدينة') ||
      a.name.includes('ذمم الزبائن') ||
      a.name.includes('ذمم العملاء')
    ) || accounts.find((a: any) =>
      a.name.includes('الزبائن') ||
      a.name.includes('العملاء') ||
      a.name.includes('مدين')
    )

    if (bestMatch) {
      if (!bestMatch.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', bestMatch.id)
      }
      return bestMatch.id
    }
  }

  // 4. إن لم يوجد، نضمن وجود الحساب بالوسم CUSTOMER_RECEIVABLE
  return await getOrEnsureAccount(supabase, storeId, '1400', 'ذمم الزبائن', 'asset', 'debit', 'CUSTOMER_RECEIVABLE')
}

/**
 * جلب أو ربط الحساب المحاسبي الخاص بالمورد في دليل الحسابات
 * يربطه تحت الحساب الرئيسي "ذمم الموردين" (2100 أو 2001)
 */
export async function getSupplierAccount(
  supabase: any,
  storeId: string,
  supplierId?: string | null,
  supplierName?: string | null
): Promise<string> {
  const targetName = (supplierName || '').trim()

  if (targetName) {
    const { data: subAcc } = await supabase
      .from('accounts')
      .select('id, is_active')
      .eq('store_id', storeId)
      .ilike('name', `%${targetName}%`)
      .eq('type', 'liability')
      .eq('is_group', false)
      .not('name', 'ilike', '%صندوق%')
      .not('name', 'ilike', '%بنك%')
      .maybeSingle()

    if (subAcc) {
      if (!subAcc.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', subAcc.id)
      }
      return subAcc.id
    }
  }

  // 2. البحث عن الحساب الرئيسي لذمم الموردين بواسطة وسم SUPPLIER_PAYABLE
  const { data: taggedSuppAcc } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', 'SUPPLIER_PAYABLE')
    .eq('is_group', false)
    .limit(1)
    .maybeSingle()

  if (taggedSuppAcc) {
    if (!taggedSuppAcc.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', taggedSuppAcc.id)
    }
    return taggedSuppAcc.id
  }

  // 3. البحث بالاسم والكود 2100 كبديل احتياطي
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, is_active')
    .eq('store_id', storeId)
    .eq('type', 'liability')
    .eq('is_group', false)

  if (accounts && accounts.length > 0) {
    const bestMatch = accounts.find((a: any) =>
      a.code === '2100' ||
      a.code === '2001' ||
      a.name.includes('ذمم الموردين') ||
      a.name.includes('الموردين') ||
      a.name.includes('ذمم دائنة')
    )
    if (bestMatch) {
      if (!bestMatch.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', bestMatch.id)
      }
      return bestMatch.id
    }
  }

  return await getOrEnsureAccount(supabase, storeId, '2100', 'ذمم الموردين', 'liability', 'credit', 'SUPPLIER_PAYABLE')
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
 * تسجيل القيود المحاسبية لنقطة البيع (POS):
 * 1. القيد الأول: تكلفة البضاعة والمخزون (مدين تكلفة البضاعة 5001 / دائن المخزون 1201)
 * 2. القيد الثاني: المبيعات النقدية أو الآجلة:
 *    - بيع نقدي: مدين الصندوق المحدد في عملية القبض / دائن المبيعات 4001
 *    - بيع آجل: مدين حساب الزبون المحدد / دائن المبيعات 4001
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

      // جلب الحساب التحليلي للصندوق المحدد بدقة
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
      const cashAccId = await getCashBoxAccount(supabase, storeId, effectiveCashBoxId)

      const salesLines: JournalLineInput[] = []

      if (mode === 'pos') {
        // بيع نقدي: مدين الصندوق المحدد في القبض / دائن إيراد المبيعات 4001
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
 * جلب أو إنشاء الحساب المحاسبي الخاص بصندوق محدد بدقة
 * يضمن ربط الصندوق بحساب دقيق في الأصول (الرمز 1001، 1002، إلخ)
 */
export async function getCashBoxAccount(
  supabase: any,
  storeId: string,
  cashBoxId?: string | null
): Promise<string> {
  let box: any = null
  if (cashBoxId) {
    const { data: foundBox } = await supabase
      .from('cash_boxes')
      .select('id, name, account_id')
      .eq('id', cashBoxId)
      .eq('store_id', storeId)
      .maybeSingle()
    box = foundBox
  }

  if (!box) {
    const { data: defBox } = await supabase
      .from('cash_boxes')
      .select('id, name, account_id')
      .eq('store_id', storeId)
      .eq('is_default', true)
      .maybeSingle()
    box = defBox
  }

  if (!box) {
    const { data: anyBox } = await supabase
      .from('cash_boxes')
      .select('id, name, account_id')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    box = anyBox
  }

  // 1. إذا كان الصندوق مرتبطاً بحساب بالفعل
  if (box?.account_id) {
    const { data: acc } = await supabase
      .from('accounts')
      .select('id, is_active')
      .eq('id', box.account_id)
      .maybeSingle()
    if (acc) {
      if (!acc.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', acc.id)
      }
      return acc.id
    }
  }

  const boxName = box?.name?.trim() || 'الصندوق الرئيسي'

  // 2. البحث عن حساب يحمل وسم CASH ومطابق لاسم الصندوق
  const { data: taggedNamedAcc } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', 'CASH')
    .ilike('name', `%${boxName}%`)
    .eq('is_group', false)
    .limit(1)
    .maybeSingle()

  if (taggedNamedAcc) {
    if (!taggedNamedAcc.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', taggedNamedAcc.id)
    }
    if (box) {
      await supabase.from('cash_boxes').update({ account_id: taggedNamedAcc.id }).eq('id', box.id)
    }
    return taggedNamedAcc.id
  }

  // 3. البحث عن أي حساب يحمل وسم CASH
  const { data: generalTaggedCash } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', 'CASH')
    .eq('is_group', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (generalTaggedCash) {
    if (!generalTaggedCash.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', generalTaggedCash.id)
    }
    if (box) {
      await supabase.from('cash_boxes').update({ account_id: generalTaggedCash.id }).eq('id', box.id)
    }
    return generalTaggedCash.id
  }

  // 4. إذا لم يوجد: نبحث عن حساب بنفس الاسم والنوع
  const { data: existingAcc } = await supabase
    .from('accounts')
    .select('id, is_active')
    .eq('store_id', storeId)
    .eq('type', 'asset')
    .ilike('name', boxName)
    .maybeSingle()

  if (existingAcc) {
    if (box) {
      await supabase.from('cash_boxes').update({ account_id: existingAcc.id }).eq('id', box.id)
    }
    return existingAcc.id
  }

  // توليد كود محاسبي متاح
  const { data: cashAccounts } = await supabase
    .from('accounts')
    .select('code')
    .eq('store_id', storeId)
    .like('code', '100%')

  const existingCodes = new Set((cashAccounts || []).map((a: any) => a.code))
  let newCode = '1001'
  let counter = 1
  while (existingCodes.has(newCode)) {
    counter++
    newCode = `100${counter}`
  }

  const { data: newAcc, error: createErr } = await supabase
    .from('accounts')
    .insert({
      store_id: storeId,
      code: newCode,
      name: boxName,
      type: 'asset',
      is_group: false,
      is_active: true,
      is_system: true,
      normal_balance: 'debit',
      balance: 0,
      currency: 'ILS',
      account_tag: 'CASH',
    })
    .select('id')
    .single()

  if (createErr) {
    console.error('Error creating cash box account:', createErr)
    return await getOrEnsureAccount(supabase, storeId, '1001', 'الصندوق الرئيسي', 'asset', 'debit', 'CASH')
  }

  if (box) {
    await supabase.from('cash_boxes').update({ account_id: newAcc.id }).eq('id', box.id)
  }

  return newAcc.id
}

/**
 * إنشاء وترحيل قيد سند قبض
 * مدين: حساب الصندوق المحدد بدقة (أو البنك أو محفظة الشيكات حسب طريقة القبض)
 * دائن: العميل / ذمم الزبائن (أو إيرادات أخرى)
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
  const checksAmount = Number(v.checks_amount ?? (v.payment_method === 'check' ? total : 0))

  // الطرف المدين: الصندوق أو البنك أو محفظة الشيكات
  if ((v.payment_method === 'bank' || v.payment_method === 'transfer') && v.bank_account_id) {
    const { data: bAcc } = await supabase
      .from('bank_accounts')
      .select('id, bank_name')
      .eq('id', v.bank_account_id)
      .maybeSingle()
    const debitAccId = await getOrEnsureAccount(supabase, storeId, '1200', bAcc?.bank_name || 'البنك', 'asset', 'debit')
    lines.push({
      account_id: debitAccId,
      debit: total,
      credit: 0,
      description: `قبض بنكي/تحويل بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
    })
  } else if (cashAmount > 0 && checksAmount > 0) {
    // سند مركب (نقد + شيكات)
    const cashAccId = await getCashBoxAccount(supabase, storeId, v.cash_box_id)
    const checkAccId = await getChecksPortfolioAccount(supabase, storeId)
    lines.push({
      account_id: cashAccId,
      debit: cashAmount,
      credit: 0,
      description: `قبض نقدي بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
    })
    lines.push({
      account_id: checkAccId,
      debit: checksAmount,
      credit: 0,
      description: `قبض شيكات بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
    })
  } else if (checksAmount > 0 || v.payment_method === 'check') {
    // شيكات فقط
    const checkAccId = await getChecksPortfolioAccount(supabase, storeId)
    lines.push({
      account_id: checkAccId,
      debit: total,
      credit: 0,
      description: `قبض شيكات بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
    })
  } else {
    // نقد فقط: الصندوق المحدد بدقة من قبل المستخدم في السند
    const debitAccId = await getCashBoxAccount(supabase, storeId, v.cash_box_id)
    lines.push({
      account_id: debitAccId,
      debit: total,
      credit: 0,
      description: `قبض نقدي بموجب سند #${v.voucher_number} - ${v.party_name || ''}`,
    })
  }

  // الطرف الدائن: العميل (حساب ذمم الزبائن / ذمم مدينة)
  let creditAccId = ''
  if (v.customer_id || v.party_name) {
    creditAccId = await getCustomerAccount(supabase, storeId, v.customer_id, v.party_name)
  } else {
    creditAccId = await getOrEnsureAccount(supabase, storeId, '4003', 'إيرادات وأرباح متنوعة', 'revenue', 'credit')
  }

  lines.push({
    account_id: creditAccId,
    debit: 0,
    credit: total,
    description: `سداد/قبض من ${v.party_name || 'العميل'} بموجب سند #${v.voucher_number}`,
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
    lines,
    actorId,
  })
}

/**
 * إنشاء وترحيل قيد سند صرف
 * مدين: المورد (ذمم الموردين) / حساب المصروف
 * دائن: حساب الصندوق المحدد بدقة من قبل المستخدم (أو البنك)
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

  // المدين: المورد (ذمم الموردين) أو المصروف
  let debitAccId = ''
  if (v.supplier_id || v.party_name) {
    debitAccId = await getSupplierAccount(supabase, storeId, v.supplier_id, v.party_name)
  } else {
    debitAccId = await getOrEnsureAccount(supabase, storeId, '5199', 'مصاريف إدارية وتشغيلية متنوعة', 'expense', 'debit')
  }

  lines.push({
    account_id: debitAccId,
    debit: total,
    credit: 0,
    description: `صرف لـ ${v.party_name || 'جهة'} سند #${v.voucher_number}`,
  })

  // الدائن: الصندوق المحدد، محفظة الشيكات، أو البنك
  const cashAmount = Number(v.cash_amount ?? (v.payment_method === 'cash' ? total : 0))
  const checksAmount = Number(v.checks_amount ?? ((v.payment_method === 'check' || v.payment_method === 'cheque') ? total : 0))

  if ((v.payment_method === 'bank' || v.payment_method === 'transfer') && v.bank_account_id) {
    const { data: bAcc } = await supabase
      .from('bank_accounts')
      .select('id, bank_name')
      .eq('id', v.bank_account_id)
      .maybeSingle()
    const creditAccId = await getOrEnsureAccount(supabase, storeId, '1200', bAcc?.bank_name || 'البنك', 'asset', 'debit')
    lines.push({
      account_id: creditAccId,
      debit: 0,
      credit: total,
      description: `صرف بنكي/تحويل بموجب سند #${v.voucher_number}`,
    })
  } else if (cashAmount > 0 && checksAmount > 0) {
    // صرف مركب (نقد + شيكات)
    const cashAccId = await getCashBoxAccount(supabase, storeId, v.cash_box_id)
    const checkAccId = await getChecksPortfolioAccount(supabase, storeId)
    lines.push({
      account_id: cashAccId,
      debit: 0,
      credit: cashAmount,
      description: `صرف نقدي بموجب سند #${v.voucher_number}`,
    })
    lines.push({
      account_id: checkAccId,
      debit: 0,
      credit: checksAmount,
      description: `صرف شيكات بموجب سند #${v.voucher_number}`,
    })
  } else if (checksAmount > 0 || v.payment_method === 'check' || v.payment_method === 'cheque') {
    // قيد رقم 6: صرف بشيك: Cridet: محفظة الشيكات
    const checkAccId = await getChecksPortfolioAccount(supabase, storeId)
    lines.push({
      account_id: checkAccId,
      debit: 0,
      credit: total,
      description: `صرف شيكات بموجب سند #${v.voucher_number}`,
    })
  } else {
    // قيد رقم 5: صرف نقدي: Cridet: الصندوق المحدد
    const creditAccId = await getCashBoxAccount(supabase, storeId, v.cash_box_id)
    lines.push({
      account_id: creditAccId,
      debit: 0,
      credit: total,
      description: `صرف نقدي بموجب سند #${v.voucher_number}`,
    })
  }

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

  if (p.supplier_id || p.supplier_name) {
    creditAccId = await getSupplierAccount(supabase, storeId, p.supplier_id, p.supplier_name)
  } else if (p.payment_method === 'cash') {
    creditAccId = await getCashBoxAccount(supabase, storeId, null)
  } else {
    creditAccId = await getSupplierAccount(supabase, storeId, null, null)
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
    sourceType: 'purchase_invoice',
    sourceId: p.id,
    sourceNumber: p.invoice_number,
    sourceUrl: `/dashboard/purchases/${p.id}`,
    lines,
    actorId,
  })
}

/**
 * حذف قيد اليومية الخاص بعملية مالية وعكس كامل أثره من أرصدة الحسابات
 * يضمن حذف سطور القيد وإعادة رصيد كل حساب في الدليل إلى ما قبل العملية بدقة
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
      // إن تعذر الحذف بسبب قيود خارجية نضع الحالة voided
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
