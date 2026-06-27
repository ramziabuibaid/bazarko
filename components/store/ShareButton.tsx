'use client'

import { useEffect, useState } from 'react'

interface Props {
  title: string
  text?: string
}

export default function ShareButton({ title, text }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')
  const [canNativeShare, setCanNativeShare] = useState(false)

  useEffect(() => {
    setUrl(window.location.href)
    setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const shareText = text ?? `شاهد ${title}`

  async function handleClick() {
    // المشاركة الأصلية للموبايل (واتساب، تيليجرام، إلخ من نظام التشغيل)
    if (canNativeShare) {
      try {
        await navigator.share({ title, text: shareText, url })
        return
      } catch {
        // المستخدم ألغى أو فشلت — نعرض القائمة كبديل
      }
    }
    setOpen(o => !o)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const waHref = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url}`)}`
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 py-3 text-sm font-medium text-violet-700 transition hover:bg-violet-50 dark:border-violet-500/25 dark:text-violet-300 dark:hover:bg-violet-500/10"
      >
        <ShareIcon />
        مشاركة المنتج
      </button>

      {open && !canNativeShare && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-50 mb-2 w-full overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span className="text-lg">📱</span> واتساب
            </a>
            <a
              href={tgHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span className="text-lg">✈️</span> تيليجرام
            </a>
            <a
              href={fbHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span className="text-lg">📘</span> فيسبوك
            </a>
            <button
              onClick={copyLink}
              className="flex w-full items-center gap-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span className="text-lg">{copied ? '✓' : '🔗'}</span>
              {copied ? 'تم نسخ الرابط' : 'نسخ الرابط'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}
