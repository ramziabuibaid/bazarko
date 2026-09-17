export interface ShamelAccount {
  code: string
  name: string
  parent_code: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  is_group: boolean
  currency: string
  balance: number
}

export interface ShamelCustomer {
  code: string
  name: string
  phone: string
  address: string
  balance: number
  equivalent_balance?: number
  has_balance?: boolean
  last_invoice_date?: string | null
  last_receipt_date?: string | null
  balances?: Array<{ currency: string; balance: number }>
}

export interface ShamelSupplier {
  code: string
  name: string
  phone: string
  address: string
  balance: number
}

export interface ShamelProduct {
  code: string
  name: string
  barcode?: string
  price: number
  cost_price: number
  stock_quantity: number
}

export interface ShamelCheque {
  document: string
  cheque_number: string
  due_date: string | null
  bank_code: string
  bank_name?: string
  branch_code: string
  branch_name?: string
  account_number: string
  drawer_name: string
  customer_code: string
  customer_name?: string
  amount: number
  currency: string
  status_code: number
  status: 'in_portfolio' | 'deposited' | 'collected' | 'bounced' | 'endorsed' | 'returned_to_drawer'
  status_name: string
  type: 'received' | 'issued'
  target_account?: string
  target_name?: string
  action_doc?: string
}

export interface ShamelAsset {
  code: string
  name: string
  purchase_date?: string
  purchase_cost: number
  currency: string
  depreciation_rate?: number
  location?: string
}

export interface ShamelCostCenter {
  code: string
  name: string
  parent_code?: string
}

export interface ShamelSalesman {
  code: string
  name: string
  phone?: string
  commission_rate?: number
}

export interface ShamelCustomerPrice {
  customer_code: string
  product_code: string
  special_price: number
  currency: string
}

export interface ShamelTableInspection {
  filename: string
  label: string
  sizeBytes: number
  recordLength: number
  stride: number
  recordCount: number
  status: 'detected' | 'empty' | 'missing'
}

export interface ShamelEntry {
  document: string
  line_index: number
  account: string
  currency: string
  day: string
  amount: number
  direction: number // 1 = debit, 2 = credit
  description: string
  document_type: string
  source_offset?: number
  exchange_rate?: number
  nis_amount?: number
}

export interface ShamelInvoiceItem {
  document: string
  line_index: number
  day: string
  item_code: string
  item_name: string
  quantity: number
  price: number
  total: number
  location: number
}

export interface ShamelParsedData {
  accounts: ShamelAccount[]
  customers: ShamelCustomer[]
  suppliers: ShamelSupplier[]
  products: ShamelProduct[]
  cheques: ShamelCheque[]
  assets: ShamelAsset[]
  costCenters: ShamelCostCenter[]
  salesmen: ShamelSalesman[]
  customerPrices: ShamelCustomerPrice[]
  entries: ShamelEntry[]
  invoiceItems: ShamelInvoiceItem[]
  inspections: ShamelTableInspection[]
  reconciliation: {
    totalDebit: number
    totalCredit: number
    difference: number
    isBalanced: boolean
    reconciledCustomers: number
    totalCustomerCount: number
  }
}

export interface ImportOptions {
  selectedTables: {
    accounts: boolean
    customers: boolean
    suppliers: boolean
    products: boolean
    cheques: boolean
    assets: boolean
    costCenters: boolean
    salesmen: boolean
    customerPrices: boolean
  }
  mergeStrategy: 'upsert' | 'skip_existing'
}
