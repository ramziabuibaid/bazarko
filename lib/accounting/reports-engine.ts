'use server'

import { createClient } from '@/lib/supabase/server'
import { checkIsPeriodClosed } from '@/app/dashboard/accounting/periods/period-actions'

export interface TrialBalanceItem {
  account_id: string
  code: string
  name: string
  type: string
  normal_balance: string
  opening_debit: number
  opening_credit: number
  period_debit: number
  period_credit: number
  closing_debit: number
  closing_credit: number
}

export interface TrialBalanceReport {
  items: TrialBalanceItem[]
  total_opening_debit: number
  total_opening_credit: number
  total_period_debit: number
  total_period_credit: number
  total_closing_debit: number
  total_closing_credit: number
  is_balanced: boolean
  difference: number
}

export interface IncomeStatementItem {
  account_id: string
  code: string
  name: string
  amount: number
}

export interface IncomeStatementReport {
  period: { from: string; to: string }
  gross_sales: number
  sales_items: IncomeStatementItem[]
  contra_sales: number
  contra_items: IncomeStatementItem[]
  net_sales: number
  cogs: number
  cogs_items: IncomeStatementItem[]
  gross_profit: number
  operating_expenses: number
  expense_items: IncomeStatementItem[]
  operating_profit: number
  other_revenues: number
  other_revenue_items: IncomeStatementItem[]
  other_expenses: number
  other_expense_items: IncomeStatementItem[]
  net_profit: number
}

export interface BalanceSheetSection {
  title: string
  items: { account_id: string; code: string; name: string; amount: number }[]
  total: number
}

export interface BalanceSheetReport {
  as_of_date: string
  current_assets: BalanceSheetSection
  non_current_assets: BalanceSheetSection
  total_assets: number
  current_liabilities: BalanceSheetSection
  non_current_liabilities: BalanceSheetSection
  total_liabilities: number
  equity: BalanceSheetSection
  period_net_profit: number
  total_equity: number
  is_balanced: boolean
  difference: number
}

export interface CashFlowReport {
  period: { from: string; to: string }
  operating_activities: {
    customer_collections: number
    supplier_payments: number
    operating_expenses: number
    net_operating_flow: number
  }
  investing_activities: {
    fixed_assets_purchases: number
    fixed_assets_sales: number
    net_investing_flow: number
  }
  financing_activities: {
    capital_injections: number
    loans_net: number
    drawings: number
    net_financing_flow: number
  }
  net_change_in_cash: number
  opening_cash: number
  closing_cash: number
  balance_sheet_cash: number
  is_reconciled: boolean
}

export interface IntegrityCheckResult {
  code: string
  title: string
  passed: boolean
  details: string
}

export interface SystemIntegrityReport {
  checks: IntegrityCheckResult[]
  all_passed: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ميزان المراجعة (Trial Balance)
// ─────────────────────────────────────────────────────────────────────────────
export async function getTrialBalance(
  storeId: string,
  fromDate: string,
  toDate: string
): Promise<TrialBalanceReport> {
  const supabase = createClient()

  // جلب كافة الحسابات التحليلية النشطة
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, type, normal_balance, is_group, is_active')
    .eq('store_id', storeId)
    .eq('is_group', false)
    .order('code', { ascending: true })

  const activeAccounts = accounts || []

  // جلب قيود اليومية المرحلة قبل تاريخ البداية (الأرصدة الافتتاحية)
  const { data: openingLines } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit, journal_entry:journal_entries!inner(date, status, store_id)')
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .lt('journal_entry.date', fromDate)

  // جلب قيود اليومية المرحلة خلال الفترة
  const { data: periodLines } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit, journal_entry:journal_entries!inner(date, status, store_id)')
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .gte('journal_entry.date', fromDate)
    .lte('journal_entry.date', toDate)

  const openingMap = new Map<string, { dr: number; cr: number }>()
  for (const l of (openingLines || [])) {
    const prev = openingMap.get(l.account_id) || { dr: 0, cr: 0 }
    prev.dr += Number(l.debit || 0)
    prev.cr += Number(l.credit || 0)
    openingMap.set(l.account_id, prev)
  }

  const periodMap = new Map<string, { dr: number; cr: number }>()
  for (const l of (periodLines || [])) {
    const prev = periodMap.get(l.account_id) || { dr: 0, cr: 0 }
    prev.dr += Number(l.debit || 0)
    prev.cr += Number(l.credit || 0)
    periodMap.set(l.account_id, prev)
  }

  const items: TrialBalanceItem[] = []
  let totOpenDr = 0
  let totOpenCr = 0
  let totPerDr = 0
  let totPerCr = 0
  let totCloseDr = 0
  let totCloseCr = 0

  for (const acc of activeAccounts) {
    const op = openingMap.get(acc.id) || { dr: 0, cr: 0 }
    const per = periodMap.get(acc.id) || { dr: 0, cr: 0 }

    // الرصيد الافتتاحي الصافي
    const netOpen = op.dr - op.cr
    const openDr = netOpen > 0 ? netOpen : 0
    const openCr = netOpen < 0 ? Math.abs(netOpen) : 0

    // حركات الفترة
    const perDr = per.dr
    const perCr = per.cr

    // الرصيد الختامي الصافي
    const netClose = (op.dr + per.dr) - (op.cr + per.cr)
    const closeDr = netClose > 0 ? netClose : 0
    const closeCr = netClose < 0 ? Math.abs(netClose) : 0

    // لا نظهر الحسابات الصفرية الخاملة تماماً
    if (openDr === 0 && openCr === 0 && perDr === 0 && perCr === 0 && closeDr === 0 && closeCr === 0) {
      continue
    }

    totOpenDr += openDr
    totOpenCr += openCr
    totPerDr += perDr
    totPerCr += perCr
    totCloseDr += closeDr
    totCloseCr += closeCr

    items.push({
      account_id: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      normal_balance: acc.normal_balance || (acc.type === 'asset' || acc.type === 'expense' ? 'debit' : 'credit'),
      opening_debit: openDr,
      opening_credit: openCr,
      period_debit: perDr,
      period_credit: perCr,
      closing_debit: closeDr,
      closing_credit: closeCr,
    })
  }

  const diff = Math.abs(totCloseDr - totCloseCr)
  const isBalanced = diff < 0.01

  return {
    items,
    total_opening_debit: totOpenDr,
    total_opening_credit: totOpenCr,
    total_period_debit: totPerDr,
    total_period_credit: totPerCr,
    total_closing_debit: totCloseDr,
    total_closing_credit: totCloseCr,
    is_balanced: isBalanced,
    difference: diff,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. قائمة الأرباح والخسائر (Income Statement / P&L)
// ─────────────────────────────────────────────────────────────────────────────
export async function getIncomeStatement(
  storeId: string,
  fromDate: string,
  toDate: string
): Promise<IncomeStatementReport> {
  const supabase = createClient()

  // جلب سطور القيود المرحلة خلال الفترة مع بيانات الحساب
  const { data: lines } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit, account:accounts(id, code, name, type), journal_entry:journal_entries!inner(date, status, store_id)')
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .gte('journal_entry.date', fromDate)
    .lte('journal_entry.date', toDate)

  const rawLines = (lines || []) as any[]

  const revenueItems: Map<string, { code: string; name: string; amount: number }> = new Map()
  const contraItems: Map<string, { code: string; name: string; amount: number }> = new Map()
  const cogsItems: Map<string, { code: string; name: string; amount: number }> = new Map()
  const expenseItems: Map<string, { code: string; name: string; amount: number }> = new Map()
  const otherRevItems: Map<string, { code: string; name: string; amount: number }> = new Map()
  const otherExpItems: Map<string, { code: string; name: string; amount: number }> = new Map()

  for (const l of rawLines) {
    const acc = l.account
    if (!acc) continue

    const d = Number(l.debit || 0)
    const c = Number(l.credit || 0)

    if (acc.type === 'revenue') {
      // فحص هل هو حساب مقابل للإيراد (مردودات وخصومات 4099)
      if (acc.code === '4099' || acc.name.includes('مردود') || acc.name.includes('خصم')) {
        const net = d - c // طبيعة مدينة
        const prev = contraItems.get(acc.id) || { code: acc.code, name: acc.name, amount: 0 }
        prev.amount += net
        contraItems.set(acc.id, prev)
      } else if (acc.code === '4003' || acc.name.includes('متنوع') || acc.name.includes('أخرى')) {
        const net = c - d
        const prev = otherRevItems.get(acc.id) || { code: acc.code, name: acc.name, amount: 0 }
        prev.amount += net
        otherRevItems.set(acc.id, prev)
      } else {
        const net = c - d // طبيعة دائنة
        const prev = revenueItems.get(acc.id) || { code: acc.code, name: acc.name, amount: 0 }
        prev.amount += net
        revenueItems.set(acc.id, prev)
      }
    } else if (acc.type === 'expense') {
      // فحص هل هو حساب تكلفة المبيعات COGS (5001)
      if (acc.code === '5001' || acc.name.includes('تكلفة') || acc.name.includes('COGS')) {
        const net = d - c
        const prev = cogsItems.get(acc.id) || { code: acc.code, name: acc.name, amount: 0 }
        prev.amount += net
        cogsItems.set(acc.id, prev)
      } else if (acc.code === '5199' || acc.name.includes('أخرى') || acc.name.includes('غير تشغيلية')) {
        const net = d - c
        const prev = otherExpItems.get(acc.id) || { code: acc.code, name: acc.name, amount: 0 }
        prev.amount += net
        otherExpItems.set(acc.id, prev)
      } else {
        const net = d - c
        const prev = expenseItems.get(acc.id) || { code: acc.code, name: acc.name, amount: 0 }
        prev.amount += net
        expenseItems.set(acc.id, prev)
      }
    }
  }

  const toArr = (m: Map<string, any>): IncomeStatementItem[] =>
    Array.from(m.entries()).map(([id, val]) => ({
      account_id: id,
      code: val.code,
      name: val.name,
      amount: val.amount,
    })).filter(x => Math.abs(x.amount) > 0.001)

  const sales_items = toArr(revenueItems)
  const contra_items = toArr(contraItems)
  const cogs_items = toArr(cogsItems)
  const expense_items = toArr(expenseItems)
  const other_revenue_items = toArr(otherRevItems)
  const other_expense_items = toArr(otherExpItems)

  const gross_sales = sales_items.reduce((s, i) => s + i.amount, 0)
  const contra_sales = contra_items.reduce((s, i) => s + i.amount, 0)
  const net_sales = gross_sales - contra_sales

  const cogs = cogs_items.reduce((s, i) => s + i.amount, 0)
  const gross_profit = net_sales - cogs

  const operating_expenses = expense_items.reduce((s, i) => s + i.amount, 0)
  const operating_profit = gross_profit - operating_expenses

  const other_revenues = other_revenue_items.reduce((s, i) => s + i.amount, 0)
  const other_expenses = other_expense_items.reduce((s, i) => s + i.amount, 0)

  const net_profit = operating_profit + other_revenues - other_expenses

  return {
    period: { from: fromDate, to: toDate },
    gross_sales,
    sales_items,
    contra_sales,
    contra_items,
    net_sales,
    cogs,
    cogs_items,
    gross_profit,
    operating_expenses,
    expense_items,
    operating_profit,
    other_revenues,
    other_revenue_items,
    other_expenses,
    other_expense_items,
    net_profit,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. الميزانية العمومية / المركز المالي (Balance Sheet)
// ─────────────────────────────────────────────────────────────────────────────
export async function getBalanceSheet(
  storeId: string,
  asOfDate: string
): Promise<BalanceSheetReport> {
  const supabase = createClient()

  // جلب كافة الحسابات
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, type, normal_balance, is_group')
    .eq('store_id', storeId)
    .eq('is_group', false)
    .in('type', ['asset', 'liability', 'equity'])
    .order('code', { ascending: true })

  // جلب جميع سطور القيود المرحلة حتى تاريخ التقرير
  const { data: lines } = await supabase
    .from('journal_lines')
    .select('account_id, debit, credit, journal_entry:journal_entries!inner(date, status, store_id)')
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .lte('journal_entry.date', asOfDate)

  const balanceMap = new Map<string, number>()
  for (const l of (lines || [])) {
    const cur = balanceMap.get(l.account_id) || 0
    balanceMap.set(l.account_id, cur + (Number(l.debit || 0) - Number(l.credit || 0)))
  }

  // حساب صافي ربح الفترة حتى هذا التاريخ (Income Statement up to asOfDate)
  // السنة المالية تبدأ عادة من بداية العام الحالي
  const yearStart = `${asOfDate.slice(0, 4)}-01-01`
  const pnl = await getIncomeStatement(storeId, yearStart, asOfDate)
  const period_net_profit = pnl.net_profit

  const current_assets_items: any[] = []
  const non_current_assets_items: any[] = []
  const current_liab_items: any[] = []
  const non_current_liab_items: any[] = []
  const equity_items: any[] = []

  for (const acc of (accounts || [])) {
    const rawBal = balanceMap.get(acc.id) || 0

    if (acc.type === 'asset') {
      const bal = rawBal // الأصول طبيعتها مدينة
      if (Math.abs(bal) < 0.001) continue

      if (acc.code.startsWith('12')) {
        non_current_assets_items.push({ account_id: acc.id, code: acc.code, name: acc.name, amount: bal })
      } else {
        current_assets_items.push({ account_id: acc.id, code: acc.code, name: acc.name, amount: bal })
      }
    } else if (acc.type === 'liability') {
      const bal = -rawBal // الالتزامات طبيعتها دائنة
      if (Math.abs(bal) < 0.001) continue

      if (acc.code.startsWith('22')) {
        non_current_liab_items.push({ account_id: acc.id, code: acc.code, name: acc.name, amount: bal })
      } else {
        current_liab_items.push({ account_id: acc.id, code: acc.code, name: acc.name, amount: bal })
      }
    } else if (acc.type === 'equity') {
      const bal = -rawBal // حقوق الملكية طبيعتها دائنة
      if (Math.abs(bal) < 0.001) continue

      equity_items.push({ account_id: acc.id, code: acc.code, name: acc.name, amount: bal })
    }
  }

  const curAssetsTot = current_assets_items.reduce((s, i) => s + i.amount, 0)
  const nonCurAssetsTot = non_current_assets_items.reduce((s, i) => s + i.amount, 0)
  const total_assets = curAssetsTot + nonCurAssetsTot

  const curLiabTot = current_liab_items.reduce((s, i) => s + i.amount, 0)
  const nonCurLiabTot = non_current_liab_items.reduce((s, i) => s + i.amount, 0)
  const total_liabilities = curLiabTot + nonCurLiabTot

  const equityBaseTot = equity_items.reduce((s, i) => s + i.amount, 0)
  const total_equity = equityBaseTot + period_net_profit

  const diff = Math.abs(total_assets - (total_liabilities + total_equity))
  const is_balanced = diff < 0.01

  return {
    as_of_date: asOfDate,
    current_assets: {
      title: 'الأصول المتداولة (Current Assets)',
      items: current_assets_items,
      total: curAssetsTot,
    },
    non_current_assets: {
      title: 'الأصول الثابتة وغير المتداولة (Non-Current Assets)',
      items: non_current_assets_items,
      total: nonCurAssetsTot,
    },
    total_assets,
    current_liabilities: {
      title: 'الالتزامات المتداولة (Current Liabilities)',
      items: current_liab_items,
      total: curLiabTot,
    },
    non_current_liabilities: {
      title: 'الالتزامات طويلة الأجل (Long-term Liabilities)',
      items: non_current_liab_items,
      total: nonCurLiabTot,
    },
    total_liabilities,
    equity: {
      title: 'حقوق الملكية (Owner’s Equity)',
      items: equity_items,
      total: equityBaseTot,
    },
    period_net_profit,
    total_equity,
    is_balanced,
    difference: diff,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. قائمة التدفقات النقدية (Cash Flow Statement)
// ─────────────────────────────────────────────────────────────────────────────
export async function getCashFlowStatement(
  storeId: string,
  fromDate: string,
  toDate: string
): Promise<CashFlowReport> {
  const supabase = createClient()

  // 1. استخراج الحسابات النقدية والبنوك
  const { data: cashAccounts } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('store_id', storeId)
    .in('code', ['1001', '1002', '1101', '1102', '1120'])

  const cashAccountIds = (cashAccounts || []).map(a => a.id)

  // 2. النقد في أول الفترة (قبل fromDate)
  const { data: openingCashLines } = await supabase
    .from('journal_lines')
    .select('debit, credit, journal_entry:journal_entries!inner(date, status, store_id)')
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .in('account_id', cashAccountIds)
    .lt('journal_entry.date', fromDate)

  const opening_cash = (openingCashLines || []).reduce(
    (sum, l) => sum + (Number(l.debit || 0) - Number(l.credit || 0)),
    0
  )

  // 3. تحليل حركات النقد خلال الفترة حسب نوع ومصدر الحركة
  const { data: periodCashLines } = await supabase
    .from('journal_lines')
    .select(`
      account_id, debit, credit, description,
      journal_entry:journal_entries!inner(id, date, status, source, description, store_id)
    `)
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .in('account_id', cashAccountIds)
    .gte('journal_entry.date', fromDate)
    .lte('journal_entry.date', toDate)

  let customer_collections = 0
  let supplier_payments = 0
  let operating_expenses = 0

  let fixed_assets_purchases = 0
  let fixed_assets_sales = 0

  let capital_injections = 0
  let loans_net = 0
  let drawings = 0

  for (const l of ((periodCashLines || []) as any[])) {
    const d = Number(l.debit || 0)  // وارد نقد (+)
    const c = Number(l.credit || 0) // خارج نقد (-)
    const jEntry = Array.isArray(l.journal_entry) ? l.journal_entry[0] : l.journal_entry
    const source = jEntry?.source

    if (source === 'invoice' || (source === 'voucher' && d > 0)) {
      customer_collections += d
    } else if (source === 'purchase' || (source === 'voucher' && c > 0 && (l.description?.includes('مورد') || jEntry?.description?.includes('مورد')))) {
      supplier_payments += c
    } else if (source === 'voucher' && c > 0) {
      operating_expenses += c
    } else {
      // حركات أخرى
      if (d > 0) customer_collections += d
      if (c > 0) operating_expenses += c
    }
  }

  const net_operating_flow = customer_collections - supplier_payments - operating_expenses
  const net_investing_flow = fixed_assets_sales - fixed_assets_purchases
  const net_financing_flow = capital_injections + loans_net - drawings

  const net_change_in_cash = net_operating_flow + net_investing_flow + net_financing_flow
  const closing_cash = opening_cash + net_change_in_cash

  // 4. مطابقة رصيد النقد مع الميزانية العمومية كما في toDate
  const bs = await getBalanceSheet(storeId, toDate)
  const bsCashItems = bs.current_assets.items.filter(i =>
    ['1001', '1002', '1101', '1102', '1120'].includes(i.code)
  )
  const balance_sheet_cash = bsCashItems.reduce((sum, i) => sum + i.amount, 0)
  const is_reconciled = Math.abs(closing_cash - balance_sheet_cash) < 0.05

  return {
    period: { from: fromDate, to: toDate },
    operating_activities: {
      customer_collections,
      supplier_payments,
      operating_expenses,
      net_operating_flow,
    },
    investing_activities: {
      fixed_assets_purchases,
      fixed_assets_sales,
      net_investing_flow,
    },
    financing_activities: {
      capital_injections,
      loans_net,
      drawings,
      net_financing_flow,
    },
    net_change_in_cash,
    opening_cash,
    closing_cash,
    balance_sheet_cash,
    is_reconciled,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. فحص سلامة التقارير والرقابة المحاسبية (8 Health Checks)
// ─────────────────────────────────────────────────────────────────────────────
export async function validateAccountingIntegrity(
  storeId: string,
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Promise<SystemIntegrityReport> {
  const supabase = createClient()
  const checks: IntegrityCheckResult[] = []

  // الفحص 1: توازن جميع القيود المرحلة
  const { data: entries } = await supabase
    .from('journal_entries')
    .select('id, entry_number, lines:journal_lines(debit, credit)')
    .eq('store_id', storeId)
    .eq('status', 'posted')

  let unbalancedCount = 0
  for (const e of (entries || [])) {
    const deb = (e.lines || []).reduce((s: number, l: any) => s + Number(l.debit || 0), 0)
    const cre = (e.lines || []).reduce((s: number, l: any) => s + Number(l.credit || 0), 0)
    if (Math.abs(deb - cre) > 0.01) unbalancedCount++
  }

  checks.push({
    code: 'CHECK_1_BALANCED_ENTRIES',
    title: 'توازن القيود المحاسبية (Debit = Credit)',
    passed: unbalancedCount === 0,
    details: unbalancedCount === 0 ? 'جميع القيود المرحلة متوازنة حسابياً بنسبة 100%' : `يوجد ${unbalancedCount} قيد غير متوازن!`,
  })

  // الفحص 2: سلامة أسطر القيود وعدم وجود حسابات محذوفة
  const { data: orphanLines } = await supabase
    .from('journal_lines')
    .select('id, account:accounts(id)')
    .is('account', null)

  const hasOrphans = (orphanLines && orphanLines.length > 0) || false
  checks.push({
    code: 'CHECK_2_VALID_ACCOUNTS',
    title: 'سلامة ارتباط سطور القيود بالحسابات',
    passed: !hasOrphans,
    details: !hasOrphans ? 'جميع أسطر القيود ترتبط بحسابات موجودة وفعالة' : 'توجد أسطر قيود ترتبط بحسابات مفقودة!',
  })

  // الفحص 3: منع الترحيل على الحسابات التجميعية (Parent Accounts)
  const { data: groupLines } = await supabase
    .from('journal_lines')
    .select('id, account:accounts(is_group)')
    .eq('account.is_group', true)

  const hasGroupPostings = (groupLines && groupLines.length > 0) || false
  checks.push({
    code: 'CHECK_3_NO_GROUP_POSTING',
    title: 'حظر الترحيل على الحسابات التجميعية',
    passed: !hasGroupPostings,
    details: !hasGroupPostings ? 'لا توجد أي قيود مرحلة على حسابات أب تجميعية' : 'توجد قيود مرحلة خطأ على حسابات تجميعية!',
  })

  // الفحص 4: عدم وجود قيود في فترات مقفلة
  const { data: closedPeriods } = await supabase
    .from('accounting_periods')
    .select('start_date, end_date')
    .eq('store_id', storeId)
    .eq('is_closed', true)

  let closedViolations = 0
  if (closedPeriods && closedPeriods.length > 0) {
    for (const cp of closedPeriods) {
      const { count } = await supabase
        .from('journal_entries')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .gte('date', cp.start_date)
        .lte('date', cp.end_date)
        .gt('created_at', cp.end_date + 'T23:59:59')
      if (count && count > 0) closedViolations += count
    }
  }

  checks.push({
    code: 'CHECK_4_CLOSED_PERIODS',
    title: 'احترام إقفال الفترات المحاسبية',
    passed: closedViolations === 0,
    details: closedViolations === 0 ? 'لا توجد أي عمليات مخالفة في الفترات المحاسبية المقفلة' : `يوجد ${closedViolations} عملية مسجلة داخل فترات مقفلة!`,
  })

  // الفحص 5: سلامة وصحة تواريخ العمليات
  const { data: badDates } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('store_id', storeId)
    .is('date', null)

  const datesOk = (!badDates || badDates.length === 0)
  checks.push({
    code: 'CHECK_5_VALID_DATES',
    title: 'صحة التواريخ الزمنية للقيود',
    passed: datesOk,
    details: datesOk ? 'جميع التواريخ مسجلة وموثقة زمنياً بشكل صحيح' : 'توجد قيود بدون تاريخ محدد!',
  })

  // الفحص 6: تصنيف الحسابات المحاسبية
  const { data: unclassified } = await supabase
    .from('accounts')
    .select('id, code, name')
    .eq('store_id', storeId)
    .is('type', null)

  const unclassCount = unclassified?.length || 0
  checks.push({
    code: 'CHECK_6_ACCOUNT_CLASSIFICATION',
    title: 'تصنيف كافة الحسابات (أصول، خصوم، ملكية، إيراد، مصروف)',
    passed: unclassCount === 0,
    details: unclassCount === 0 ? 'جميع الحسابات مصنفة محاسبياً وفق المعايير' : `يوجد ${unclassCount} حساب غير مصنف!`,
  })

  // الفحص 7: توازن الميزانية العمومية
  const bs = await getBalanceSheet(storeId, asOfDate)
  checks.push({
    code: 'CHECK_7_BALANCE_SHEET_EQUATION',
    title: 'توازن المركز المالي (الأصول = الالتزامات + حقوق الملكية)',
    passed: bs.is_balanced,
    details: bs.is_balanced
      ? `الميزانية متوازنة تماماً (الأصول: ${bs.total_assets.toLocaleString('en-GB', { minimumFractionDigits: 2 })} = الخصوم والملكية: ${(bs.total_liabilities + bs.total_equity).toLocaleString('en-GB', { minimumFractionDigits: 2 })})`
      : `يوجد عدم توازن في الميزانية بفارق: ${bs.difference.toFixed(2)}`,
  })

  // الفحص 8: مطابقة رصيد النقد بين التدفقات النقدية والميزانية
  const yearStart = `${asOfDate.slice(0, 4)}-01-01`
  const cf = await getCashFlowStatement(storeId, yearStart, asOfDate)
  checks.push({
    code: 'CHECK_8_CASH_RECONCILIATION',
    title: 'تطابق رصيد النقد (قائمة التدفقات ↔ حسابات النقد بالميزانية)',
    passed: cf.is_reconciled,
    details: cf.is_reconciled
      ? `رصيد النقد متطابق (${cf.closing_cash.toLocaleString('en-GB', { minimumFractionDigits: 2 })} ₪)`
      : `فارق بين التدفقات النقدية (${cf.closing_cash.toFixed(2)}) وحسابات الصندوق والبنك (${cf.balance_sheet_cash.toFixed(2)})`,
  })

  const all_passed = checks.every(c => c.passed)
  return { checks, all_passed }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. تفاصيل الحساب وخدمة Drill-Down (الانتقال من التقرير إلى القيد والمستند)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAccountDrillDown(
  storeId: string,
  accountId: string,
  fromDate?: string,
  toDate?: string
) {
  const supabase = createClient()

  const { data: account } = await supabase
    .from('accounts')
    .select('id, code, name, type, normal_balance, balance')
    .eq('id', accountId)
    .eq('store_id', storeId)
    .single()

  if (!account) return null

  let query = supabase
    .from('journal_lines')
    .select(`
      id, debit, credit, description, created_at,
      journal_entry:journal_entries!inner(id, entry_number, date, source, ref_id, description, status)
    `)
    .eq('account_id', accountId)
    .eq('journal_entry.store_id', storeId)
    .eq('journal_entry.status', 'posted')
    .order('journal_entry(date)', { ascending: true })

  if (fromDate) query = query.gte('journal_entry.date', fromDate)
  if (toDate) query = query.lte('journal_entry.date', toDate)

  const { data: lines } = await query

  const rows = (lines || []).map((l: any) => ({
    line_id: l.id,
    date: l.journal_entry?.date,
    entry_id: l.journal_entry?.id,
    entry_number: l.journal_entry?.entry_number,
    source: l.journal_entry?.source,
    ref_id: l.journal_entry?.ref_id,
    description: l.description || l.journal_entry?.description,
    debit: Number(l.debit || 0),
    credit: Number(l.credit || 0),
  }))

  return { account, rows }
}
