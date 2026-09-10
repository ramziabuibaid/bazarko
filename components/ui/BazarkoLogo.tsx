import Link from 'next/link'
import Image from 'next/image'

interface BazarkoLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  subtitle?: string
  href?: string | null
  variant?: 'vector' | 'image'
  className?: string
  textClassName?: string
}

export default function BazarkoLogo({
  size = 'md',
  showText = true,
  subtitle,
  href = '/',
  variant = 'vector',
  className = '',
  textClassName = '',
}: BazarkoLogoProps) {
  // الأبعاد حسب الحجم
  const dimensions = {
    xs: { icon: 22, text: 'text-sm', sub: 'text-[9px]', gap: 'gap-1.5' },
    sm: { icon: 28, text: 'text-base', sub: 'text-[10px]', gap: 'gap-2' },
    md: { icon: 36, text: 'text-xl', sub: 'text-[11px]', gap: 'gap-2.5' },
    lg: { icon: 44, text: 'text-2xl', sub: 'text-xs', gap: 'gap-3' },
    xl: { icon: 56, text: 'text-3xl', sub: 'text-sm', gap: 'gap-3.5' },
  }[size]

  const iconElement = variant === 'image' ? (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl shadow-lg ring-1 ring-sky-500/30"
      style={{ width: dimensions.icon, height: dimensions.icon }}
    >
      <Image
        src="/images/bazarko-logo-mark.jpg"
        alt="Bazarko Logo"
        fill
        className="object-cover"
        sizes={`${dimensions.icon}px`}
      />
    </div>
  ) : (
    <div
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: dimensions.icon, height: dimensions.icon }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-[0_2px_10px_rgba(56,189,248,0.35)]"
      >
        <defs>
          <linearGradient id="bzk-grad-blue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>
          <linearGradient id="bzk-grad-arrow" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="60%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="bzk-grad-emerald" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <filter id="bzk-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* خلفية الأيقونة مستديرة الحواف */}
        <rect width="100" height="100" rx="24" fill="#090d16" />
        <rect width="100" height="100" rx="24" stroke="rgba(56,189,248,0.25)" strokeWidth="2" />

        {/* مكعبات الموديولار المعيارية (Modular Blocks على العمود الأيسر) */}
        <rect x="22" y="24" width="16" height="16" rx="4" fill="url(#bzk-grad-blue)" />
        <rect x="22" y="44" width="16" height="16" rx="4" fill="url(#bzk-grad-blue)" />
        <rect x="22" y="64" width="16" height="16" rx="4" fill="url(#bzk-grad-emerald)" />

        {/* نقاط الربط بين الموديولات */}
        <line x1="30" y1="40" x2="30" y2="44" stroke="#38bdf8" strokeWidth="3" />
        <line x1="30" y1="60" x2="30" y2="64" stroke="#06b6d4" strokeWidth="3" />

        {/* انحناءات حرف الـ B مع المنظومة السحابية */}
        {/* القوس العلوي */}
        <path
          d="M38 24 H58 C68 24 74 30 74 38 C74 46 68 50 56 50 H38"
          stroke="url(#bzk-grad-blue)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* القوس السفلي */}
        <path
          d="M38 50 H62 C73 50 80 57 80 66 C80 75 72 82 58 82 H38"
          stroke="url(#bzk-grad-emerald)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* سهم النمو الصاعد (Growth Arrow) الممتد عبر الحرف */}
        <path
          d="M26 78 L46 54 L58 64 L78 30"
          stroke="url(#bzk-grad-arrow)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#bzk-glow)"
        />
        {/* رأس السهم */}
        <path
          d="M66 28 H82 V44"
          stroke="#38bdf8"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )

  const content = (
    <div className={`inline-flex items-center ${dimensions.gap} ${className}`}>
      {iconElement}
      {showText && (
        <div className="flex flex-col leading-tight text-right">
          <span
            className={`font-black tracking-tight text-white font-sans ${dimensions.text} ${textClassName}`}
          >
            Bazarko
          </span>
          {subtitle && (
            <span className={`text-slate-400 font-medium ${dimensions.sub}`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="inline-flex no-underline group">
        {content}
      </Link>
    )
  }

  return content
}
