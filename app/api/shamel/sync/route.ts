import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import {
  extractDriveFolderId,
  fetchGoogleDriveFolderFiles,
  syncFromGoogleDriveFolder,
} from '@/lib/shamel/gdrive'
import { executeHybridSync } from '@/lib/shamel/hybrid-sync'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }

    const storeId = await getStoreForUser(supabase, user.id)
    if (!storeId) {
      return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 })
    }

    const { data: config } = await supabase
      .from('shamel_sync_configs')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle()

    return NextResponse.json({ config: config || null })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

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
    const { action, folderId, folderName, serviceAccount, credentialsJson, autoSync, syncInterval, syncModel } = body

    // 1. Update Config action
    if (action === 'save_config') {
      const cleanFolderId = extractDriveFolderId(folderId)
      let finalFolderName = folderName?.trim()

      // If folder name wasn't provided, try to detect it from the folder page
      if (!finalFolderName && cleanFolderId) {
        try {
          const { folderTitle } = await fetchGoogleDriveFolderFiles(cleanFolderId)
          if (folderTitle) finalFolderName = folderTitle
        } catch {
          // ignore detection failure
        }
      }

      // Fetch existing config report to preserve report data while updating model if needed
      const { data: existingCfg } = await supabase
        .from('shamel_sync_configs')
        .select('last_sync_report')
        .eq('store_id', storeId)
        .maybeSingle()

      const currentReport = (existingCfg?.last_sync_report as any) || {}
      const updatedReport = {
        ...currentReport,
        sync_model: syncModel || currentReport.sync_model || 'hybrid_sync',
      }

      const { data, error } = await supabase
        .from('shamel_sync_configs')
        .upsert(
          {
            store_id: storeId,
            gdrive_folder_id: cleanFolderId,
            gdrive_folder_name: finalFolderName || 'Shamel_Backups',
            gdrive_service_account: serviceAccount || null,
            gdrive_credentials_json: credentialsJson || null,
            auto_sync_enabled: autoSync ?? false,
            sync_interval_hours: syncInterval || 24,
            last_sync_report: updatedReport,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'store_id' }
        )
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ ok: true, message: 'تم حفظ إعدادات ونموذج المزامنة السحابية بنجاح', config: data })
    }

    // 2. Trigger Sync Now action
    if (action === 'sync_now') {
      // Fetch existing config
      const { data: config } = await supabase
        .from('shamel_sync_configs')
        .select('*')
        .eq('store_id', storeId)
        .maybeSingle()

      if (!config || !config.gdrive_folder_id) {
        return NextResponse.json({
          error: 'يرجى حفظ معرف أو رابط مجلد Google Drive أولاً قبل تشغيل المزامنة'
        }, { status: 400 })
      }

      const cleanFolderId = extractDriveFolderId(config.gdrive_folder_id)

      // Mark sync as in_progress
      await supabase
        .from('shamel_sync_configs')
        .update({
          last_sync_status: 'in_progress',
          last_sync_message: 'جاري الاتصال بـ Google Drive وفحص وتحميل ملفات الشامل المحدثة...',
          updated_at: new Date().toISOString(),
        })
        .eq('store_id', storeId)

      try {
        const syncResult = await syncFromGoogleDriveFolder(cleanFolderId)
        const { folderTitle, filesDownloaded, parsedData, summary } = syncResult
        const snapId = `shamel_gdrive_${Date.now()}`

        // Helper to chunk arrays
        const chunkArray = <T,>(arr: T[], size: number): T[][] => {
          const chunks: T[][] = []
          for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size))
          }
          return chunks
        }

        const saveIsolated = async (kind: string, items: any[]) => {
          if (!items || items.length === 0) return
          const chunks = chunkArray(items, 300)
          for (const c of chunks) {
            const { error: rpcErr } = await supabase.rpc('shamel_save_isolated_batch', {
              p_store_id: storeId,
              p_snapshot_id: snapId,
              p_kind: kind,
              p_items: c,
            })
            if (rpcErr) {
              console.error(`Error saving isolated batch for ${kind}:`, rpcErr)
              throw new Error(`فشل حفظ دفعة ${kind}: ${rpcErr.message}`)
            }
          }
        }

        // Save all parsed entities to the isolated store
        await saveIsolated('accounts', parsedData.accounts)
        await saveIsolated('customers', parsedData.customers)
        await saveIsolated('stock', parsedData.products)
        await saveIsolated('cheques', parsedData.cheques)
        await saveIsolated('assets', parsedData.assets)
        await saveIsolated('cost_centers', parsedData.costCenters)
        await saveIsolated('salesmen', parsedData.salesmen)
        await saveIsolated('customer_prices', parsedData.customerPrices)

        // For large historical archives (100k+ entries), sort by date descending so the newest records are processed first
        try {
          const sortedEntries = [...parsedData.entries].sort((a, b) => (b.day || '').localeCompare(a.day || ''))
          // Take the most recent 30,000 entries
          const entriesToSave = sortedEntries.slice(0, 30000)
          await saveIsolated('entries', entriesToSave)
        } catch (entriesErr: any) {
          console.warn('Entries batch save warning (continuing sync):', entriesErr?.message)
        }

        try {
          const sortedItems = [...parsedData.invoiceItems].sort((a, b) => (b.day || '').localeCompare(a.day || ''))
          const itemsToSave = sortedItems.slice(0, 30000)
          await saveIsolated('invoice_items', itemsToSave)
        } catch (itemsErr: any) {
          console.warn('Invoice items batch save warning (continuing sync):', itemsErr?.message)
        }

        // Refresh Customer activity dates and balances in a single clean pass
        try {
          await supabase.rpc('shamel_refresh_customer_summaries', { p_store_id: storeId })
        } catch (sumErr: any) {
          console.warn('Refresh customer summaries warning:', sumErr?.message)
        }

        // Save snapshot audit entry
        const now = new Date().toISOString()
        await supabase
          .from('shamel_snapshots')
          .upsert({
            id: snapId,
            store_id: storeId,
            source_modified_at: now,
            imported_at: now,
            manifest: parsedData.inspections || [],
            report: {
              ...(parsedData.reconciliation || {}),
              source: 'gdrive',
              folder_id: cleanFolderId,
              folder_name: folderTitle || config.gdrive_folder_name,
              files_downloaded: filesDownloaded,
            },
            status: 'applied',
            created_by: user.id,
          })

        // Hybrid Model: automatically synchronize Customers and Stock to Bazarko
        let hybridResult: any = null
        const syncModel = (config.last_sync_report as any)?.sync_model || 'hybrid_sync'
        if (syncModel === 'hybrid_sync') {
          try {
            hybridResult = await executeHybridSync(supabase, storeId)
          } catch (hybridErr: any) {
            console.warn('Hybrid sync automatic reconciliation warning:', hybridErr?.message)
          }
        }

        const detailedMsg = hybridResult
          ? `اكتملت المزامنة بنجاح: تم تحديث ${summary.accountsCount} حساب، ومزامنة ومطابقة ${hybridResult.customersInserted + hybridResult.customersUpdated + hybridResult.customersMatchedByPhone} زبون، و${hybridResult.productsInserted + hybridResult.productsUpdated} صنف في بازاركو.`
          : `اكتملت المزامنة بنجاح: تم تحديث ${summary.accountsCount} حساب، ${summary.customersCount} زبون ومورد، ${summary.productsCount} صنف، ${summary.chequesCount} شيك.`

        const report = {
          checked_at: now,
          folder_id: cleanFolderId,
          folder_name: folderTitle || config.gdrive_folder_name,
          files_found: filesDownloaded,
          status: 'synced_successfully',
          sync_model: syncModel,
          counts: summary,
          hybrid_result: hybridResult,
        }

        const { data: updatedConfig } = await supabase
          .from('shamel_sync_configs')
          .update({
            gdrive_folder_name: config.gdrive_folder_name === 'Shamel_Backups' || !config.gdrive_folder_name ? (folderTitle || config.gdrive_folder_name) : config.gdrive_folder_name,
            last_sync_at: now,
            last_sync_status: 'success',
            last_sync_message: detailedMsg,
            last_sync_report: report,
            updated_at: now,
          })
          .eq('store_id', storeId)
          .select()
          .single()

        return NextResponse.json({
          ok: true,
          message: detailedMsg,
          config: updatedConfig,
          report,
          summary,
        })
      } catch (syncErr: any) {
        console.error('Google drive sync failed:', syncErr)
        const errMsg = syncErr?.message || 'فشلت عملية المزامنة من Google Drive'

        await supabase
          .from('shamel_sync_configs')
          .update({
            last_sync_status: 'error',
            last_sync_message: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('store_id', storeId)

        return NextResponse.json({ error: errMsg }, { status: 400 })
      }
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
  } catch (err: any) {
    console.error('Shamel sync API error:', err)
    return NextResponse.json({ error: err?.message || 'فشلت المزامنة السحابية' }, { status: 500 })
  }
}
