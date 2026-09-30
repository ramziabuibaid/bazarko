'use server'

import { financialRows } from './complete-read'

import { createClient } from '@/lib/supabase/server'

export type AuditSeverity = 'healthy' | 'notice' | 'warning' | 'critical'

export interface AuditCheckResult {
  id: string
  title: string
  category: 'customers' | 'suppliers' | 'journal' | 'checks' | 'inventory'
  severity: AuditSeverity
  summary: string
  discrepancy: number
  expectedValue?: number
  actualValue?: number
  details: Record<string, any>
  recommendations: string[]
  items?: Array<{
    id: string
    code?: string
    title: string
    value?: number
    extra?: string
  }>
}

export interface FinancialAuditReport {
  timestamp: string
  overallSeverity: AuditSeverity
  healthScore: number // 0 to 100
  checks: AuditCheckResult[]
  stats: {
    criticalCount: number
    warningCount: number
    noticeCount: number
    healthyCount: number
  }
}

export async function runFinancialAudit(storeId: string): Promise<FinancialAuditReport> {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  // ─────────────────────────────────────────────────────────────
  // 1. مطابقة أرصدة الزبائن مع حساب المدينون (Accounts Receivable / 1121)
  // ─────────────────────────────────────────────────────────────
  const { data: customers } = await financialRows(() => supabase
    .from('customers')
    .select('id, name, balance')
    .eq('store_id', storeId))

  const customersTotal = (customers || []).reduce((s, c) => s + Number(c.balance || 0), 0)

  // البحث عن حساب العملاء/المدينون
  const { data: recAccounts } = await financialRows(() => supabase
    .from('accounts')
    .select('id, code, name')
    .eq('store_id', storeId)
    .eq('account_tag', 'CUSTOMER_RECEIVABLE'))

  const recAccountIds = (recAccounts || []).map(a => a.id)

  let recLedgerBalance = 0
  if (recAccountIds.length > 0) {
    const { data: recLines } = await financialRows(() => supabase
      .from('journal_lines')
      .select('debit, credit, journal_entry:journal_entries!inner(status, store_id)')
      .in('account_id', recAccountIds)
      .eq('journal_entry.store_id', storeId)
      .eq('journal_entry.status', 'posted'))

    recLedgerBalance = (recLines || []).reduce((s: number, l: any) => {
      return s + (Number(l.debit || 0) - Number(l.credit || 0))
    }, 0)
  }

  const custDiff = Math.abs(customersTotal - recLedgerBalance)
  let custSeverity: AuditSeverity = 'healthy'
  const custRecommendations: string[] = []

  if (recAccountIds.length === 0) {
    custSeverity = 'warning'
    custRecommendations.push('لم يتم العثور على حساب ذمم مدينون (1121) في شجرة الحسابات. يرجى تهيئة الدليل.')
  } else if (custDiff >= 0.01) {
    custSeverity = custDiff > 1000 ? 'critical' : 'warning'
    custRecommendations.push(
      `يوجد فارق قدره ${custDiff.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })} بين مجموع كشوفات الزبائن وحساب الأستاذ العام (1121).`,
    )
    custRecommendations.push(
      'تأكد من ترحيل كافة فواتير وسندات الزبائن إلى قيود يومية، أو تسجيل قيد افتتاحي بالأرصدة السابقة.',
    )
  }

  const checkCustomers: AuditCheckResult = {
    id: 'check_customers_receivables',
    title: 'مطابقة أرصدة الزبائن مع حساب الذمم المدينة (1121)',
    category: 'customers',
    severity: custSeverity,
    summary:
      custSeverity === 'healthy'
        ? 'أرصدة كشوفات الزبائن متطابقة تماماً مع حساب الذمم المدينة في الأستاذ العام.'
        : `فارق مطابقة: ${custDiff.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })} شيكل بين كشوفات الزبائن والأستاذ العام.`,
    discrepancy: custDiff,
    actualValue: customersTotal,
    expectedValue: recLedgerBalance,
    details: {
      totalCustomers: customers?.length || 0,
      customersTotal,
      recLedgerBalance,
      accounts: recAccounts || [],
    },
    recommendations: custRecommendations,
  }

  // ─────────────────────────────────────────────────────────────
  // 2. مطابقة أرصدة الموردين مع حساب الدائنون (Accounts Payable / 2110)
  // ─────────────────────────────────────────────────────────────
  const { data: suppliers } = await financialRows(() => supabase
    .from('suppliers')
    .select('id, name, balance')
    .eq('store_id', storeId))

  const suppliersTotal = (suppliers || []).reduce((s, sup) => s + Number(sup.balance || 0), 0)

  const { data: payAccounts } = await financialRows(() => supabase
    .from('accounts')
    .select('id, code, name')
    .eq('store_id', storeId)
    .or('code.ilike.211%,code.eq.2110,name.ilike.%موردون%,name.ilike.%دائنون%'))

  const payAccountIds = (payAccounts || []).map(a => a.id)

  let payLedgerBalance = 0
  if (payAccountIds.length > 0) {
    const { data: payLines } = await financialRows(() => supabase
      .from('journal_lines')
      .select('debit, credit, journal_entry:journal_entries!inner(status, store_id)')
      .in('account_id', payAccountIds)
      .eq('journal_entry.store_id', storeId)
      .eq('journal_entry.status', 'posted'))

    payLedgerBalance = (payLines || []).reduce((s: number, l: any) => {
      return s + (Number(l.credit || 0) - Number(l.debit || 0))
    }, 0)
  }

  const suppDiff = Math.abs(suppliersTotal - payLedgerBalance)
  let suppSeverity: AuditSeverity = 'healthy'
  const suppRecommendations: string[] = []

  if (payAccountIds.length === 0) {
    suppSeverity = 'warning'
    suppRecommendations.push('لم يتم العثور على حساب ذمم دائنون (2110) في شجرة الحسابات.')
  } else if (suppDiff >= 0.01) {
    suppSeverity = suppDiff > 1000 ? 'critical' : 'warning'
    suppRecommendations.push(
      `يوجد فارق قدره ${suppDiff.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })} بين مجموع أرصدة الموردين وحساب الأستاذ العام (2110).`,
    )
    suppRecommendations.push('قم بمراجعة فواتير الشراء وسندات الصرف والتأكد من توليد قيودها اليومية.')
  }

  const checkSuppliers: AuditCheckResult = {
    id: 'check_suppliers_payables',
    title: 'مطابقة أرصدة الموردين مع حساب الذمم الدائنة (2110)',
    category: 'suppliers',
    severity: suppSeverity,
    summary:
      suppSeverity === 'healthy'
        ? 'أرصدة كشوفات الموردين متطابقة تماماً مع حساب الذمم الدائنة في الأستاذ العام.'
        : `فارق مطابقة: ${suppDiff.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })} شيكل بين الموردين والأستاذ العام.`,
    discrepancy: suppDiff,
    actualValue: suppliersTotal,
    expectedValue: payLedgerBalance,
    details: {
      totalSuppliers: suppliers?.length || 0,
      suppliersTotal,
      payLedgerBalance,
      accounts: payAccounts || [],
    },
    recommendations: suppRecommendations,
  }

  // ─────────────────────────────────────────────────────────────
  // 3. فحص اتزان القيود المحاسبية (Debit == Credit)
  // ─────────────────────────────────────────────────────────────
  const { data: journalEntries } = await financialRows(() => supabase
    .from('journal_entries')
    .select(`
      id, entry_number, date, description, status,
      journal_lines ( id, debit, credit )
    `)
    .eq('store_id', storeId)
    .eq('status', 'posted'))

  const unbalancedEntries: Array<{
    id: string
    code: string
    title: string
    value: number
    extra: string
  }> = []

  for (const entry of journalEntries || []) {
    const lines = (entry as any).journal_lines || []
    const sumDebit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0)
    const sumCredit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0)
    const diff = Math.abs(sumDebit - sumCredit)

    if (diff > 0.01) {
      unbalancedEntries.push({
        id: entry.id,
        code: entry.entry_number,
        title: entry.description,
        value: diff,
        extra: `مدين: ${sumDebit.toFixed(2)} | دائن: ${sumCredit.toFixed(2)}`,
      })
    }
  }

  const journalSeverity: AuditSeverity = unbalancedEntries.length > 0 ? 'critical' : 'healthy'
  const journalRecommendations: string[] = []
  if (unbalancedEntries.length > 0) {
    journalRecommendations.push(
      `تم اكتشاف ${unbalancedEntries.length} قيد محاسبي غير متزن (المدين لا يساوي الدائن). هذا يخل بميزان المراجعة.`,
    )
    journalRecommendations.push('يرجى الدخول وتعديل أطراف القيود غير المتزنة فوراً.')
  }

  const checkJournal: AuditCheckResult = {
    id: 'check_journal_balance',
    title: 'فحص اتزان القيود اليومية (المدين والدائن)',
    category: 'journal',
    severity: journalSeverity,
    summary:
      unbalancedEntries.length === 0
        ? 'جميع القيود اليومية المرحلة في النظام متزنة تماماً (المدين = الدائن).'
        : `تنبيه حرج: يوجد ${unbalancedEntries.length} قيد محاسبي غير متزن يحتاج للتصحيح.`,
    discrepancy: unbalancedEntries.length,
    items: unbalancedEntries,
    details: {
      totalEntriesChecked: journalEntries?.length || 0,
      unbalancedCount: unbalancedEntries.length,
    },
    recommendations: journalRecommendations,
  }

  // ─────────────────────────────────────────────────────────────
  // 4. فحص محفظة الشيكات (الشيكات المستحقة، المتأخرة، وغير المربوطة)
  // ─────────────────────────────────────────────────────────────
  const { data: checks } = await financialRows(() => supabase
    .from('checks')
    .select('id, check_number, bank_name, amount, amount_ils, due_date, status, type, customer_id, supplier_id')
    .eq('store_id', storeId))

  const rawChecks = checks || []
  const overdueChecks = rawChecks.filter(c => {
    return (
      (c.status === 'in_portfolio' || c.status === 'deposited') &&
      c.due_date &&
      c.due_date < today
    )
  })

  const unlinkedChecks = rawChecks.filter(c => {
    if (c.type === 'received' && !c.customer_id) return true
    if (c.type === 'issued' && !c.supplier_id) return true
    return false
  })

  let checksSeverity: AuditSeverity = 'healthy'
  const checksRecommendations: string[] = []

  if (overdueChecks.length > 0) {
    checksSeverity = 'warning'
    checksRecommendations.push(
      `يوجد ${overdueChecks.length} شيك متأخر التحصيل تجاوز تاريخ استحقاقه وهو لا يزال في المحفظة.`,
    )
  }
  if (unlinkedChecks.length > 0) {
    if (checksSeverity === 'healthy') checksSeverity = 'notice'
    checksRecommendations.push(
      `يوجد ${unlinkedChecks.length} شيك غير مربوط بزبون أو مورد محدد في النظام.`,
    )
  }

  const checkPortfolio: AuditCheckResult = {
    id: 'check_portfolio_integrity',
    title: 'رقابة محفظة الشيكات وتواريخ الاستحقاق',
    category: 'checks',
    severity: checksSeverity,
    summary:
      checksSeverity === 'healthy'
        ? 'محفظة الشيكات منتظمة ولا توجد شيكات متأخرة التحصيل أو أوراق مجهولة الطرف.'
        : `يوجد ${overdueChecks.length} شيك متأخر عن تاريخ الاستحقاق و ${unlinkedChecks.length} شيك بدون طرف محدد.`,
    discrepancy: overdueChecks.length + unlinkedChecks.length,
    details: {
      totalChecks: rawChecks.length,
      overdueCount: overdueChecks.length,
      unlinkedCount: unlinkedChecks.length,
      totalPortfolioValue: rawChecks
        .filter(c => c.status === 'in_portfolio')
        .reduce((s, c) => s + Number(c.amount_ils || c.amount || 0), 0),
    },
    items: overdueChecks.map(c => ({
      id: c.id,
      code: c.check_number,
      title: `${c.bank_name} - استحقاق: ${c.due_date}`,
      value: Number(c.amount_ils || c.amount || 0),
      extra: c.type === 'received' ? 'شيك مقبوض' : 'شيك صادر',
    })),
    recommendations: checksRecommendations,
  }

  // ─────────────────────────────────────────────────────────────
  // 5. فحص سلامة المخزون وحركاته
  // ─────────────────────────────────────────────────────────────
  const { data: products } = await financialRows(() => supabase
    .from('products')
    .select('id, name, sku, stock_quantity')
    .eq('store_id', storeId))

  const rawProducts = products || []
  const negativeStockProducts = rawProducts.filter(p => Number(p.stock_quantity || 0) < 0)

  let inventorySeverity: AuditSeverity = 'healthy'
  const inventoryRecommendations: string[] = []

  if (negativeStockProducts.length > 0) {
    inventorySeverity = 'critical'
    inventoryRecommendations.push(
      `تم رصد ${negativeStockProducts.length} صنف برصيد مخزون سالب. البيع على المكشوف بدون رصيد دفتري يشوه تكلفة البضاعة المباعة (COGS).`,
    )
    inventoryRecommendations.push('أدخل حركات تسوية جرد أو فواتير مشتريات لتصحيح الأرصدة السالبة.')
  }

  const checkInventory: AuditCheckResult = {
    id: 'check_inventory_integrity',
    title: 'فحص سلامة أرصدة المخزون والكميات السالبة',
    category: 'inventory',
    severity: inventorySeverity,
    summary:
      negativeStockProducts.length === 0
        ? 'أرصدة الأصناف سليمة ولا توجد أصناف بكميات سالبة في المستودع.'
        : `تنبيه حرج: يوجد ${negativeStockProducts.length} صنف بكميات سالبة في المستودع.`,
    discrepancy: negativeStockProducts.length,
    items: negativeStockProducts.map(p => ({
      id: p.id,
      code: p.sku || 'بدون باركود',
      title: p.name,
      value: Number(p.stock_quantity || 0),
      extra: 'رصيد سالب',
    })),
    details: {
      totalProducts: rawProducts.length,
      negativeCount: negativeStockProducts.length,
    },
    recommendations: inventoryRecommendations,
  }

  const allChecks = [checkCustomers, checkSuppliers, checkJournal, checkPortfolio, checkInventory]

  const criticalCount = allChecks.filter(c => c.severity === 'critical').length
  const warningCount = allChecks.filter(c => c.severity === 'warning').length
  const noticeCount = allChecks.filter(c => c.severity === 'notice').length
  const healthyCount = allChecks.filter(c => c.severity === 'healthy').length

  let overallSeverity: AuditSeverity = 'healthy'
  if (criticalCount > 0) overallSeverity = 'critical'
  else if (warningCount > 0) overallSeverity = 'warning'
  else if (noticeCount > 0) overallSeverity = 'notice'

  // حساب مؤشر السلامة (Health Score من 100)
  const healthScore = Math.max(
    0,
    100 - criticalCount * 30 - warningCount * 12 - noticeCount * 5,
  )

  return {
    timestamp: new Date().toISOString(),
    overallSeverity,
    healthScore,
    checks: allChecks,
    stats: {
      criticalCount,
      warningCount,
      noticeCount,
      healthyCount,
    },
  }
}
