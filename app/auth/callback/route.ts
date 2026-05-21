import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// يُستخدم لتأكيد الإيميل (Email Confirmation) وGoogle OAuth مستقبلاً
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: store } = await supabase
          .from('stores')
          .select('id')
          .eq('owner_id', user.id)
          .single()

        return NextResponse.redirect(`${origin}${store ? '/dashboard' : '/onboarding'}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
