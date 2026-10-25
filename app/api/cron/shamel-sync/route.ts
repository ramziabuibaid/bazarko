import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractDriveFolderId, syncFromGoogleDriveFolder } from '@/lib/shamel/gdrive'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    // Allow authorization via Bearer token (if CRON_SECRET is set), or Vercel cron header
    const isVercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
    if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !isVercelCron) {
      return NextResponse.json({ error: 'Unauthorized cron request' }, { status: 401 })
    }

    const supabase = createAdminClient()

    // 1. Fetch all store configurations where auto-sync is enabled
    const { data: configs, error: cfgErr } = await supabase
      .from('shamel_sync_configs')
      .select('*')
      .eq('auto_sync_enabled', true)
      .not('gdrive_folder_id', 'is', null)

    if (cfgErr) {
      console.error('Error fetching shamel sync configs for cron:', cfgErr)
      return NextResponse.json({ error: cfgErr.message }, { status: 500 })
    }

    if (!configs || configs.length === 0) {
      return NextResponse.json({ message: 'No stores configured for auto-sync', processed: 0 })
    }

    const results: Array<{ storeId: string; status: 'success' | 'skipped' | 'error'; message: string }> = []

    for (const config of configs) {
      const storeId = config.store_id
      const intervalHours = Number(config.sync_interval_hours) || 24

      // Check if it's time to sync
      if (config.updated_at && config.last_sync_status === 'success') {
        const lastSyncTime = new Date(config.updated_at).getTime()
        const now = Date.now()
        const hoursPassed = (now - lastSyncTime) / (1000 * 60 * 60)

        // If not enough time has passed and forced param isn't set, skip
        const force = req.nextUrl.searchParams.get('force') === 'true'
        if (!force && hoursPassed < intervalHours) {
          results.push({
            storeId,
            status: 'skipped',
            message: `Skipped: only ${hoursPassed.toFixed(1)}h passed since last sync (interval: ${intervalHours}h)`,
          })
          continue
        }
      }

      const cleanFolderId = extractDriveFolderId(config.gdrive_folder_id)
      if (!cleanFolderId) {
        results.push({ storeId, status: 'error', message: 'Invalid Google Drive folder ID' })
        continue
      }

      // Mark in_progress
      await supabase
        .from('shamel_sync_configs')
        .update({
          last_sync_status: 'in_progress',
          last_sync_message: 'المزامنة الآلية قيد المعالجة وسحب ملفات الشامل من Google Drive...',
          updated_at: new Date().toISOString(),
        })
        .eq('store_id', storeId)

      try {
        const syncResult = await syncFromGoogleDriveFolder(cleanFolderId)
        const { folderTitle, filesDownloaded, parsedData, summary } = syncResult
        const snapId = `shamel_cron_${Date.now()}`

        const chunkArray = <T,>(arr: T[], size: number): T[][] => {
          const chunks: T[][] = []
          for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size))
          }
          return chunks
        }

        const saveIsolated = async (kind: string, items: any[]) => {
          if (!items || items.length === 0) return
          const batchSize = (kind === 'entries' || kind === 'invoice_items' || kind === 'cheques') ? 1500 : 500
          const chunks = chunkArray(items, batchSize)
          for (const c of chunks) {
            const { error: rpcErr } = await supabase.rpc('shamel_save_isolated_batch', {
              p_store_id: storeId,
              p_snapshot_id: snapId,
              p_kind: kind,
              p_items: c,
            })
            if (rpcErr) throw new Error(`${kind}: ${rpcErr.message}`)
          }
        }

        await saveIsolated('accounts', parsedData.accounts)
        await saveIsolated('customers', parsedData.customers)

        // Enrich cost prices
        try {
          const { data: existingStockCosts } = await supabase
            .from('shamel_stock')
            .select('code, cost_price, price')
            .eq('store_id', storeId)
            .gt('cost_price', 0)

          if (existingStockCosts && existingStockCosts.length > 0) {
            const costMap = new Map(existingStockCosts.map(c => [c.code, Number(c.cost_price)]))
            const priceMap = new Map(existingStockCosts.filter(c => Number(c.price) > 0).map(c => [c.code, Number(c.price)]))
            for (const p of parsedData.products) {
              if ((!p.cost_price || p.cost_price === 0) && costMap.has(p.code)) {
                p.cost_price = costMap.get(p.code)!
              }
              if ((!p.price || p.price === 0) && priceMap.has(p.code)) {
                p.price = priceMap.get(p.code)!
              }
            }
          }
        } catch {}

        await saveIsolated('stock', parsedData.products)
        await saveIsolated('cheques', parsedData.cheques)
        await saveIsolated('assets', parsedData.assets)
        await saveIsolated('cost_centers', parsedData.costCenters)
        await saveIsolated('salesmen', parsedData.salesmen)
        await saveIsolated('customer_prices', parsedData.customerPrices)

        const sortedEntries = [...parsedData.entries].sort((a, b) => (b.day || '').localeCompare(a.day || ''))
        await saveIsolated('entries', sortedEntries.slice(0, 30000))

        const sortedItems = [...parsedData.invoiceItems].sort((a, b) => (b.day || '').localeCompare(a.day || ''))
        await saveIsolated('invoice_items', sortedItems.slice(0, 30000))

        // Refresh Customer activity dates and balances
        try {
          await supabase.rpc('shamel_refresh_customer_summaries', { p_store_id: storeId })
        } catch (sumErr: any) {
          console.warn('Cron refresh customer summaries warning:', sumErr?.message)
        }

        // Automatic reconciliation to Bazarko operational tables
        try {
          const { executeHybridSync } = await import('@/lib/shamel/hybrid-sync')
          await executeHybridSync(supabase, storeId)
        } catch (hybridErr: any) {
          console.warn('Cron hybrid sync warning:', hybridErr?.message)
        }

        const successMsg = `تمت المزامنة الآلية بنجاح من مجلد ${folderTitle || 'Google Drive'} (${filesDownloaded.length} ملف)`
        await supabase
          .from('shamel_sync_configs')
          .update({
            last_sync_status: 'success',
            last_sync_message: successMsg,
            last_sync_report: {
              timestamp: new Date().toISOString(),
              folderTitle,
              filesCount: filesDownloaded.length,
              summary,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('store_id', storeId)

        results.push({ storeId, status: 'success', message: successMsg })
      } catch (syncErr: any) {
        console.error(`Cron sync error for store ${storeId}:`, syncErr)
        const errMsg = `فشل المزامنة الآلية: ${syncErr?.message || 'خطأ غير معروف'}`
        await supabase
          .from('shamel_sync_configs')
          .update({
            last_sync_status: 'error',
            last_sync_message: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('store_id', storeId)

        results.push({ storeId, status: 'error', message: errMsg })
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results })
  } catch (err: any) {
    console.error('Fatal cron handler error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
