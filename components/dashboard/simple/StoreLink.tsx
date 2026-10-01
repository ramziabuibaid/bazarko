'use client'
import { useRef, useState } from 'react'
import { markStoreLinkCopied } from '@/app/dashboard/simple-actions'
import Icon from './Icons'
import styles from './simple.module.css'

export default function StoreLink({url,preview=false,compact=false}:{url:string;preview?:boolean;compact?:boolean}) {
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const field=useRef<HTMLInputElement>(null)
  async function copy() {
    setBusy(true)
    try {
      await navigator.clipboard.writeText(url)
      setMessage('تم نسخ الرابط. أرسله إلى زبائنك.')
      if(!preview) {
        try { const result=await markStoreLinkCopied(); if(!result.ok) setMessage('تم نسخ الرابط، وتعذر حفظ خطوة الإعداد.') } catch {setMessage('تم نسخ الرابط، وتعذر حفظ خطوة الإعداد.')}
      }
    } catch {setMessage('انسخ الرابط من الحقل يدوياً.');field.current?.focus();field.current?.select()}
    finally {setBusy(false)}
  }
  if(compact) return <div className={styles.shareAction}><button onClick={copy} disabled={busy}><Icon name="share"/>مشاركة رابط المتجر</button><span role="status" className={styles.actionMessage}>{message}</span></div>
  return <div className={styles.storeLink}><label htmlFor="simple-store-link">رابط متجرك</label><div><Icon name="share"/><input ref={field} id="simple-store-link" readOnly value={url} dir="ltr" aria-label="رابط متجرك"/></div><button onClick={copy} disabled={busy}><Icon name="copy"/>{busy?'جارٍ النسخ…':'نسخ الرابط'}</button><p role="status">{message||'انسخ الرابط وشاركه على واتساب أو حساباتك الاجتماعية.'}</p><a href={url} target="_blank" rel="noopener noreferrer">عرض متجرك ←</a></div>
}
