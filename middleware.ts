import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const MAIN_DOMAIN = process.env.NEXT_PUBLIC_DOMAIN || 'bazarko.app'
const COUNTRY_PREFIXES = ['ps', 'sy', 'jo', 'lb']
const RESERVED = new Set(['www', 'api', 'admin', 'marketplace', 'dashboard', 'mail', 'smtp'])

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const pathname = request.nextUrl.pathname

  // ── تحديث جلسة Supabase (ضروري في كل request) ──
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isLocalhost = hostname === 'localhost:3000' || hostname === '127.0.0.1:3000'

  // ── Localhost: routing مباشر بدون subdomain ──
  if (isLocalhost) {
    if (pathname.startsWith('/dashboard') && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // ── الدومين الرئيسي: bazarko.app ──
  if (hostname === MAIN_DOMAIN || hostname === `www.${MAIN_DOMAIN}`) {
    if (pathname.startsWith('/dashboard') && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  const escaped = MAIN_DOMAIN.replace('.', '\\.')

  // ── ps.bazarko.app → Marketplace دولة ──
  const countryMatch = hostname.match(
    new RegExp(`^(${COUNTRY_PREFIXES.join('|')})\\.${escaped}$`)
  )
  if (countryMatch) {
    const url = request.nextUrl.clone()
    url.pathname = `/marketplace/${countryMatch[1]}${pathname}`
    return NextResponse.rewrite(url)
  }

  // ── store.ps.bazarko.app → متجر (النمط القديم) ──
  const storeCountryMatch = hostname.match(
    new RegExp(`^([a-z0-9-]+)\\.(${COUNTRY_PREFIXES.join('|')})\\.${escaped}$`)
  )
  if (storeCountryMatch) {
    const [, subdomain, country] = storeCountryMatch
    const url = request.nextUrl.clone()
    url.pathname = `/store/${country}/${subdomain}${pathname}`
    return NextResponse.rewrite(url)
  }

  // ── store.bazarko.app → متجر (النمط الجديد) ──
  const storeMatch = hostname.match(new RegExp(`^([a-z0-9][a-z0-9-]*)\\.${escaped}$`))
  if (storeMatch) {
    const subdomain = storeMatch[1]

    // تخطي الـ subdomains المحجوزة
    if (RESERVED.has(subdomain) || COUNTRY_PREFIXES.includes(subdomain)) {
      return response
    }

    // تجنب double-rewrite إذا كان الـ path يبدأ بـ /store/
    if (pathname.startsWith('/store/') || pathname.startsWith('/marketplace/')) {
      return response
    }

    // جلب country_code من Supabase
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/stores` +
        `?subdomain=eq.${encodeURIComponent(subdomain)}&is_active=eq.true&select=country_code&limit=1`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          },
          next: { revalidate: 300 }, // cache 5 دقائق
        }
      )

      if (res.ok) {
        const stores: Array<{ country_code: string }> = await res.json()
        if (stores.length > 0) {
          const country = stores[0].country_code.toLowerCase()
          const url = request.nextUrl.clone()
          url.pathname = `/store/${country}/${subdomain}${pathname === '/' ? '' : pathname}`
          url.search = request.nextUrl.search
          return NextResponse.rewrite(url)
        }
      }
    } catch {
      // في حال فشل الـ fetch، نكمل بدون rewrite
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
