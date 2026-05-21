'use client'

import Link from 'next/link'

interface Category { id: string; name: string; slug: string }

interface Props {
  categories: Category[]
  activeSlug?: string
  subdomain: string
  country: string
}

export default function CategoryFilter({ categories, activeSlug, subdomain, country }: Props) {
  if (!categories.length) return null

  const base = `/store/${country}/${subdomain}`

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      <Link
        href={base}
        className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
          !activeSlug ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        الكل
      </Link>
      {categories.map(cat => (
        <Link
          key={cat.id}
          href={`${base}?category=${cat.slug}`}
          className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
            activeSlug === cat.slug
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {cat.name}
        </Link>
      ))}
    </div>
  )
}
