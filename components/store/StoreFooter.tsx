import Link from 'next/link'

type DayKey = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri'
interface DayHours { open: boolean; from: string; to: string }
type BusinessHours = Partial<Record<DayKey, DayHours>>

interface FooterSettings {
  tagline?: string
  show_contact?: boolean
  show_social?: boolean
  show_hours?: boolean
  show_powered_by?: boolean
  copyright?: string
}

interface StoreData {
  name: string
  description?: string | null
  logo_url?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  city?: string | null
  address?: string | null
  instagram?: string | null
  facebook?: string | null
  tiktok?: string | null
  telegram?: string | null
  business_hours?: BusinessHours | null
  footer_settings?: FooterSettings | null
  country_code?: string
  subdomain?: string
}

interface Props {
  store: StoreData
  country: string
  subdomain: string
}

const DAY_LABELS: Record<DayKey, string> = {
  sat: 'السبت',
  sun: 'الأحد',
  mon: 'الاثنين',
  tue: 'الثلاثاء',
  wed: 'الأربعاء',
  thu: 'الخميس',
  fri: 'الجمعة',
}

const DAY_ORDER: DayKey[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'م' : 'ص'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export default function StoreFooter({ store, country, subdomain }: Props) {
  const fs: FooterSettings = store.footer_settings ?? {}
  const showContact = fs.show_contact !== false
  const showSocial  = fs.show_social  !== false
  const showHours   = fs.show_hours   !== false
  const showPowered = fs.show_powered_by !== false

  const tagline   = fs.tagline?.trim() || store.description?.trim() || ''
  const copyright = fs.copyright?.trim() || `© ${new Date().getFullYear()} ${store.name}`

  const socials = [
    store.instagram && { href: store.instagram, icon: InstagramIcon, label: 'Instagram' },
    store.facebook  && { href: store.facebook,  icon: FacebookIcon,  label: 'Facebook' },
    store.tiktok    && { href: store.tiktok,    icon: TikTokIcon,    label: 'TikTok' },
    store.telegram  && { href: store.telegram,  icon: TelegramIcon,  label: 'Telegram' },
  ].filter(Boolean) as { href: string; icon: React.FC<{ className?: string }>; label: string }[]

  const openDays = DAY_ORDER.filter(d => store.business_hours?.[d]?.open)

  // عدد الأعمدة النشطة
  const activeCols = [showContact, showSocial && socials.length > 0, showHours && openDays.length > 0].filter(Boolean).length

  return (
    <footer className="mt-16 border-t border-gray-900/10 bg-gray-950 text-gray-400" dir="rtl">
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-6">

        {/* ── القسم العلوي ── */}
        <div className={`grid gap-10 ${activeCols === 3 ? 'sm:grid-cols-4' : activeCols === 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>

          {/* عمود الهوية */}
          <div className="sm:col-span-1">
            <div className="flex items-center gap-3">
              {store.logo_url ? (
                <img src={store.logo_url} alt={store.name} className="h-10 w-10 rounded-xl object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800 text-lg">🏪</div>
              )}
              <span className="text-lg font-bold text-white">{store.name}</span>
            </div>
            {tagline && (
              <p className="mt-3 text-sm leading-relaxed text-gray-500">{tagline}</p>
            )}
            {showSocial && socials.length > 0 && (
              <div className="mt-5 flex gap-3">
                {socials.map(s => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 text-gray-400 transition hover:bg-gray-700 hover:text-white"
                  >
                    <s.icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* عمود التواصل */}
          {showContact && (
            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-300">تواصل معنا</h3>
              <ul className="space-y-3 text-sm">
                {store.whatsapp && (
                  <li>
                    <a
                      href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 transition hover:text-white"
                    >
                      <WhatsAppIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span dir="ltr">{store.whatsapp}</span>
                    </a>
                  </li>
                )}
                {store.phone && !store.whatsapp && (
                  <li>
                    <a href={`tel:${store.phone}`} className="flex items-center gap-2.5 transition hover:text-white">
                      <PhoneIcon className="h-4 w-4 shrink-0" />
                      <span dir="ltr">{store.phone}</span>
                    </a>
                  </li>
                )}
                {store.email && (
                  <li>
                    <a href={`mailto:${store.email}`} className="flex items-center gap-2.5 transition hover:text-white">
                      <EmailIcon className="h-4 w-4 shrink-0" />
                      <span dir="ltr">{store.email}</span>
                    </a>
                  </li>
                )}
                {store.city && (
                  <li className="flex items-start gap-2.5">
                    <LocationIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{store.city}{store.address ? ` — ${store.address}` : ''}</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* عمود ساعات العمل */}
          {showHours && openDays.length > 0 && (
            <div>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-300">ساعات العمل</h3>
              <ul className="space-y-2 text-sm">
                {openDays.map(d => {
                  const day = store.business_hours![d]!
                  return (
                    <li key={d} className="flex items-center justify-between gap-4">
                      <span className="text-gray-400">{DAY_LABELS[d]}</span>
                      <span className="text-gray-300 tabular-nums" dir="ltr">
                        {formatTime(day.from)} — {formatTime(day.to)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* عمود روابط سريعة */}
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-300">المتجر</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={`/store/${country}/${subdomain}`} className="transition hover:text-white">
                  الرئيسية
                </Link>
              </li>
              <li>
                <Link href={`/store/${country}/${subdomain}?q=`} className="transition hover:text-white">
                  جميع المنتجات
                </Link>
              </li>
              <li>
                <Link href={`/store/${country}/${subdomain}/cart`} className="transition hover:text-white">
                  سلة التسوق
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* ── الشريط السفلي ── */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-gray-800 pt-6 text-xs sm:flex-row">
          <p className="text-gray-600">{copyright}</p>
          {showPowered && (
            <a
              href="https://bazarko.app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-gray-800 bg-gray-900 px-3 py-1.5 text-gray-500 transition hover:border-sky-800 hover:text-sky-400"
            >
              <span className="text-sky-500">⚡</span>
              مدعوم من <span className="font-semibold text-sky-500">Bazarko</span>
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}

// ── أيقونات SVG مُدمجة ───────────────────────────────────────────────────────

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  )
}

function EmailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  )
}

function LocationIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.24 8.24 0 004.84 1.56V6.79a4.85 4.85 0 01-1.07-.1z"/>
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )
}
