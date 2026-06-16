'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  storeId: string
  eventType?: 'store_visit' | 'product_view' | 'add_to_cart' | 'add_to_wishlist' | 'search' | 'checkout_start'
  productId?: string
  categoryId?: string
  searchQuery?: string
  pagePath?: string
}

function getVisitorId(): string {
  try {
    let vid = localStorage.getItem('bz_visitor_id')
    if (!vid) {
      vid = crypto.randomUUID()
      localStorage.setItem('bz_visitor_id', vid)
    }
    return vid
  } catch {
    return 'unknown'
  }
}

function getSessionId(): string {
  try {
    let sid = sessionStorage.getItem('bz_session_id')
    if (!sid) {
      sid = crypto.randomUUID()
      sessionStorage.setItem('bz_session_id', sid)
    }
    return sid
  } catch {
    return 'unknown'
  }
}

export default function StoreAnalyticsTracker({
  storeId,
  eventType = 'store_visit',
  productId,
  categoryId,
  searchQuery,
  pagePath,
}: Props) {
  useEffect(() => {
    const visitorId = getVisitorId()
    const sessionId = getSessionId()
    const isMobile  = /Mobi|Android/i.test(navigator.userAgent)

    createClient().rpc('track_store_event', {
      p_store_id:     storeId,
      p_visitor_id:   visitorId,
      p_session_id:   sessionId,
      p_event_type:   eventType,
      p_product_id:   productId  ?? null,
      p_category_id:  categoryId ?? null,
      p_search_query: searchQuery ?? null,
      p_page_path:    pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      p_is_mobile:    isMobile,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

// دالة مساعدة للتتبع اليدوي من مكونات أخرى
export function trackEvent(
  storeId: string,
  eventType: Props['eventType'],
  extra: Partial<Omit<Props, 'storeId' | 'eventType'>> = {}
) {
  try {
    const visitorId = getVisitorId()
    const sessionId = getSessionId()
    const isMobile  = /Mobi|Android/i.test(navigator.userAgent)

    createClient().rpc('track_store_event', {
      p_store_id:     storeId,
      p_visitor_id:   visitorId,
      p_session_id:   sessionId,
      p_event_type:   eventType ?? 'store_visit',
      p_product_id:   extra.productId  ?? null,
      p_category_id:  extra.categoryId ?? null,
      p_search_query: extra.searchQuery ?? null,
      p_page_path:    extra.pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      p_is_mobile:    isMobile,
    })
  } catch {}
}
