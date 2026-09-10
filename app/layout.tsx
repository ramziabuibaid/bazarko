import './globals.css'
import type { Metadata, Viewport } from 'next'
import NextTopLoader from 'nextjs-toploader'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0f172a',
}

export const metadata: Metadata = {
  title: 'Bazarko — منصة إدارة الأعمال والمتاجر الإلكترونية في فلسطين',
  description: 'منصة SaaS متكاملة للتجار والشركات في فلسطين — إدارة المبيعات، المحاسبة، المخزون، الشيكات، البنوك، ونقاط البيع والمتجر الإلكتروني من مكان واحد.',
  metadataBase: new URL('https://bazarko.app'),
  icons: {
    icon: '/images/bazarko-logo-mark.jpg',
    shortcut: '/images/bazarko-logo-mark.jpg',
    apple: '/images/bazarko-logo-mark.jpg',
  },
  openGraph: {
    title: 'Bazarko — منصة إدارة الأعمال والمتاجر الإلكترونية في فلسطين',
    description: 'نظام ERP وتجارة إلكترونية سحابي متكامل للأعمال في فلسطين',
    url: 'https://bazarko.app',
    siteName: 'Bazarko',
    locale: 'ar',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-slate-950 text-white antialiased overflow-x-hidden">
        <NextTopLoader color="#38bdf8" height={3} showSpinner={false} shadow={false} />
        {children}
      </body>
    </html>
  )
}
