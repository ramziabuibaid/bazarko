/**
 * Centralized Account Resolver and Capability Validation Engine
 * 
 * Implements the 4-Tier Accounting Architecture:
 * 1. Business Events (e.g. SALE_POSTED, CUSTOMER_PAYMENT_RECEIVED, INVENTORY_SOLD)
 * 2. Accounting Rules (Debit Tag, Credit Tag)
 * 3. Account Resolver (Resolves concrete account from Tag + Context without hardcoded IDs/codes)
 * 4. Validation Engine (Enforces capabilities & permissions on selected accounts)
 */

export type AccountTagCode =
  // Assets
  | 'CASH'
  | 'PETTY_CASH'
  | 'BANK'
  | 'CHEQUES_IN_HAND'
  | 'CHEQUES_RECEIVABLE'
  | 'CHECKS_PORTFOLIO'
  | 'CHECKS_UNDER_COLLECTION'
  | 'CHECKS_BOUNCED'
  | 'CUSTOMER_RECEIVABLE'
  | 'INVENTORY'
  | 'PREPAID_EXPENSES'
  | 'FIXED_ASSETS'
  | 'ACCUMULATED_DEPRECIATION'
  | 'EMPLOYEE_ADVANCES'
  // Liabilities
  | 'SUPPLIER_PAYABLE'
  | 'CHECKS_PAYABLE'
  | 'ACCRUED_EXPENSES'
  | 'VAT_PAYABLE'
  | 'SHORT_TERM_LOANS'
  // Equity
  | 'CAPITAL'
  | 'RETAINED_EARNINGS'
  | 'CURRENT_YEAR_PROFIT'
  // Revenue
  | 'SALES_REVENUE'
  | 'SERVICE_REVENUE'
  | 'OTHER_REVENUE'
  | 'SALES_DISCOUNT'
  | 'SALES_RETURNS'
  // Expenses
  | 'COGS'
  | 'SALARY_EXPENSE'
  | 'RENT_EXPENSE'
  | 'UTILITIES_EXPENSE'
  | 'MARKETING_EXPENSE'
  | 'PURCHASE_DISCOUNT'
  | 'PURCHASE_RETURNS'
  | 'DEPRECIATION_EXPENSE'
  | 'GENERAL_EXPENSE'
  | string

export interface ResolutionContext {
  storeId: string
  cashBoxId?: string | null
  bankAccountId?: string | null
  customerId?: string | null
  customerName?: string | null
  supplierId?: string | null
  supplierName?: string | null
  warehouseId?: string | null
  categoryId?: string | null
  productId?: string | null
  branchId?: string | null
  currency?: string | null
}

export interface AccountResolutionResult {
  accountId: string
  accountCode: string
  accountName: string
  accountTag: string
  capabilities: string[]
}

export interface ValidationResult {
  valid: boolean
  error?: string
  account?: {
    id: string
    code: string
    name: string
    account_tag?: string | null
    capabilities?: string[]
    type: string
    is_group: boolean
    is_active: boolean
  }
}

/**
 * دالة مركزية لحل واستنتاج الحساب المحاسبي بدقة عبر الوسم والسياق التشغيلي (Account Resolver)
 * يمنع الاعتماد على معرفات أو أرقام ثابتة (Hardcoded)
 */
export async function resolveAccount(
  supabase: any,
  tag: AccountTagCode,
  context: ResolutionContext
): Promise<AccountResolutionResult> {
  const { storeId } = context

  if (!storeId) {
    throw new Error('معرف المتجر (storeId) مطلوب لحل الحساب المحاسبي.')
  }

  const entityId = tag === 'CASH' || tag === 'PETTY_CASH' ? context.cashBoxId
    : tag === 'BANK' ? context.bankAccountId
    : tag === 'CUSTOMER_RECEIVABLE' ? context.customerId
    : tag === 'SUPPLIER_PAYABLE' ? context.supplierId : null
  const { data: accountId, error } = await supabase.rpc('resolve_financial_account', {
    p_store: storeId, p_tag: tag, p_entity: entityId || null,
  })
  if (error || !accountId) throw new Error(error?.message || 'تعذر تحديد الحساب المحاسبي')
  const { data: account, error: readError } = await supabase.from('accounts')
    .select('id, code, name, account_tag, capabilities')
    .eq('store_id', storeId).eq('id', accountId).single()
  if (readError || !account) throw new Error('تعذر قراءة الحساب المحاسبي')
  return {
    accountId: account.id, accountCode: account.code, accountName: account.name,
    accountTag: account.account_tag, capabilities: account.capabilities || [],
  }
}

/**
 * التحقق من صلاحية الحساب للعملية التشغيلية (Account Capability Validation)
 * يضمن:
 * 1. الحساب موجود ونشط
 * 2. الحساب ليس حساباً رئيسياً تجميعياً
 * 3. الحساب يملك الوسم أو القدرة المطلوبة للعملية (مثلاً لا يمكن سند قبض على حساب مصروف)
 */
export async function validateAccountForOperation(
  supabase: any,
  accountId: string,
  allowedTags: AccountTagCode[],
  operationLabel: string = 'العملية الحالية'
): Promise<ValidationResult> {
  if (!accountId) {
    return { valid: false, error: 'لم يتم تحديد الحساب المحاسبي.' }
  }

  const { data: acc, error } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, type, is_group, is_active')
    .eq('id', accountId)
    .maybeSingle()

  if (error || !acc) {
    return { valid: false, error: 'الحساب المحاسبي غير موجود في النظام.' }
  }

  if (acc.is_group) {
    return {
      valid: false,
      error: `الحساب (${acc.name} - ${acc.code}) هو حساب رئيسي تجميعي، ولا يقبل الترحيل المباشر. يرجى اختيار حساب فرعي تحليلي.`,
      account: acc,
    }
  }

  if (!acc.is_active) {
    return {
      valid: false,
      error: `الحساب المحاسبي (${acc.name} - ${acc.code}) معطل حالياً ولا يمكن استخدامه.`,
      account: acc,
    }
  }

  // التحقق من توافق الوسم أو القدرات (Capabilities)
  const currentTag = acc.account_tag
  const currentCapabilities: string[] = acc.capabilities || []

  const hasTagMatch = currentTag && allowedTags.includes(currentTag)
  const hasCapabilityMatch = currentCapabilities.some(cap => allowedTags.includes(cap))

  // إذا لم يكن هناك وسم أو لم يتطابق مع الوسوم المسموحة
  if (!hasTagMatch && !hasCapabilityMatch) {
    return {
      valid: false,
      error: `الحساب (${acc.name} - ${acc.code}) غير مسموح به في "${operationLabel}". الحسابات المقبولة يجب أن تكون موسومة بأحد الوسوم: [${allowedTags.join(', ')}].`,
      account: acc,
    }
  }

  return { valid: true, account: acc }
}
