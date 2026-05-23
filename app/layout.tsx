import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Bazarko — منصة التجارة الإلكترونية العربية',
  description: 'منصة SaaS متكاملة للتجار في فلسطين وسوريا — متجر إلكتروني، طلبيات، محاسبة، مخزون، وصيانة من مكان واحد.',
  metadataBase: new URL('https://bazarko.app'),
  openGraph: {
    title: 'Bazarko — منصة التجارة الإلكترونية العربية',
    description: 'أدِر متجرك بالكامل من مكان واحد',
    url: 'https://bazarko.app',
    siteName: 'Bazarko',
    locale: 'ar',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-slate-950 text-white antialiased">{children}</body>
    </html>
  )
}
