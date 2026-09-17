import {
  inspectDatHeader,
  parseAccounts,
  parseCustomersAndSuppliers,
  parseBalances,
  parseProducts,
  parseCheques,
  parseAssets,
  parseCostCenters,
  parseSalesmen,
  parseCustomerPrices,
  parseHeaders,
  parseJournalNotes,
  parseEntries,
  parseInvoiceItems,
} from './reader'
import { ExtractedFile } from './unzip'
import { ShamelParsedData, ShamelTableInspection } from './types'
import { reconcileShamelData } from './reconciler'

export const KNOWN_SHAMEL_TABLES: { filename: string; label: string }[] = [
  { filename: 'accounts.dat', label: 'شجرة الحسابات (دليل)' },
  { filename: 'customer.dat', label: 'الزبائن والموردين' },
  { filename: 'balances.dat', label: 'أرصدة الحسابات والعملاء' },
  { filename: 'ctrans.dat', label: 'سجل الحركات وقيود اليومية (الأستاذ)' },
  { filename: 'cpage.dat', label: 'رؤوس وترويسات المستندات المالية' },
  { filename: 'jornotes.dat', label: 'شروحات وملاحظات القيود' },
  { filename: 'stock.dat', label: 'بطاقات الأصناف' },
  { filename: 'sitems.dat', label: 'أرصدة المخزون والمستودعات' },
  { filename: 'strans.dat', label: 'أسطر الفواتير وحركات الأصناف' },
  { filename: 'units.dat', label: 'وحدات القياس والباركودات' },
  { filename: 'cheques.dat', label: 'محفظة الشيكات' },
  { filename: 'bankaccs.dat', label: 'الحسابات البنكية للمنشأة' },
  { filename: 'assets.dat', label: 'الأصول والموجودات الثابتة' },
  { filename: 'costcent.dat', label: 'مراكز التكلفة' },
  { filename: 'salesmen.dat', label: 'مندوبو المبيعات' },
  { filename: 'custlprc.dat', label: 'قوائم أسعار الزبائن' },
]

/**
 * Parses all available Shamel ERP files from an extracted file map.
 */
export function processShamelArchive(files: Map<string, ExtractedFile>): ShamelParsedData {
  const inspections: ShamelTableInspection[] = []

  // 1. Inspect headers
  for (const table of KNOWN_SHAMEL_TABLES) {
    const file = files.get(table.filename)
    if (!file) {
      inspections.push({
        filename: table.filename,
        label: table.label,
        sizeBytes: 0,
        recordLength: 0,
        stride: 0,
        recordCount: 0,
        status: 'missing',
      })
      continue
    }

    const header = inspectDatHeader(file.data)
    inspections.push({
      filename: table.filename,
      label: table.label,
      sizeBytes: file.size,
      recordLength: header.length,
      stride: header.stride,
      recordCount: header.count,
      status: header.count > 0 ? 'detected' : 'empty',
    })
  }

  // 2. Parse balances first (as lookup for accounts & customers)
  let balancesMap: Map<string, number> | undefined
  const balFile = files.get('balances.dat')
  if (balFile) {
    balancesMap = parseBalances(balFile.data)
  }

  // 3. Parse accounts
  const accFile = files.get('accounts.dat')
  const accounts = accFile ? parseAccounts(accFile.data, balancesMap) : []

  // 4. Parse customers & suppliers
  const custFile = files.get('customer.dat')
  const { customers, suppliers } = custFile
    ? parseCustomersAndSuppliers(custFile.data, balancesMap)
    : { customers: [], suppliers: [] }

  // 5. Parse products & inventory
  const stockFile = files.get('stock.dat')
  const sitemsFile = files.get('sitems.dat')
  const unitsFile = files.get('units.dat')
  const products = stockFile
    ? parseProducts(stockFile.data, sitemsFile?.data, unitsFile?.data)
    : []

  // 6. Parse cheques
  const chqFile = files.get('cheques.dat')
  const cheques = chqFile ? parseCheques(chqFile.data) : []

  // Build lookup maps for account names and customer names
  const accountNames = new Map<string, string>()
  for (const a of accounts) {
    if (a.code && a.name) accountNames.set(a.code, a.name)
  }
  const customerNames = new Map<string, string>()
  for (const c of customers) {
    if (c.code && c.name) customerNames.set(c.code, c.name)
  }

  // 7. Parse auxiliary tables (Assets, Cost Centers, Salesmen, Customer Prices)
  const assetsFile = files.get('assets.dat')
  const assets = assetsFile ? parseAssets(assetsFile.data) : []

  const costFile = files.get('costcent.dat')
  const costCenters = costFile ? parseCostCenters(costFile.data) : []

  const salesFile = files.get('salesmen.dat')
  const salesmen = salesFile ? parseSalesmen(salesFile.data) : []

  const priceFile = files.get('custlprc.dat')
  const customerPrices = priceFile ? parseCustomerPrices(priceFile.data) : []

  // 8. Parse Headers & Notes
  const cpageFile = files.get('cpage.dat')
  const headersMap = cpageFile ? parseHeaders(cpageFile.data) : undefined

  const jornotesFile = files.get('jornotes.dat')
  const notesMap = jornotesFile ? parseJournalNotes(jornotesFile.data) : undefined

  // 9. Parse Journal Entries (ctrans.dat)
  const ctransFile = files.get('ctrans.dat')
  const entries = ctransFile ? parseEntries(ctransFile.data, headersMap, notesMap) : []

  // Build lookup from entries for document -> customer account and date
  const docCustomerMap = new Map<string, { code: string; date?: string | null }>()
  for (const e of entries) {
    if (e.document && e.account && e.account.startsWith('C')) {
      docCustomerMap.set(e.document, { code: e.account, date: e.day })
    }
  }

  // Enrich cheques with target_name and customer_name if missing
  for (const chq of cheques) {
    if ((!chq.customer_code || !chq.customer_code.startsWith('C')) && chq.document && docCustomerMap.has(chq.document)) {
      const docMatch = docCustomerMap.get(chq.document)!
      chq.customer_code = docMatch.code
      if (!chq.due_date && docMatch.date) chq.due_date = docMatch.date
    }

    if (!chq.customer_name && chq.customer_code) {
      chq.customer_name = customerNames.get(chq.customer_code) || accountNames.get(chq.customer_code) || ''
    }
    if (!chq.target_name && chq.target_account) {
      chq.target_name = customerNames.get(chq.target_account) || accountNames.get(chq.target_account) || ''
    }
  }

  // 10. Parse Invoice Items (strans.dat)
  const stransFile = files.get('strans.dat')
  const invoiceItems = stransFile ? parseInvoiceItems(stransFile.data) : []

  // Enrich products with cost prices from invoice items if missing
  const itemPriceMap = new Map<string, number>()
  for (const it of invoiceItems) {
    if (it.item_code && it.price > 0 && !itemPriceMap.has(it.item_code)) {
      itemPriceMap.set(it.item_code, it.price)
    }
  }
  for (const p of products) {
    if ((!p.cost_price || p.cost_price === 0) && itemPriceMap.has(p.code)) {
      p.cost_price = itemPriceMap.get(p.code)!
    }
  }

  // 11. Reconcile
  const reconciliation = reconcileShamelData(accounts, customers)

  return {
    accounts,
    customers,
    suppliers,
    products,
    cheques,
    assets,
    costCenters,
    salesmen,
    customerPrices,
    entries,
    invoiceItems,
    inspections,
    reconciliation,
  }
}
