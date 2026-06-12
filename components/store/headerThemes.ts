// ثيمات هيدر المتجر — يختارها التاجر من الإعدادات
// ملاحظة: كل الـ classes مكتوبة نصياً كاملة حتى يلتقطها Tailwind
// (هذا الملف داخل components/ المشمول في tailwind.config content)

export interface HeaderTheme {
  id: string
  label: string
  description: string
  /** خلفية الهيدر نفسه */
  header: string
  /** اسم المتجر */
  name: string
  /** حلقة حول اللوغو */
  logoRing: string
  /** خلفية الحرف الأول عند غياب اللوغو */
  logoFallback: string
  /** زر السلة */
  cartBtn: string
  /** زر واتساب */
  whatsappBtn: string
  /** زر تبديل فاتح/داكن */
  toggleBtn: string
  /** لمعان متحرك يمر فوق الهيدر */
  shine: boolean
}

export const HEADER_THEMES: HeaderTheme[] = [
  {
    id: 'classic',
    label: 'كلاسيكي',
    description: 'أبيض نظيف مع اسم متدرج متحرك',
    header: 'border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95',
    name: 'bg-gradient-to-l from-sky-600 via-indigo-500 to-sky-600 bg-clip-text text-transparent animate-gradient-x font-bold dark:from-sky-400 dark:via-indigo-300 dark:to-sky-400',
    logoRing: 'ring-2 ring-sky-100 dark:ring-sky-500/30',
    logoFallback: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900',
    cartBtn: 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200',
    whatsappBtn: 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-500/15 dark:text-green-400 dark:hover:bg-green-500/25',
    toggleBtn: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-amber-300 dark:hover:bg-gray-700',
    shine: false,
  },
  {
    id: 'ocean',
    label: 'محيط',
    description: 'أزرق متموج هادئ',
    header: 'bg-gradient-to-l from-sky-600 via-blue-600 to-indigo-600 animate-gradient-x',
    name: 'text-white font-bold drop-shadow-sm',
    logoRing: 'ring-2 ring-white/40',
    logoFallback: 'bg-white text-sky-700',
    cartBtn: 'bg-white text-sky-700 hover:bg-sky-50',
    whatsappBtn: 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm',
    toggleBtn: 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm',
    shine: true,
  },
  {
    id: 'sunset',
    label: 'غروب',
    description: 'برتقالي ووردي دافئ',
    header: 'bg-gradient-to-l from-orange-500 via-rose-500 to-pink-600 animate-gradient-x',
    name: 'text-white font-bold drop-shadow-sm',
    logoRing: 'ring-2 ring-white/40',
    logoFallback: 'bg-white text-rose-600',
    cartBtn: 'bg-white text-rose-600 hover:bg-rose-50',
    whatsappBtn: 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm',
    toggleBtn: 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm',
    shine: true,
  },
  {
    id: 'emerald',
    label: 'زمرد',
    description: 'أخضر طبيعي منعش',
    header: 'bg-gradient-to-l from-emerald-600 via-teal-600 to-green-600 animate-gradient-x',
    name: 'text-white font-bold drop-shadow-sm',
    logoRing: 'ring-2 ring-white/40',
    logoFallback: 'bg-white text-emerald-700',
    cartBtn: 'bg-white text-emerald-700 hover:bg-emerald-50',
    whatsappBtn: 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm',
    toggleBtn: 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm',
    shine: true,
  },
  {
    id: 'royal',
    label: 'ملكي',
    description: 'بنفسجي فاخر مع اسم ذهبي',
    header: 'bg-gradient-to-l from-purple-950 via-fuchsia-900 to-indigo-950 animate-gradient-x',
    name: 'bg-gradient-to-l from-amber-300 via-yellow-200 to-amber-300 bg-clip-text text-transparent animate-gradient-x font-bold',
    logoRing: 'ring-2 ring-amber-300/50',
    logoFallback: 'bg-amber-300 text-purple-950',
    cartBtn: 'bg-amber-300 text-purple-950 hover:bg-amber-200',
    whatsappBtn: 'bg-white/10 text-amber-200 hover:bg-white/20 backdrop-blur-sm',
    toggleBtn: 'bg-white/10 text-amber-200 hover:bg-white/20 backdrop-blur-sm',
    shine: true,
  },
  {
    id: 'midnight',
    label: 'ليلي',
    description: 'داكن أنيق مع توهج سماوي',
    header: 'bg-gradient-to-l from-slate-950 via-slate-800 to-slate-950 animate-gradient-x border-b border-sky-500/20',
    name: 'bg-gradient-to-l from-sky-400 via-cyan-300 to-sky-400 bg-clip-text text-transparent animate-gradient-x font-bold',
    logoRing: 'ring-2 ring-sky-500/40',
    logoFallback: 'bg-sky-500 text-white',
    cartBtn: 'bg-sky-500 text-white hover:bg-sky-400',
    whatsappBtn: 'bg-white/10 text-sky-300 hover:bg-white/20 backdrop-blur-sm',
    toggleBtn: 'bg-white/10 text-sky-300 hover:bg-white/20 backdrop-blur-sm',
    shine: true,
  },
]

export const DEFAULT_HEADER_THEME = HEADER_THEMES[0]

export function getHeaderTheme(id?: string | null): HeaderTheme {
  return HEADER_THEMES.find(t => t.id === id) ?? DEFAULT_HEADER_THEME
}
