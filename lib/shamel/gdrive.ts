import { processShamelArchive, KNOWN_SHAMEL_TABLES } from './mapper'
import { ExtractedFile } from './unzip'
import { ShamelParsedData } from './types'

/**
 * Extracts a clean Google Drive folder ID from a URL or raw ID string.
 */
export function extractDriveFolderId(input: string): string {
  if (!input) return ''
  const trimmed = input.trim()

  // Match /folders/ID or id=ID or raw ID
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (folderMatch) return folderMatch[1]

  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (idParamMatch) return idParamMatch[1]

  // If input contains slashes or spaces, strip query params
  const clean = trimmed.split('?')[0].split('#')[0]
  const lastSegment = clean.split('/').filter(Boolean).pop() || clean
  return lastSegment.trim()
}

interface DriveFileInfo {
  name: string
  id: string
}

/**
 * Fetches the publicly shared Google Drive folder HTML across different sorts
 * to discover all contained files (.dat, .zip, etc.).
 */
export async function fetchGoogleDriveFolderFiles(folderId: string): Promise<{
  folderTitle: string
  files: Map<string, DriveFileInfo>
}> {
  const cleanId = extractDriveFolderId(folderId)
  if (!cleanId) {
    throw new Error('معرف مجلد Google Drive غير صالح.')
  }

  // Google Drive web pages list 50 files per page.
  // Querying multiple sort orders (modified desc, name asc, name desc)
  // allows discovering up to 150+ unique files without requiring OAuth.
  const sorts = ['?sort=11', '?sort=1', '?sort=7']
  const fileMap = new Map<string, DriveFileInfo>()
  let detectedTitle = ''

  for (const sortQuery of sorts) {
    const url = `https://drive.google.com/drive/folders/${cleanId}${sortQuery}`
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        },
        cache: 'no-store',
      })

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('لم يتم العثور على مجلد Google Drive. تأكد من صحة الرابط أو المعرف.')
        }
        continue
      }

      const html = await res.text()

      // Extract folder title if not yet found
      if (!detectedTitle) {
        const titleMatch = html.match(/<title>[\u202A\u202B\u202C\u200E\u200F]*(.*?)[\u202A\u202B\u202C\u200E\u200F]* - Google Drive<\/title>/i)
        if (titleMatch && titleMatch[1]) {
          detectedTitle = titleMatch[1].trim()
        }
      }

      // Extract ds:4 data callback which contains the file items
      const match = html.match(/AF_initDataCallback\(\{key: ['"]ds:4['"][\s\S]*?data:([\s\S]*?),\s*sideChannel:/)
      if (!match) continue

      try {
        const parsed = JSON.parse(match[1])
        const it0 = parsed[27]?.[7]?.[0]
        const items = it0?.[0] || []

        for (const node of items) {
          if (node && Array.isArray(node[0]) && typeof node[0][1] === 'string') {
            const fileId = node[0][1]
            const str = JSON.stringify(node)
            // Match files ending in DAT, dat, ZIP, zip, etc.
            const fnMatch = str.match(/"([a-zA-Z0-9_\-\.\u0600-\u06FF ]+\.(?:DAT|dat|ZIP|zip|bak|BAK))"/)
            if (fnMatch) {
              const fileName = fnMatch[1]
              const key = fileName.toLowerCase()
              if (!fileMap.has(key)) {
                fileMap.set(key, { name: fileName, id: fileId })
              }
            }
          }
        }
      } catch (parseErr) {
        console.warn('Failed parsing ds:4 callback JSON:', parseErr)
      }
    } catch (fetchErr: any) {
      console.warn(`Error fetching Google Drive folder sort ${sortQuery}:`, fetchErr?.message)
    }
  }

  if (fileMap.size === 0) {
    throw new Error(
      'لم نتمكن من قراءة ملفات من مجلد Google Drive. تأكد من مشاركة المجلد للعامة بحيث يكون «أي شخص لديه الرابط يمكنه العرض» (Anyone with the link can view).'
    )
  }

  return {
    folderTitle: detectedTitle || 'Google Drive Folder',
    files: fileMap,
  }
}

/**
 * Downloads a single file from Google Drive by its file ID.
 */
export async function downloadDriveFile(fileId: string): Promise<Uint8Array> {
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`
  const res = await fetch(downloadUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`فشل تحميل الملف من Google Drive (رمز الحالة ${res.status})`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    const html = await res.text()
    // Handle Google Drive virus scan warning for large files
    const confirmMatch = html.match(/confirm=([0-9a-zA-Z_-]+)/) || html.match(/name="confirm" value="([^"]+)"/)
    if (confirmMatch) {
      const confirmToken = confirmMatch[1]
      const confirmRes = await fetch(
        `https://drive.google.com/uc?export=download&confirm=${confirmToken}&id=${fileId}`,
        {
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          },
          cache: 'no-store',
        }
      )
      if (confirmRes.ok) {
        const buf = await confirmRes.arrayBuffer()
        return new Uint8Array(buf)
      }
    }
    throw new Error('تعذر تحميل الملف من Google Drive — يرجى التأكد من إذن الوصول للملف.')
  }

  const arrayBuffer = await res.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

export interface GoogleDriveSyncResult {
  folderTitle: string
  filesDownloaded: string[]
  parsedData: ShamelParsedData
  summary: {
    accountsCount: number
    customersCount: number
    productsCount: number
    chequesCount: number
    entriesCount: number
    invoiceItemsCount: number
  }
}

/**
 * Downloads Shamel ERP .dat files from a Google Drive folder and parses them.
 */
export async function syncFromGoogleDriveFolder(folderId: string): Promise<GoogleDriveSyncResult> {
  const { folderTitle, files } = await fetchGoogleDriveFolderFiles(folderId)

  // Identify which KNOWN_SHAMEL_TABLES are present
  const extractedFiles = new Map<string, ExtractedFile>()
  const downloadedNames: string[] = []

  // Check which known tables exist
  const tablesToDownload: { key: string; name: string; id: string }[] = []
  for (const table of KNOWN_SHAMEL_TABLES) {
    const key = table.filename.toLowerCase()
    const found = files.get(key)
    if (found) {
      tablesToDownload.push({ key, name: found.name, id: found.id })
    }
  }

  // Also include any other .dat files present (e.g. sitems.dat, cpage.dat, etc.)
  for (const [key, info] of files.entries()) {
    if (key.endsWith('.dat') && !tablesToDownload.some(t => t.key === key)) {
      tablesToDownload.push({ key, name: info.name, id: info.id })
    }
  }

  if (tablesToDownload.length === 0) {
    throw new Error(
      'لم يتم العثور على أي ملفات محاسبية للشامل (.DAT) داخل مجلد Google Drive المحدد. يرجى التأكد من اختيار المجلد الصحيح الذي يحتوي على ملفات الشامل.'
    )
  }

  // Download all files in parallel (batched in chunks of 5 to avoid connection flooding)
  const chunkSize = 5
  for (let i = 0; i < tablesToDownload.length; i += chunkSize) {
    const batch = tablesToDownload.slice(i, i + chunkSize)
    await Promise.all(
      batch.map(async item => {
        try {
          const data = await downloadDriveFile(item.id)
          extractedFiles.set(item.key, {
            name: item.name,
            cleanName: item.key,
            data,
            size: data.byteLength,
            depth: 1,
            path: item.name,
          })
          downloadedNames.push(item.name)
        } catch (downloadErr) {
          console.warn(`Failed downloading ${item.name} (${item.id}):`, downloadErr)
        }
      })
    )
  }

  if (extractedFiles.size === 0) {
    throw new Error('فشل تحميل ملفات الشامل من Google Drive. يرجى مراجعة إعدادات المشاركة.')
  }

  // Parse all files using the standard Shamel parser
  const parsedData = processShamelArchive(extractedFiles)

  return {
    folderTitle,
    filesDownloaded: downloadedNames,
    parsedData,
    summary: {
      accountsCount: parsedData.accounts.length,
      customersCount: parsedData.customers.length,
      productsCount: parsedData.products.length,
      chequesCount: parsedData.cheques.length,
      entriesCount: parsedData.entries.length,
      invoiceItemsCount: parsedData.invoiceItems.length,
    },
  }
}
