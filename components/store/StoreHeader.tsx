'use client'

import { useCart } from '@/lib/store/cart'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Store {
  id: string
  name: string
  logo_url: string | null
  phone: string | null
  whatsapp: string | null
  currency_code: string
}

export default function StoreHeader({ store }: { store: Store }) {
  const count = useCart(s => s.count())
  const pathname = usePathname()

  // استخراج country/subdomain من الـ pathname
  const segments = pathname.split('/')
  const country = segments[2] ?? ''
  const subdomain = segments[3] ?? ''

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href={`/store/${country}/${subdomain}`} className="flex items-center gap-2">
          {store.logo_url ? (
            <img src={store.logo_url} alt={store.name} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-base font-bold text-white">
              {store.name[0]}
            </div>
          )}
          <span className="font-semibold text-gray-900">{store.name}</span>
        </Link>

        <div className="flex items-center gap-3">
          {store.whatsapp && (
            <a
              href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-xl bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 sm:flex"
            >
              <WhatsAppIcon />
              واتساب
            </a>
          )}

          <Link
            href={`/store/${country}/${subdomain}/cart`}
            className="relative flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            🛒 السلة
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[11px] font-bold text-white">
                {count}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  )
}

function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
