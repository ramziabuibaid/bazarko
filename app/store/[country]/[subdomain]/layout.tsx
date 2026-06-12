import { ThemeScript } from '@/components/store/StoreTheme'

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      {children}
    </>
  )
}
