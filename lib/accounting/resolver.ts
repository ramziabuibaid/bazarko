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

  // 1. التعامل مع الصناديق النقدية (CASH / PETTY_CASH)
  if (tag === 'CASH' || tag === 'PETTY_CASH') {
    return await resolveCashAccount(supabase, storeId, context.cashBoxId)
  }

  // 2. التعامل مع الحسابات البنكية (BANK)
  if (tag === 'BANK') {
    return await resolveBankAccount(supabase, storeId, context.bankAccountId)
  }

  // 3. التعامل مع ذمم الزبائن والعملاء (CUSTOMER_RECEIVABLE)
  if (tag === 'CUSTOMER_RECEIVABLE') {
    return await resolveCustomerAccount(supabase, storeId, context.customerId, context.customerName)
  }

  // 4. التعامل مع ذمم الموردين (SUPPLIER_PAYABLE)
  if (tag === 'SUPPLIER_PAYABLE') {
    return await resolveSupplierAccount(supabase, storeId, context.supplierId, context.supplierName)
  }

  // 5. التعامل مع محفظة الشيكات الواردة (CHEQUES_IN_HAND / CHECKS_PORTFOLIO / CHEQUES_RECEIVABLE)
  if (tag === 'CHEQUES_IN_HAND' || tag === 'CHECKS_PORTFOLIO' || tag === 'CHEQUES_RECEIVABLE') {
    return await resolveStandardTaggedAccount(
      supabase,
      storeId,
      'CHEQUES_IN_HAND',
      'شيكات في المحفظة (أوراق قبض)',
      'asset',
      'debit',
      ['CHEQUE_RECEIPT', 'CHEQUE_ENDORSEMENT', 'CHEQUE_DEPOSIT', 'CAN_RECEIVE_PAYMENT']
    )
  }

  // 6. التعامل مع الشيكات برسم التحصيل (CHECKS_UNDER_COLLECTION)
  if (tag === 'CHECKS_UNDER_COLLECTION') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'CHECKS_UNDER_COLLECTION', 'شيكات برسم التحصيل', 'asset', 'debit')
  }

  // 7. التعامل مع محفظة الشيكات المرتجعة (CHECKS_BOUNCED)
  if (tag === 'CHECKS_BOUNCED') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'CHECKS_BOUNCED', 'محفظة الشيكات المرتجعة', 'asset', 'debit')
  }

  // 8. التعامل مع أوراق الدفع والشيكات الصادرة (CHECKS_PAYABLE)
  if (tag === 'CHECKS_PAYABLE') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'CHECKS_PAYABLE', 'أوراق دفع (شيكات صادرة)', 'liability', 'credit')
  }

  // 9. التعامل مع المخزون السلعي (INVENTORY)
  if (tag === 'INVENTORY') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'INVENTORY', 'المخزون السلعي', 'asset', 'debit')
  }

  // 10. التعامل مع تكلفة البضاعة المباعة (COGS)
  if (tag === 'COGS') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'COGS', 'تكلفة البضاعة المباعة', 'expense', 'debit')
  }

  // 11. التعامل مع إيرادات المبيعات (SALES_REVENUE)
  if (tag === 'SALES_REVENUE') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'SALES_REVENUE', 'إيرادات المبيعات', 'revenue', 'credit')
  }

  // 12. التعامل مع إيرادات الخدمات (SERVICE_REVENUE)
  if (tag === 'SERVICE_REVENUE') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'SERVICE_REVENUE', 'إيرادات الخدمات والصيانة', 'revenue', 'credit')
  }

  // 13. التعامل مع المصاريف العمومية والإدارية (GENERAL_EXPENSE)
  if (tag === 'GENERAL_EXPENSE') {
    return await resolveStandardTaggedAccount(supabase, storeId, 'GENERAL_EXPENSE', 'مصاريف إدارية وتشغيلية متنوعة', 'expense', 'debit')
  }

  // 14. التعامل مع أي وسم آخر مخصص عبر قاعدة البيانات
  return await resolveGenericTaggedAccount(supabase, storeId, tag)
}

/**
 * حل حساب الصندوق النقدي مع مراعاة السياق التشغيلي (Cash Box Context)
 */
async function resolveCashAccount(
  supabase: any,
  storeId: string,
  cashBoxId?: string | null
): Promise<AccountResolutionResult> {
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

  // 1. إذا كان الصندوق مرتبطاً بحساب مسبقاً
  if (box?.account_id) {
    const { data: acc } = await supabase
      .from('accounts')
      .select('id, code, name, account_tag, capabilities, is_active, is_group')
      .eq('id', box.account_id)
      .maybeSingle()

    if (acc) {
      if (!acc.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', acc.id)
      }
      return {
        accountId: acc.id,
        accountCode: acc.code,
        accountName: acc.name,
        accountTag: acc.account_tag || 'CASH',
        capabilities: acc.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS'],
      }
    }
  }

  const boxName = box?.name?.trim() || 'الصندوق الرئيسي'

  // 2. البحث عن حساب يحمل وسم CASH ومطابق لاسم الصندوق
  const { data: taggedNamedAcc } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, is_active')
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
    return {
      accountId: taggedNamedAcc.id,
      accountCode: taggedNamedAcc.code,
      accountName: taggedNamedAcc.name,
      accountTag: 'CASH',
      capabilities: taggedNamedAcc.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS'],
    }
  }

  // 3. البحث عن أي حساب يحمل وسم CASH غير تجميعي
  const { data: generalTaggedCash } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, is_active')
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
    return {
      accountId: generalTaggedCash.id,
      accountCode: generalTaggedCash.code,
      accountName: generalTaggedCash.name,
      accountTag: 'CASH',
      capabilities: generalTaggedCash.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS'],
    }
  }

  // 4. إنشاء حساب تلقائي للصندوق بالوسم الصحيح
  return await createStandardTaggedAccount(supabase, storeId, 'CASH', boxName, 'asset', 'debit', ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS'], box?.id)
}

/**
 * حل حساب البنك مع مراعاة السياق التشغيلي (Bank Account Context)
 */
async function resolveBankAccount(
  supabase: any,
  storeId: string,
  bankAccountId?: string | null
): Promise<AccountResolutionResult> {
  let bAcc: any = null

  if (bankAccountId) {
    const { data: foundBank } = await supabase
      .from('bank_accounts')
      .select('id, bank_name, account_number, account_id')
      .eq('id', bankAccountId)
      .eq('store_id', storeId)
      .maybeSingle()
    bAcc = foundBank
  }

  // 1. إذا كان البنك مرتبطاً بحساب مسبقاً
  if (bAcc?.account_id) {
    const { data: acc } = await supabase
      .from('accounts')
      .select('id, code, name, account_tag, capabilities, is_active')
      .eq('id', bAcc.account_id)
      .maybeSingle()

    if (acc) {
      if (!acc.is_active) {
        await supabase.from('accounts').update({ is_active: true }).eq('id', acc.id)
      }
      return {
        accountId: acc.id,
        accountCode: acc.code,
        accountName: acc.name,
        accountTag: acc.account_tag || 'BANK',
        capabilities: acc.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS', 'CHEQUE_DEPOSIT'],
      }
    }
  }

  const bankTitle = bAcc?.bank_name ? `بنك ${bAcc.bank_name}` : 'حساب البنك الجاري'

  // 2. البحث عن حساب بنكي مطابق للوسم BANK
  const { data: bankAccounts } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', 'BANK')
    .eq('is_group', false)

  if (bankAccounts && bankAccounts.length > 0) {
    // إن كان هناك بنك محدد باسمه نبحث عن أفضل تطابق
    if (bAcc?.bank_name) {
      const match = bankAccounts.find((a: any) => a.name.includes(bAcc.bank_name))
      if (match) {
        if (bAcc) {
          await supabase.from('bank_accounts').update({ account_id: match.id }).eq('id', bAcc.id)
        }
        return {
          accountId: match.id,
          accountCode: match.code,
          accountName: match.name,
          accountTag: 'BANK',
          capabilities: match.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS', 'CHEQUE_DEPOSIT'],
        }
      }
    }

    // إذا لم يحدد بنك معين ولكن يوجد بنك واحد فقط نستخدمه
    if (bankAccounts.length === 1) {
      const single = bankAccounts[0]
      return {
        accountId: single.id,
        accountCode: single.code,
        accountName: single.name,
        accountTag: 'BANK',
        capabilities: single.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS', 'CHEQUE_DEPOSIT'],
      }
    }

    // إذا كان هناك أكثر من بنك ولم يحدد المستخدم البنك في العملية
    if (!bankAccountId) {
      const first = bankAccounts[0]
      return {
        accountId: first.id,
        accountCode: first.code,
        accountName: first.name,
        accountTag: 'BANK',
        capabilities: first.capabilities || ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS', 'CHEQUE_DEPOSIT'],
      }
    }
  }

  return await createStandardTaggedAccount(supabase, storeId, 'BANK', bankTitle, 'asset', 'debit', ['CAN_RECEIVE_PAYMENT', 'CAN_MAKE_PAYMENT', 'TREASURY_TRANSFERS', 'CHEQUE_DEPOSIT'], undefined, bAcc?.id)
}

/**
 * حل حساب العميل (تحليلي باسم العميل أو الحساب الموحد لذمم الزبائن)
 */
async function resolveCustomerAccount(
  supabase: any,
  storeId: string,
  customerId?: string | null,
  customerName?: string | null
): Promise<AccountResolutionResult> {
  const targetName = (customerName || '').trim()

  // 1. حساب تحليلي مخصص للعميل باسمه إن وُجد
  if (targetName) {
    const { data: subAcc } = await supabase
      .from('accounts')
      .select('id, code, name, account_tag, capabilities, is_active')
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
      return {
        accountId: subAcc.id,
        accountCode: subAcc.code,
        accountName: subAcc.name,
        accountTag: subAcc.account_tag || 'CUSTOMER_RECEIVABLE',
        capabilities: subAcc.capabilities || ['CUSTOMER_SETTLEMENT', 'CREDIT_SALES'],
      }
    }
  }

  // 2. الحساب الرئيسي لذمم الزبائن بالوسم CUSTOMER_RECEIVABLE
  return await resolveStandardTaggedAccount(
    supabase,
    storeId,
    'CUSTOMER_RECEIVABLE',
    'ذمم الزبائن والعملاء',
    'asset',
    'debit',
    ['CUSTOMER_SETTLEMENT', 'CREDIT_SALES']
  )
}

/**
 * حل حساب المورد (تحليلي باسم المورد أو الحساب الموحد لذمم الموردين)
 */
async function resolveSupplierAccount(
  supabase: any,
  storeId: string,
  supplierId?: string | null,
  supplierName?: string | null
): Promise<AccountResolutionResult> {
  const targetName = (supplierName || '').trim()

  // 1. حساب تحليلي مخصص للمورد باسمه إن وُجد
  if (targetName) {
    const { data: subAcc } = await supabase
      .from('accounts')
      .select('id, code, name, account_tag, capabilities, is_active')
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
      return {
        accountId: subAcc.id,
        accountCode: subAcc.code,
        accountName: subAcc.name,
        accountTag: subAcc.account_tag || 'SUPPLIER_PAYABLE',
        capabilities: subAcc.capabilities || ['SUPPLIER_SETTLEMENT', 'CREDIT_PURCHASES'],
      }
    }
  }

  // 2. الحساب الرئيسي لذمم الموردين بالوسم SUPPLIER_PAYABLE
  return await resolveStandardTaggedAccount(
    supabase,
    storeId,
    'SUPPLIER_PAYABLE',
    'ذمم الموردين',
    'liability',
    'credit',
    ['SUPPLIER_SETTLEMENT', 'CREDIT_PURCHASES']
  )
}

/**
 * حل حساب قياسي موسوم ومسجل
 */
async function resolveStandardTaggedAccount(
  supabase: any,
  storeId: string,
  tag: string,
  defaultName: string,
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  normalBalance: 'debit' | 'credit',
  defaultCapabilities: string[] = []
): Promise<AccountResolutionResult> {
  // 1. البحث بواسطة الوسم أولاً (مع مراعاة الأسماء البديلة)
  const tagCandidates = (tag === 'CHEQUES_IN_HAND' || tag === 'CHECKS_PORTFOLIO' || tag === 'CHEQUES_RECEIVABLE')
    ? ['CHEQUES_IN_HAND', 'CHECKS_PORTFOLIO', 'CHEQUES_RECEIVABLE']
    : [tag]

  const { data: tagged } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, is_active, is_group')
    .eq('store_id', storeId)
    .in('account_tag', tagCandidates)
    .eq('is_group', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (tagged) {
    if (!tagged.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', tagged.id)
    }
    return {
      accountId: tagged.id,
      accountCode: tagged.code,
      accountName: tagged.name,
      accountTag: tagged.account_tag || tag,
      capabilities: tagged.capabilities && tagged.capabilities.length > 0 ? tagged.capabilities : defaultCapabilities,
    }
  }

  // 2. البحث بالاسم المطابق والنوع كبديل قبل الإنشاء
  const { data: byName } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, is_active')
    .eq('store_id', storeId)
    .eq('type', type)
    .eq('is_group', false)
    .ilike('name', `%${defaultName.split(' ')[0]}%`)
    .limit(1)
    .maybeSingle()

  if (byName) {
    // ربط الحساب بالوسم فوراً
    await supabase.from('accounts').update({ account_tag: tag, is_active: true }).eq('id', byName.id)
    return {
      accountId: byName.id,
      accountCode: byName.code,
      accountName: byName.name,
      accountTag: tag,
      capabilities: byName.capabilities && byName.capabilities.length > 0 ? byName.capabilities : defaultCapabilities,
    }
  }

  // 3. إنشاء الحساب بالوسم والقدرات
  return await createStandardTaggedAccount(supabase, storeId, tag, defaultName, type, normalBalance, defaultCapabilities)
}

/**
 * حل أي وسم عام غير الحسابات المباشرة
 */
async function resolveGenericTaggedAccount(
  supabase: any,
  storeId: string,
  tag: string
): Promise<AccountResolutionResult> {
  const { data: tagged } = await supabase
    .from('accounts')
    .select('id, code, name, account_tag, capabilities, is_active')
    .eq('store_id', storeId)
    .eq('account_tag', tag)
    .eq('is_group', false)
    .limit(1)
    .maybeSingle()

  if (tagged) {
    if (!tagged.is_active) {
      await supabase.from('accounts').update({ is_active: true }).eq('id', tagged.id)
    }
    return {
      accountId: tagged.id,
      accountCode: tagged.code,
      accountName: tagged.name,
      accountTag: tagged.account_tag || tag,
      capabilities: tagged.capabilities || [],
    }
  }

  // فحص بيانات الوسم من جدول account_tags
  const { data: tagMeta } = await supabase
    .from('account_tags')
    .select('*')
    .eq('code', tag)
    .maybeSingle()

  if (!tagMeta) {
    throw new Error(`الوسم المحاسبي (${tag}) غير مسجل في النظام. يرجى تهيئته أولاً.`)
  }

  const normalBal = (tagMeta.allowed_account_type === 'asset' || tagMeta.allowed_account_type === 'expense') ? 'debit' : 'credit'
  return await createStandardTaggedAccount(
    supabase,
    storeId,
    tag,
    tagMeta.name_ar,
    tagMeta.allowed_account_type,
    normalBal,
    tagMeta.capabilities || []
  )
}

/**
 * إنشاء حساب جديد موسوم تلقائياً
 */
async function createStandardTaggedAccount(
  supabase: any,
  storeId: string,
  tag: string,
  name: string,
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
  normalBalance: 'debit' | 'credit',
  capabilities: string[] = [],
  linkedCashBoxId?: string,
  linkedBankAccountId?: string
): Promise<AccountResolutionResult> {
  // توليد رمز فريد
  const prefix = type === 'asset' ? '1' : type === 'liability' ? '2' : type === 'equity' ? '3' : type === 'revenue' ? '4' : '5'
  const { data: existingCodes } = await supabase
    .from('accounts')
    .select('code')
    .eq('store_id', storeId)
    .like('code', `${prefix}%`)

  const codeSet = new Set((existingCodes || []).map((c: any) => c.code))
  let seq = 100
  let newCode = `${prefix}${seq}`
  while (codeSet.has(newCode)) {
    seq++
    newCode = `${prefix}${seq}`
  }

  const { data: newAcc, error } = await supabase
    .from('accounts')
    .insert({
      store_id: storeId,
      code: newCode,
      name,
      type,
      is_group: false,
      is_active: true,
      is_system: true,
      normal_balance: normalBalance,
      balance: 0,
      currency: 'ILS',
      account_tag: tag,
      capabilities,
    })
    .select('id, code, name, account_tag, capabilities')
    .single()

  if (error || !newAcc) {
    console.error(`Error creating account with tag ${tag}:`, error)
    throw new Error(`تعذر إنشاء الحساب المرتبط بالوسم (${tag}): ${error?.message || 'خطأ غير معروف'}`)
  }

  // ربط عكسي بالصندوق أو البنك إذا وجد
  if (linkedCashBoxId) {
    await supabase.from('cash_boxes').update({ account_id: newAcc.id }).eq('id', linkedCashBoxId)
  }
  if (linkedBankAccountId) {
    await supabase.from('bank_accounts').update({ account_id: newAcc.id }).eq('id', linkedBankAccountId)
  }

  return {
    accountId: newAcc.id,
    accountCode: newAcc.code,
    accountName: newAcc.name,
    accountTag: newAcc.account_tag || tag,
    capabilities: newAcc.capabilities || capabilities,
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
