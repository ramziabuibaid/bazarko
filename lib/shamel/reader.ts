import {
  ShamelAccount,
  ShamelCustomer,
  ShamelSupplier,
  ShamelProduct,
  ShamelCheque,
  ShamelAsset,
  ShamelCostCenter,
  ShamelSalesman,
  ShamelCustomerPrice,
  ShamelTableInspection,
  ShamelEntry,
  ShamelInvoiceItem,
} from './types'

const PAGE = 4096

// Native CP-1256 decoder (standard in modern Browsers & Node 18+)
const td1256 = new TextDecoder('windows-1256')

export function decodeCp1256(bytes: Uint8Array): string {
  const nullIdx = bytes.indexOf(0)
  const slice = nullIdx !== -1 ? bytes.subarray(0, nullIdx) : bytes
  return td1256.decode(slice).trim()
}

export function readUInt(view: DataView, offset: number, size = 2): number {
  if (offset + size > view.byteLength) return 0
  return size === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true)
}

export function readDoubleLE(view: DataView, offset: number): number {
  if (offset + 8 > view.byteLength) return 0
  try {
    const val = view.getFloat64(offset, true)
    return isFinite(val) && Math.abs(val) < 1e14 ? Math.round(val * 100) / 100 : 0
  } catch {
    return 0
  }
}

export interface HeaderInfo {
  valid: boolean
  sequence: number
  length: number
  stride: number
  count: number
}

/**
 * Inspects a FoxPro / Btrieve DAT file buffer to extract header metrics.
 */
export function inspectDatHeader(data: Uint8Array): HeaderInfo {
  if (data.byteLength < PAGE * 3) {
    return { valid: false, sequence: 0, length: 0, stride: 0, count: 0 }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const candidateOffsets = [0, 8192]
  let bestHeader: { seq: number; len: number; stride: number; count: number } | null = null

  for (const o of candidateOffsets) {
    if (o + PAGE > data.byteLength) continue
    // Check FC signature
    if (data[o] === 0x46 && data[o + 1] === 0x43) { // 'FC'
      const seq = readUInt(view, o + 4, 4)
      const len = readUInt(view, o + 22, 2)
      const stride = readUInt(view, o + 24, 2)
      const count = (readUInt(view, o + 26, 2) << 16) | readUInt(view, o + 28, 2)

      if (!bestHeader || seq > bestHeader.seq) {
        bestHeader = { seq, len, stride, count }
      }
    }
  }

  if (!bestHeader) {
    return { valid: false, sequence: 0, length: 0, stride: 0, count: 0 }
  }

  return {
    valid: true,
    sequence: bestHeader.seq,
    length: bestHeader.len,
    stride: bestHeader.stride,
    count: bestHeader.count,
  }
}

/**
 * Fast record iterator over Btrieve data pages.
 */
export function* iterateRecords(data: Uint8Array, header?: HeaderInfo): Generator<Uint8Array> {
  const h = header || inspectDatHeader(data)
  if (!h.valid || h.stride <= 0 || h.length <= 0) return

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const { length, stride } = h

  for (let o = 0; o < data.byteLength; o += PAGE) {
    // Check page signature: 'D\0' at offset 4
    if (data[o + 4] !== 0x44 || data[o + 5] !== 0x00) continue

    for (let slot = o + 8; slot <= o + PAGE - stride; slot += stride) {
      if (view.getUint16(slot, true) === 0) continue
      const recordOffset = slot + 2
      if (recordOffset + length <= data.byteLength) {
        yield data.subarray(recordOffset, recordOffset + length)
      }
    }
  }
}

/**
 * Parses ACCOUNTS.DAT and builds chart of accounts.
 */
export function parseAccounts(data: Uint8Array, balancesMap?: Map<string, number>): ShamelAccount[] {
  const accounts: ShamelAccount[] = []
  const seen = new Set<string>()

  for (const r of iterateRecords(data)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code || seen.has(code)) continue
    seen.add(code)

    const parent_code = decodeCp1256(r.subarray(9, 18))
    const name = decodeCp1256(r.subarray(18, 80))

    // Palestinian Accounting Standard classification by root digit
    let type: ShamelAccount['type'] = 'asset'
    const firstChar = code.charAt(0)
    if (firstChar === '1') type = 'asset'
    else if (firstChar === '2') type = 'liability'
    else if (firstChar === '3') type = 'equity'
    else if (firstChar === '4') type = 'revenue'
    else if (firstChar === '5') type = 'expense'
    else if (firstChar === '9') type = 'equity'

    const balance = balancesMap?.get(code) || 0

    accounts.push({
      code,
      name: name || `حساب ${code}`,
      parent_code,
      type,
      is_group: false, // Calculated later
      currency: 'ILS',
      balance,
    })
  }

  // Calculate is_group: if any account has this code as parent_code
  const parentCodes = new Set(accounts.map(a => a.parent_code).filter(Boolean))
  for (const acc of accounts) {
    if (parentCodes.has(acc.code)) {
      acc.is_group = true
    }
  }

  return accounts
}

/**
 * Parses customer.dat and BALANCES.DAT to extract customers and suppliers.
 */
export function parseCustomersAndSuppliers(
  custData: Uint8Array,
  balancesMap?: Map<string, number>
): { customers: ShamelCustomer[]; suppliers: ShamelSupplier[] } {
  const customers: ShamelCustomer[] = []
  const suppliers: ShamelSupplier[] = []
  const seen = new Set<string>()

  for (const r of iterateRecords(custData)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code || seen.has(code)) continue
    seen.add(code)

    const name = decodeCp1256(r.subarray(9, 60))
    const phone = decodeCp1256(r.subarray(151, 162))
    const address = decodeCp1256(r.subarray(60, 110))
    const balance = balancesMap?.get(code) || 0

    if (code.toUpperCase().startsWith('S')) {
      suppliers.push({ code, name: name || `مورد ${code}`, phone, address, balance })
    } else {
      customers.push({ code, name: name || `زبون ${code}`, phone, address, balance })
    }
  }

  return { customers, suppliers }
}

/**
 * Parses BALANCES.DAT into a lookup map of code -> net balance.
 */
export function parseBalances(data: Uint8Array): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of iterateRecords(data)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code) continue
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    const bal = -readDoubleLE(view, 21) // Balances in Shamel are stored inverted
    map.set(code, (map.get(code) || 0) + bal)
  }
  return map
}

/**
 * Parses stock.dat, sitems.dat, and units.dat for inventory and products.
 */
export function parseProducts(
  stockData: Uint8Array,
  sitemsData?: Uint8Array,
  unitsData?: Uint8Array
): ShamelProduct[] {
  const stockMap = new Map<string, number>()
  if (sitemsData) {
    for (const r of iterateRecords(sitemsData)) {
      const code = decodeCp1256(r.subarray(0, 9))
      if (!code) continue
      const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
      const qty = readDoubleLE(view, 27)
      stockMap.set(code, (stockMap.get(code) || 0) + qty)
    }
  }

  const barcodeMap = new Map<string, string>()
  if (unitsData) {
    for (const r of iterateRecords(unitsData)) {
      const code = decodeCp1256(r.subarray(0, 9))
      const barcode = decodeCp1256(r.subarray(9, 30))
      if (code && barcode && !barcodeMap.has(code)) {
        barcodeMap.set(code, barcode)
      }
    }
  }

  const products: ShamelProduct[] = []
  const seen = new Set<string>()

  for (const r of iterateRecords(stockData)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code || seen.has(code)) continue
    seen.add(code)

    const name = decodeCp1256(r.subarray(18, 69))
    const rawBarcode = decodeCp1256(r.subarray(9, 18))
    const barcode = barcodeMap.get(code) || (rawBarcode.startsWith('MS') ? '' : rawBarcode)

    // Inspect possible prices
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    let price = 0
    let cost_price = 0

    // Typical prices in stock.dat are around offset 70-120
    for (let o = 70; o <= 120; o += 8) {
      const p = readDoubleLE(view, o)
      if (p > 0 && p < 100000) {
        if (!price) price = p
        else if (!cost_price && p < price) cost_price = p
      }
    }

    const stock_quantity = stockMap.get(code) || 0

    products.push({
      code,
      name: name || `صنف ${code}`,
      barcode,
      price,
      cost_price: cost_price || Math.round(price * 0.75 * 100) / 100,
      stock_quantity,
    })
  }

  return products
}

/**
 * Parses CHEQUES.DAT for checks portfolio.
 */
export function parseCheques(data: Uint8Array): ShamelCheque[] {
  const cheques: ShamelCheque[] = []
  const seen = new Set<string>()

  for (const r of iterateRecords(data)) {
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)

    // Check document format at offset 10..19 or offset 0..9
    let doc = decodeCp1256(r.subarray(10, 19))
    let cheque_no = ''
    let bank_code = ''
    let branch_code = ''
    let account_number = ''
    let customer_code = ''
    let amount = 0
    let due_date: string | null = null
    let status_code = 0
    let target_account = ''
    let action_doc = ''

    if (/^[RPCJ]\d{7}$/.test(doc)) {
      cheque_no = decodeCp1256(r.subarray(27, 40))
      const d = r[36], m = r[37], y = view.getUint16(38, true)
      if (y >= 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        due_date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
      bank_code = decodeCp1256(r.subarray(60, 65))
      branch_code = decodeCp1256(r.subarray(65, 70))
      account_number = decodeCp1256(r.subarray(70, 84))
      customer_code = decodeCp1256(r.subarray(92, 102))
      status_code = view.getUint16(0, true)
      target_account = decodeCp1256(r.subarray(83, 92))
      action_doc = decodeCp1256(r.subarray(142, 151))
      amount = readDoubleLE(view, 160)
    } else {
      // Alternate Shamel Cheque Layout (e.g. doc at 0..9)
      doc = decodeCp1256(r.subarray(0, 9))
      if (!/^[RPCJ]\d{7}$/.test(doc)) continue
      cheque_no = decodeCp1256(r.subarray(17, 26))
      const d = r[26], m = r[27], y = view.getUint16(28, true)
      if (y >= 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        due_date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
      bank_code = decodeCp1256(r.subarray(50, 55))
      branch_code = decodeCp1256(r.subarray(55, 60))
      account_number = decodeCp1256(r.subarray(60, 74))
      target_account = decodeCp1256(r.subarray(73, 82))
      customer_code = decodeCp1256(r.subarray(82, 92))
      action_doc = decodeCp1256(r.subarray(132, 141))
      amount = readDoubleLE(view, 150)
      if (amount <= 0) amount = readDoubleLE(view, 160)
    }

    if (!cheque_no || amount <= 0 || amount > 1e7) continue

    const dedupKey = `${doc}_${cheque_no}_${amount}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    // Map status
    let status: ShamelCheque['status'] = 'in_portfolio'
    let status_name = 'في الصندوق'

    if (status_code === 4 || status_code === 3 || target_account.startsWith('4')) {
      status = 'bounced'
      status_name = 'معاد / راجع'
    } else if (/^[CS]\d{7}$/.test(target_account)) {
      status = 'endorsed'
      status_name = 'مجيّر'
    } else if (target_account.startsWith('1132')) {
      status = 'deposited'
      status_name = 'مودع برسم التحصيل'
    } else if (target_account.startsWith('112')) {
      status = 'collected'
      status_name = 'محصل في البنك'
    }

    cheques.push({
      document: doc,
      cheque_number: cheque_no,
      due_date,
      bank_code,
      branch_code,
      account_number,
      drawer_name: '',
      customer_code,
      amount,
      currency: 'ILS',
      status_code,
      status,
      status_name,
      type: doc.startsWith('P') ? 'issued' : 'received',
      target_account,
      action_doc,
    })
  }

  return cheques
}

/**
 * Parses ASSETS.DAT (Fixed Assets).
 */
export function parseAssets(data: Uint8Array): ShamelAsset[] {
  const assets: ShamelAsset[] = []
  for (const r of iterateRecords(data)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code) continue
    const name = decodeCp1256(r.subarray(18, 80))
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    const purchase_cost = readDoubleLE(view, 80)

    assets.push({
      code,
      name: name || `أصل ${code}`,
      purchase_cost,
      currency: 'ILS',
    })
  }
  return assets
}

/**
 * Parses COSTCENT.DAT (Cost Centers).
 */
export function parseCostCenters(data: Uint8Array): ShamelCostCenter[] {
  const centers: ShamelCostCenter[] = []
  for (const r of iterateRecords(data)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code) continue
    const name = decodeCp1256(r.subarray(18, 60))
    const parent_code = decodeCp1256(r.subarray(9, 18))

    centers.push({
      code,
      name: name || `مركز ${code}`,
      parent_code,
    })
  }
  return centers
}

/**
 * Parses SALESMEN.DAT (Sales Reps).
 */
export function parseSalesmen(data: Uint8Array): ShamelSalesman[] {
  const salesmen: ShamelSalesman[] = []
  for (const r of iterateRecords(data)) {
    const code = decodeCp1256(r.subarray(0, 9))
    if (!code) continue
    const name = decodeCp1256(r.subarray(9, 60))
    const phone = decodeCp1256(r.subarray(60, 80))

    salesmen.push({
      code,
      name: name || `مندوب ${code}`,
      phone,
    })
  }
  return salesmen
}

/**
 * Parses CUSTLPRC.DAT (Customer Special Price Lists).
 */
export function parseCustomerPrices(data: Uint8Array): ShamelCustomerPrice[] {
  const prices: ShamelCustomerPrice[] = []
  for (const r of iterateRecords(data)) {
    const customer_code = decodeCp1256(r.subarray(0, 9))
    const product_code = decodeCp1256(r.subarray(9, 18))
    if (!customer_code || !product_code) continue
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    const special_price = readDoubleLE(view, 18)

    prices.push({
      customer_code,
      product_code,
      special_price,
      currency: 'ILS',
    })
  }
  return prices
}

/**
 * Parses CPAGE.DAT (Document headers and descriptions).
 * Layout: length 462, stride 544
 * doc: r[0..9], rate: offset 95 (double LE), description: r[239..320], kind: r[351..382]
 */
export function parseHeaders(data: Uint8Array): Map<string, { description: string; kind: string; rate: number }> {
  const headers = new Map<string, { description: string; kind: string; rate: number }>()
  for (const r of iterateRecords(data)) {
    const doc = decodeCp1256(r.subarray(0, 9))
    if (!doc) continue
    const description = decodeCp1256(r.subarray(239, 320))
    const kind = decodeCp1256(r.subarray(351, 382))
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    let rate = 1.0
    if (r.byteLength >= 103) {
      const rVal = readDoubleLE(view, 95)
      if (rVal >= 0.0001 && rVal <= 1000) rate = rVal
    }
    headers.set(doc, { description, kind, rate })
  }
  return headers
}

/**
 * Parses JORNOTES.DAT (Document line notes).
 * Layout: length 255, stride 257
 * doc: r[0..9], line: uint(r, 9, 2), note: r[54..255]
 */
export function parseJournalNotes(data: Uint8Array): Map<string, string> {
  const notes = new Map<string, string>()
  for (const r of iterateRecords(data)) {
    const doc = decodeCp1256(r.subarray(0, 9))
    if (!doc) continue
    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    const line = readUInt(view, 9, 2)
    const note = decodeCp1256(r.subarray(54, 255))
    if (note) {
      notes.set(`${doc}_${line}`, note)
    }
  }
  return notes
}

/**
 * Parses CTRANS.DAT (Journal ledger transactions).
 * Layout: length 134, stride 232
 * doc: r[0..9]
 * line_index: uint(r, 9, 2)
 * day: r[11], month: r[12], year: uint(r, 13, 2)
 * account: r[15..24]
 * currency: r[24..28]
 * amount: doubleLE(r, 28)
 * direction: uint(r, 36, 2) (1 = debit, 2 = credit)
 */
export function parseEntries(
  data: Uint8Array,
  headersMap?: Map<string, { description: string; kind: string; rate: number }>,
  notesMap?: Map<string, string>
): ShamelEntry[] {
  const entries: ShamelEntry[] = []
  const seen = new Set<string>()

  for (const r of iterateRecords(data)) {
    const doc = decodeCp1256(r.subarray(0, 9))
    if (!doc) continue

    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    const line_index = readUInt(view, 9, 2)
    const account = decodeCp1256(r.subarray(15, 24))
    if (!account) continue

    // Date validation
    const d = r[11]
    const m = r[12]
    const y = readUInt(view, 13, 2)
    let day = '2000-01-01'
    if (y >= 1990 && y <= 2050 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }

    // Currency normalization
    let cur = decodeCp1256(r.subarray(24, 28)).toUpperCase()
    if (cur === 'NIS' || cur === 'ILS') cur = 'ILS'
    else if (cur === 'JD' || cur === 'JOD') cur = 'JOD'
    else if (cur === '$' || cur === 'USD') cur = 'USD'
    else if (cur === 'EUR') cur = 'EUR'
    else if (!cur) cur = 'ILS'

    const amount = readDoubleLE(view, 28)
    const direction = readUInt(view, 36, 2) // 1 = debit, 2 = credit

    // Dedup
    const dedupKey = `${doc}_${line_index}_${account}_${direction}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    // Narration and exchange rate from headers and journal notes
    const header = headersMap?.get(doc)
    const docNote = notesMap?.get(`${doc}_65535`)
    const lineNote = notesMap?.get(`${doc}_${line_index}`)
    const parts = [header?.description, docNote, lineNote].filter(Boolean) as string[]
    const description = Array.from(new Set(parts)).join(' | ')
    const document_type = header?.kind || ''

    let exchange_rate = 1.0
    if (cur !== 'ILS') {
      const hRate = header?.rate
      if (hRate && hRate >= 0.0001 && hRate <= 1000) {
        exchange_rate = hRate
      }
    }
    const nis_amount = Math.round(Math.abs(amount) * exchange_rate * 100) / 100

    entries.push({
      document: doc,
      line_index,
      account,
      currency: cur,
      day,
      amount: Math.abs(amount),
      direction: direction === 2 ? 2 : 1,
      description,
      document_type,
      exchange_rate,
      nis_amount,
    })
  }

  return entries
}

/**
 * Parses STRANS.DAT (Invoice item lines).
 * Layout: length 420, stride 454
 * doc: r[0..9]
 * line: uint(r, 9, 2)
 * day: r[11], month: r[12], year: uint(r, 13, 2)
 * item_code: r[15..24]
 * location: uint(r, 28, 2)
 * quantity: doubleLE(r, 34)
 * price: doubleLE(r, 42)
 * total: doubleLE(r, 50)
 * item_name: r[58..140]
 */
export function parseInvoiceItems(data: Uint8Array): ShamelInvoiceItem[] {
  const items: ShamelInvoiceItem[] = []
  const seen = new Set<string>()

  for (const r of iterateRecords(data)) {
    const doc = decodeCp1256(r.subarray(0, 9))
    if (!doc) continue

    const view = new DataView(r.buffer, r.byteOffset, r.byteLength)
    const line_index = readUInt(view, 9, 2)
    const item_code = decodeCp1256(r.subarray(15, 24))
    if (!item_code) continue

    // Date
    const d = r[11]
    const m = r[12]
    const y = readUInt(view, 13, 2)
    let day = '2000-01-01'
    if (y >= 1990 && y <= 2050 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }

    const location = readUInt(view, 28, 2)
    const quantity = readDoubleLE(view, 34)
    const price = readDoubleLE(view, 42)
    let total = readDoubleLE(view, 50)
    if (total === 0 && quantity > 0 && price > 0) {
      total = Math.round(quantity * price * 100) / 100
    }
    const item_name = decodeCp1256(r.subarray(58, 140)) || item_code

    const dedupKey = `${doc}_${line_index}_${item_code}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    items.push({
      document: doc,
      line_index,
      day,
      item_code,
      item_name,
      quantity,
      price,
      total,
      location,
    })
  }

  return items
}

