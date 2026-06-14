import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface WishlistItem {
  productId: string
  name: string
  price: number
  price_secondary: number | null
  thumbnail: string | null
  slug: string
}

interface WishlistState {
  items: WishlistItem[]
  toggle: (item: WishlistItem) => void
  remove: (productId: string) => void
  has: (productId: string) => boolean
  clear: () => void
  count: () => number
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],

      toggle: (item) => set(state => {
        const exists = state.items.some(i => i.productId === item.productId)
        return {
          items: exists
            ? state.items.filter(i => i.productId !== item.productId)
            : [...state.items, item],
        }
      }),

      remove: (productId) =>
        set(state => ({ items: state.items.filter(i => i.productId !== productId) })),

      has: (productId) => get().items.some(i => i.productId === productId),

      clear: () => set({ items: [] }),

      count: () => get().items.length,
    }),
    { name: 'bazarko-wishlist' }
  )
)
