import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCountryByCode } from '@/lib/countries'
import BazarkoLogo from '@/components/ui/BazarkoLogo'

interface Props {
  children: React.ReactNode
  params: { country: string }
}

export default function MarketplaceLayout({ children, params }: Props) {
  const country = getCountryByCode(params.country)
  if (!country) notFound()

  return (
    <div className="min-h-screen bg-slate-950 text-white" dir="rtl">
      {/* Navbar */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <BazarkoLogo size="sm" variant="image" href={`/marketplace/${params.country}`} />
            <span className="rounded-full bg-sky-500/15 border border-sky-500/20 px-2 py-0.5 text-xs text-sky-400 font-medium">
              {country.name_ar}
            </span>
          </div>

          {/* Search Bar */}
          <form action={`/marketplace/${params.country}/search`} method="get" className="flex-1 max-w-xl">
            <div className="flex">
              <input
                name="q"
                placeholder="ابحث عن منتج أو متجر..."
                className="w-full rounded-r-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-500/50"
              />
              <button type="submit"
                className="rounded-l-xl border border-r-0 border-white/10 bg-slate-800 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                🔍
              </button>
            </div>
          </form>

          <nav className="hidden md:flex items-center gap-1">
            <Link href={`/marketplace/${params.country}`}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
              الرئيسية
            </Link>
            <Link href={`/marketplace/${params.country}/stores`}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
              المتاجر
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-slate-500">
        <div className="flex items-center justify-center gap-2">
          <BazarkoLogo size="xs" variant="image" href="/" />
          <span>· {country.name_ar} · جميع الحقوق محفوظة</span>
        </div>
      </footer>
    </div>
  )
}
