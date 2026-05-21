import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const MAIN_DOMAIN = process.env.NEXT_PUBLIC_DOMAIN || 'bazarko.com'
const COUNTRY_PREFIXES = ['ps', 'sy', 'jo', 'lb']

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''

  // ── تحديث جلسة Supabase (ضروري في كل request) ──
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
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

  // يجدد الجلسة إذا انتهت صلاحيتها
  const { data: { user } } = await supabase.auth.getUser()

  const isLocalhost = hostname === 'localhost:3000' || hostname === '127.0.0.1:3000'
  const pathname = request.nextUrl.pathname

  // ── في بيئة localhost: routing مباشر بدون subdomain ──
  if (isLocalhost) {
    // حماية dashboard: يجب تسجيل الدخول
    if (pathname.startsWith('/dashboard') && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    // إعادة التوجيه من / إلى /dashboard إذا مسجل
    if (pathname === '/' && user) {
      // لا نعيد التوجيه — نترك الصفحة الرئيسية للتسويق
    }
    return response
  }

  // ── الدومين الرئيسي (bazarko.com) ──
  if (hostname === MAIN_DOMAIN || hostname === `www.${MAIN_DOMAIN}`) {
    if (pathname.startsWith('/dashboard') && !user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // ── Marketplace دولة (ps.bazarko.com) ──
  const countryMatch = hostname.match(
    new RegExp(`^(${COUNTRY_PREFIXES.join('|')})\\.${MAIN_DOMAIN.replace('.', '\\.')}$`)
  )
  if (countryMatch) {
    const countryCode = countryMatch[1]
    const url = request.nextUrl.clone()
    url.pathname = `/marketplace/${countryCode}${pathname}`
    return NextResponse.rewrite(url)
  }

  // ── متجر تاجر (storename.ps.bazarko.com) ──
  const storeMatch = hostname.match(
    new RegExp(`^([a-z0-9-]+)\\.(${COUNTRY_PREFIXES.join('|')})\\.${MAIN_DOMAIN.replace('.', '\\.')}$`)
  )
  if (storeMatch) {
    const subdomain = storeMatch[1]
    const country = storeMatch[2]
    const url = request.nextUrl.clone()
    url.pathname = `/store/${country}/${subdomain}${pathname}`
    return NextResponse.rewrite(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
