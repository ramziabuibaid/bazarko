'use server'

import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import { revalidatePath } from 'next/cache'

export interface CheckOperationInput {
  checkId: string
  operationType:
    | 'deposit'
    | 'collect'
    | 'bounce'
    | 'return_to_customer'
    | 'recollect'
    | 'endorse'
    | 'supplier_return'
    | 'transfer_cashbox'
  targetBankAccountId?: string | null
  targetCashBoxId?: string | null
  targetSupplierId?: string | null
  operationDate: string
  notes?: string
}

export interface CheckAccountingPreview {
  debitAccountName: string
  debitAccountCode: string
  creditAccountName: string
  creditAccountCode: string
  amount: number
  currency: string
  date: string
  description: string
  operationType: string
  fromStatus: string
  toStatus: string
}

/**
 * معاينة القيد المحاسبي قبل التنفيذ (لتأكيد المستخدم وفق شجرة الحسابات الحقيقية)
 */
export async function previewCheckAccounting(
  input: CheckOperationInput
): Promise<{ success: boolean; preview?: CheckAccountingPreview; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    const { data: check } = await supabase
      .from('checks')
      .select('*, customer:customers(id, name), supplier:suppliers(id, name)')
      .eq('id', input.checkId)
      .eq('store_id', storeId)
      .single()

    if (!check) return { success: false, error: 'الشيك غير موجود' }
    if (check.receipt_settlement_active != null) return linkedChequeOperation(input,crypto.randomUUID(),false)

    let debitName = ''
    let debitCode = ''
    let creditName = ''
    let creditCode = ''
    let toStatus = check.status
    let desc = ''

    const amount = Number(check.amount_ils || check.amount || 0)
    const currency = check.currency || 'ILS'
    const date = input.operationDate || new Date().toISOString().slice(0, 10)

    if (input.operationType === 'deposit') {
      toStatus = 'deposited'
      let bankTitle = 'البنك'
      if (input.targetBankAccountId) {
        const { data: bank } = await supabase.from('bank_accounts').select('bank_name, account_number').eq('id', input.targetBankAccountId).single()
        if (bank) bankTitle = `${bank.bank_name} (${bank.account_number})`
      }
      debitName = `شيكات برسم التحصيل — ${bankTitle}`
      debitCode = '1320'
      creditName = 'محفظة الشيكات الواردة (أوراق قبض)'
      creditCode = '1110'
      desc = `إيداع شيك رقم ${check.check_number} برسم التحصيل لدى ${bankTitle}`

    } else if (input.operationType === 'collect') {
      toStatus = 'collected'

      if (input.targetCashBoxId) {
        let boxTitle = 'الصندوق'
        const { data: box } = await supabase.from('cash_boxes').select('name').eq('id', input.targetCashBoxId).single()
        if (box) boxTitle = box.name
        debitName = `حساب الصندوق النقدي — ${boxTitle}`
        debitCode = '1100'
        desc = `تحصيل نقدي بالصندوق (${boxTitle}) لشيك رقم ${check.check_number}`
      } else {
        let bankTitle = 'الحساب البنكي'
        if (input.targetBankAccountId) {
          const { data: bank } = await supabase.from('bank_accounts').select('bank_name, account_number').eq('id', input.targetBankAccountId).single()
          if (bank) bankTitle = `${bank.bank_name} (${bank.account_number})`
        }
        debitName = `حساب البنك الجاري — ${bankTitle}`
        debitCode = '1200'
        desc = `تحصيل وقيد شيك رقم ${check.check_number} في ${bankTitle}`
      }

      if (check.status === 'deposited') {
        creditName = 'شيكات برسم التحصيل'
        creditCode = '1320'
      } else {
        creditName = 'محفظة الشيكات الواردة (أوراق قبض)'
        creditCode = '1110'
      }

    } else if (input.operationType === 'bounce') {
      toStatus = 'bounced'
      debitName = 'محفظة الشيكات المرتجعة (شيكات راجعة ومرفوضة)'
      debitCode = '1330'
      if (check.status === 'deposited') {
        creditName = 'شيكات برسم التحصيل'
        creditCode = '1320'
      } else {
        creditName = 'محفظة الشيكات الواردة (أوراق قبض)'
        creditCode = '1110'
      }
      desc = `ارتداد شيك راجع رقم ${check.check_number} من ${check.bank_name || 'البنك'}`

    } else if (input.operationType === 'return_to_customer') {
      toStatus = 'returned_to_customer'
      debitName = `ذمم العملاء (الزبائن) — ${check.customer?.name || check.drawer_name || 'العميل'}`
      debitCode = '1400'
      creditName = 'محفظة الشيكات المرتجعة (شيكات راجعة ومرفوضة)'
      creditCode = '1330'
      desc = `إعادة الشيك الراجع رقم ${check.check_number} للعميل وإعادة قيد الذمة عليه`

    } else if (input.operationType === 'recollect') {
      toStatus = 'in_portfolio'
      debitName = 'محفظة الشيكات الواردة (أوراق قبض)'
      debitCode = '1110'
      creditName = 'محفظة الشيكات المرتجعة'
      creditCode = '1330'
      desc = `إعادة استلام وقبض الشيك رقم ${check.check_number} في محفظة الشيكات بعد معالجة وضعه`

    } else if (input.operationType === 'endorse') {
      toStatus = 'endorsed'
      let suppName = 'المورد'
      if (input.targetSupplierId) {
        const { data: supp } = await supabase.from('suppliers').select('name').eq('id', input.targetSupplierId).single()
        if (supp) suppName = supp.name
      }
      debitName = `ذمم الموردين — تخفيض حساب ${suppName}`
      debitCode = '2100'
      creditName = 'محفظة الشيكات الواردة (أوراق قبض)'
      creditCode = '1110'
      desc = `تجيير شيك رقم ${check.check_number} لصالح المورد ${suppName}`

    } else if (input.operationType === 'supplier_return') {
      toStatus = 'supplier_returned'
      let suppName = 'المورد'
      if (check.endorsed_supplier_id) {
        const { data: supp } = await supabase.from('suppliers').select('name').eq('id', check.endorsed_supplier_id).single()
        if (supp) suppName = supp.name
      }
      debitName = 'محفظة الشيكات المرتجعة'
      debitCode = '1330'
      creditName = `ذمم الموردين — إعادة قيد الذمة لصالح ${suppName}`
      creditCode = '2100'
      desc = `استلام شيك مجير راجع رقم ${check.check_number} من المورد ${suppName}`

    } else if (input.operationType === 'transfer_cashbox') {
      toStatus = check.status
      let boxTitle = 'الصندوق المستلم'
      if (input.targetCashBoxId) {
        const { data: box } = await supabase.from('cash_boxes').select('name').eq('id', input.targetCashBoxId).single()
        if (box) boxTitle = box.name
      }
      debitName = `محفظة الشيكات — ${boxTitle}`
      debitCode = '1110'
      creditName = 'محفظة الشيكات — الصندوق الحالي'
      creditCode = '1110'
      desc = `نقل الشيك رقم ${check.check_number} إلى ${boxTitle}`
    }

    return {
      success: true,
      preview: {
        debitAccountName: debitName,
        debitAccountCode: debitCode,
        creditAccountName: creditName,
        creditAccountCode: creditCode,
        amount,
        currency,
        date,
        description: desc,
        operationType: input.operationType,
        fromStatus: check.status,
        toStatus,
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'فشل توليد معاينة القيد' }
  }
}

/**
 * تنفيذ العملية على دورة حياة الشيك عبر الإجراء الذري المحاسبي المزدوج في قاعدة البيانات
 */
export async function executeCheckOperation(
  input: CheckOperationInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'يجب تسجيل الدخول أولاً' }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return { success: false, error: 'المتجر غير موجود' }

    // التحقق من الصلاحيات ووجود الشيك
    const { data: check } = await supabase
      .from('checks')
      .select('id, check_number, amount, receipt_settlement_active')
      .eq('id', input.checkId)
      .eq('store_id', storeId)
      .single()

    if (!check) return { success: false, error: 'الشيك غير موجود' }
    if (check.receipt_settlement_active != null) return {success:false,error:'استخدم التحصيل أو الإعادة المرتبطين بمعرف طلب لضمان عدم التكرار'}

    // استدعاء الإجراء المخزن الذري
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('execute_check_lifecycle_operation', {
      p_check_id: input.checkId,
      p_op_type: input.operationType,
      p_date: input.operationDate || new Date().toISOString().slice(0, 10),
      p_target_bank_id: input.targetBankAccountId || null,
      p_target_cashbox_id: input.targetCashBoxId || null,
      p_target_supplier_id: input.targetSupplierId || null,
      p_notes: input.notes?.trim() || null,
      p_actor_id: user.id,
    })

    if (rpcErr) {
      console.error('execute_check_lifecycle_operation RPC error:', rpcErr)
      return { success: false, error: rpcErr.message || 'فشل تنفيذ عملية الشيك' }
    }

    revalidatePath('/dashboard/cheques')
    revalidatePath('/dashboard/accounting/statement')
    revalidatePath('/dashboard/accounting/journal')
    revalidatePath('/dashboard/finance')
    revalidatePath('/dashboard/customers')
    revalidatePath('/dashboard/suppliers')

    return { success: true }
  } catch (err: any) {
    console.error('executeCheckOperation error:', err)
    return { success: false, error: err.message || 'فشل تنفيذ عملية الشيك' }
  }
}

/**
 * جلب سجل الحركات التاريخية لشيك معين
 */
export async function getCheckAuditHistory(checkId: string) {
  try {
    const supabase = createClient()
    const { data: operations, error } = await supabase
      .from('check_operations')
      .select('*, target_bank:bank_accounts(bank_name, account_number), target_supp:suppliers(name), target_cashbox:cash_boxes(name), journal_entry:journal_entries(entry_number)')
      .eq('check_id', checkId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return { success: true, operations: operations || [] }
  } catch (err: any) {
    return { success: false, error: err.message, operations: [] }
  }
}

/** Linked receipt checks use actual source accounts and a durable request identity. */
export async function linkedChequeOperation(input:CheckOperationInput,requestId:string,execute:boolean):Promise<{success:boolean;preview?:CheckAccountingPreview;error?:string;uncertain?:boolean}>{
 try{
  const c=createClient(),{data:{user}}=await c.auth.getUser();if(!user)return {success:false,error:'يلزم تسجيل الدخول'};
  const storeId=await getStoreForUser(c,user.id);if(!storeId)return {success:false,error:'المتجر غير متاح'};
  if(!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId))return {success:false,error:'معرف العملية غير صحيح'};
  const payload={operationType:input.operationType,operationDate:input.operationDate,targetBankAccountId:input.targetBankAccountId||'',targetCashBoxId:input.targetCashBoxId||'',targetSupplierId:input.targetSupplierId||'',notes:input.notes||''};
  const {data,error}=await c.rpc('receipt_cheque_operation_atomic',{p_store_id:storeId,p_check_id:input.checkId,p_request_id:requestId,p_payload:payload,p_execute:execute});
  if(error)return {success:false,error:error.message,uncertain:execute&&(!error.code||!/^[0-9A-Z]{5}$/.test(error.code))};
  if(!data?.success||(execute&&!data?.operationId))return {success:false,error:'تعذر تأكيد نتيجة العملية؛ أعد محاولة الطلب نفسه',uncertain:execute};
  if(execute){try{for(const p of ['/dashboard/cheques','/dashboard/accounting/receipts','/dashboard/accounting/treasury','/dashboard/accounting/journal','/dashboard/accounting/invoices','/dashboard/customers','/dashboard/customers/ledger','/dashboard/finance'])revalidatePath(p);revalidatePath('/dashboard/customers/[id]','page');revalidatePath('/dashboard/accounting/invoices/[id]','page')}catch{}}
  return {success:true,preview:data.preview};
 }catch{return {success:false,error:execute?'انقطع الاتصال؛ أعد محاولة الطلب نفسه للتحقق من النتيجة':'تعذر تحميل المعاينة',uncertain:execute}}
}
