import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Bazarko | منصة إدارة الأعمال',
  description: 'منصة SaaS لإدارة المتاجر الإلكترونية والمحاسبة والمخزون في فلسطين وسوريا',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-slate-950 text-white antialiased">{children}</body>
    </html>
  )
}
