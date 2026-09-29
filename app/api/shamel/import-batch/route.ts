import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'غير مصرح لك بالوصول' }, { status: 401 })
    }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) {
      return NextResponse.json({ error: 'لم يتم العثور على متجر مرتبط بهذا المستخدم' }, { status: 403 })
    }

    const body = await req.json()
    const { action, table, items, snapshot, entity, code, wipeOperational } = body

    // 1. Wipe & Reset Store Action
    if (action === 'wipe_store') {
      const { data, error } = await supabase.rpc('shamel_reset_store', {
        p_store_id: storeId,
        p_wipe_operational: wipeOperational ?? true,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, message: 'تم إفراغ وإعادة ضبط بيانات المتجر بنجاح' })
    }

    // 2. Promote Entity to Bazarko Action
    if (action === 'promote') {
      if (!entity) {
        return NextResponse.json({ error: 'يرجى تحديد الكيان المراد ترحيله' }, { status: 400 })
      }
      const { data, error } = await supabase.rpc('shamel_promote_entity', {
        p_store_id: storeId,
        p_entity: entity,
        p_code: code || null,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, result: data })
    }

    // 2.1 Reconstruct Entire System from Operations (Strict 17-Stage Engine)
    if (action === 'reconstruct') {
      const stage = typeof body.stage === 'number' ? body.stage : 0
      const { data, error } = await supabase.rpc('shamel_reconstruct_from_operations', {
        p_store_id: storeId,
        p_stage: stage,
        p_options: body.options || {},
      })
      if (error) {
        console.error('Reconstruction error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, result: data })
    }

    // 2.2 Cascade Delete Operational Document
    if (action === 'delete_operational_document') {
      if (!body.sourceType || !body.sourceId) {
        return NextResponse.json({ error: 'يرجى تحديد نوع المستند ورقمه' }, { status: 400 })
      }
      const { data, error } = await supabase.rpc('shamel_delete_operational_document', {
        p_store_id: storeId,
        p_source_type: body.sourceType,
        p_source_id: body.sourceId,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, result: data })
    }

    // 3. Isolated Batch Save Action (Stores in shamel_* tables first!)
    if (action === 'save_isolated') {
      const { data, error } = await supabase.rpc('shamel_save_isolated_batch', {
        p_store_id: storeId,
        p_snapshot_id: body.snapshotId || 'snapshot_direct',
        p_kind: table,
        p_items: items,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, result: data })
    }

    // 4. Save Snapshot Audit Entry
    if (table === 'snapshot' && snapshot) {
      const { error: snapError } = await supabase
        .from('shamel_snapshots')
        .upsert({
          id: snapshot.id,
          store_id: storeId,
          source_modified_at: snapshot.source_modified_at || new Date().toISOString(),
          imported_at: new Date().toISOString(),
          manifest: snapshot.manifest || [],
          report: snapshot.report || {},
          status: 'applied',
          created_by: user.id,
        })

      if (snapError) {
        console.error('Snapshot insert error:', snapError)
        return NextResponse.json({ error: snapError.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, message: 'تم حفظ سجل النسخة الاحتياطية بنجاح' })
    }

    // 5. Direct Operational RPC Ingestion (Optional)
    let rpcName = ''
    let paramKey = ''

    switch (table) {
      case 'accounts':
        rpcName = 'shamel_bulk_upsert_accounts'
        paramKey = 'p_accounts'
        break
      case 'customers':
        rpcName = 'shamel_bulk_upsert_customers'
        paramKey = 'p_customers'
        break
      case 'suppliers':
        rpcName = 'shamel_bulk_upsert_suppliers'
        paramKey = 'p_suppliers'
        break
      case 'products':
        rpcName = 'shamel_bulk_upsert_products'
        paramKey = 'p_products'
        break
      case 'checks':
        rpcName = 'shamel_bulk_upsert_checks'
        paramKey = 'p_checks'
        break
      case 'assets':
        rpcName = 'shamel_bulk_upsert_assets'
        paramKey = 'p_assets'
        break
      case 'cost_centers':
        rpcName = 'shamel_bulk_upsert_cost_centers'
        paramKey = 'p_cost_centers'
        break
      case 'sales_reps':
        rpcName = 'shamel_bulk_upsert_sales_reps'
        paramKey = 'p_sales_reps'
        break
      case 'price_lists':
        rpcName = 'shamel_bulk_upsert_price_lists'
        paramKey = 'p_price_lists'
        break
      default:
        return NextResponse.json({ error: `جدول غير مدعوم: ${table}` }, { status: 400 })
    }

    const { data: result, error: rpcError } = await supabase.rpc(rpcName, {
      p_store_id: storeId,
      [paramKey]: items,
    })

    if (rpcError) {
      console.error(`RPC ${rpcName} error:`, rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, result })
  } catch (err: any) {
    console.error('Import batch API error:', err)
    return NextResponse.json({ error: err?.message || 'حدث خطأ أثناء معالجة الدفعة' }, { status: 500 })
  }
}
