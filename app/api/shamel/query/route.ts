import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 })

    const searchParams = req.nextUrl.searchParams
    const kind = searchParams.get('kind') || 'customers'
    const q = (searchParams.get('q') || '').trim()
    const status = searchParams.get('status') || 'all'
    const bank = searchParams.get('bank') || 'all'
    const code = (searchParams.get('code') || searchParams.get('item_code') || '').trim()
    const currency = searchParams.get('currency') || 'ILS'
    const fromDate = searchParams.get('from') || searchParams.get('from_date') || null
    const toDate = searchParams.get('to') || searchParams.get('to_date') || null
    const minAmount = searchParams.get('min_amount') ? Number(searchParams.get('min_amount')) : null
    const maxAmount = searchParams.get('max_amount') ? Number(searchParams.get('max_amount')) : null
    const chequeNo = (searchParams.get('cheque_no') || '').trim()
    const type = searchParams.get('type') || 'all'
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 500)
    const offset = Number(searchParams.get('offset')) || 0

    // 1. Customer Account Statement (كشف حساب الزبون)
    if (kind === 'statement') {
      if (!code) return NextResponse.json({ error: 'كود الزبون مطلوب' }, { status: 400 })

      const { data, error } = await supabase.rpc('shamel_statement', {
        p_store_id: storeId,
        p_code: code,
        p_currency: currency,
        p_from: fromDate,
        p_to: toDate,
        p_offset: offset,
        p_limit: limit,
      })

      if (error) throw error
      if (data && (data as any).error) {
        return NextResponse.json({ error: (data as any).message || 'الزبون غير مسجل في مستودع الشامل' }, { status: 404 })
      }
      return NextResponse.json(data)
    }

    // 2. Item Card (بطاقة وسجل حركة الصنف)
    if (kind === 'item_card') {
      if (!code) return NextResponse.json({ error: 'كود الصنف مطلوب' }, { status: 400 })

      const { data, error } = await supabase.rpc('shamel_item_card', {
        p_store_id: storeId,
        p_item_code: code,
        p_from: fromDate,
        p_to: toDate,
        p_type: type,
        p_offset: offset,
        p_limit: limit,
      })

      if (error) throw error
      return NextResponse.json(data)
    }

    // 3. Document Details (تفاصيل الفاتورة وسند القبض والشيكات التابعة)
    if (kind === 'details') {
      const document = (searchParams.get('document') || '').trim()
      if (!document) return NextResponse.json({ error: 'رقم المستند مطلوب' }, { status: 400 })

      const [invItemsRes, chequesRes, entriesRes] = await Promise.all([
        supabase
          .from('shamel_invoice_items')
          .select('*')
          .eq('store_id', storeId)
          .eq('document', document)
          .order('line_index', { ascending: true }),
        supabase
          .from('shamel_cheques')
          .select('*')
          .eq('store_id', storeId)
          .eq('document', document)
          .order('due_date', { ascending: true }),
        supabase
          .from('shamel_entries')
          .select('*')
          .eq('store_id', storeId)
          .eq('document', document)
          .order('line_index', { ascending: true }),
      ])

      return NextResponse.json({
        document,
        items: invItemsRes.data || [],
        cheques: chequesRes.data || [],
        entries: entriesRes.data || [],
      })
    }

    const sortBy = searchParams.get('sort_by') || 'code'
    const sortDir = searchParams.get('sort_dir') === 'desc' ? 'desc' : 'asc'
    const hideZero = searchParams.get('hide_zero') === 'true'
    const accountNo = (searchParams.get('account_no') || '').trim()
    const amountParam = searchParams.get('amount') ? Number(searchParams.get('amount')) : null

    // 4. Customers Explorer
    if (kind === 'customers') {
      let sortColumn = 'code'
      if (sortBy === 'name') sortColumn = 'name'
      else if (sortBy === 'balance') sortColumn = 'equivalent_balance'
      else if (sortBy === 'last_invoice') sortColumn = 'last_invoice_date'
      else if (sortBy === 'last_receipt') sortColumn = 'last_receipt_date'

      let query = supabase
        .from('shamel_customers')
        .select('*', { count: 'exact' })
        .eq('store_id', storeId)
        .order(sortColumn, { ascending: sortDir === 'asc', nullsFirst: false })

      if (q) {
        query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,phone.ilike.%${q}%`)
      }
      if (hideZero || status === 'has_balance') {
        query = query.or('has_balance.eq.true,equivalent_balance.neq.0,balance.neq.0')
      }

      const { data, count, error } = await query.range(offset, offset + limit - 1)
      if (error) throw error
      return NextResponse.json({ rows: data || [], total: count || 0 })
    }

    // 5. Stock Explorer
    if (kind === 'stock') {
      let query = supabase
        .from('shamel_stock')
        .select('*', { count: 'exact' })
        .eq('store_id', storeId)
        .order('code', { ascending: true })

      if (q) {
        query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,barcode.ilike.%${q}%`)
      }
      if (status === 'in_stock') {
        query = query.gt('quantity', 0)
      }

      const { data, count, error } = await query.range(offset, offset + limit - 1)
      if (error) throw error
      return NextResponse.json({ rows: data || [], total: count || 0 })
    }

    // 6. Cheques Explorer with Advanced Filters (shamel_cheques_browse RPC)
    if (kind === 'cheques') {
      const { data, error } = await supabase.rpc('shamel_cheques_browse', {
        p_store_id: storeId,
        p_query: q,
        p_status: status,
        p_bank: bank,
        p_from: fromDate,
        p_to: toDate,
        p_cheque_no: chequeNo,
        p_account_no: accountNo,
        p_amount: amountParam,
        p_offset: offset,
        p_limit: limit,
      })

      if (error) throw error
      return NextResponse.json(data)
    }

    // 7. Accounts Explorer
    if (kind === 'accounts') {
      let query = supabase
        .from('shamel_accounts')
        .select('*', { count: 'exact' })
        .eq('store_id', storeId)
        .order('code', { ascending: true })

      if (q) {
        query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`)
      }

      const { data, count, error } = await query.range(offset, offset + limit - 1)
      if (error) throw error
      return NextResponse.json({ rows: data || [], total: count || 0 })
    }

    return NextResponse.json({ rows: [], total: 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
