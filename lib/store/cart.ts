import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartItem {
  productId: string
  name: string
  price: number
  thumbnail: string | null
  quantity: number
  max: number | null // null = غير محدود
}

interface CartState {
  items: CartItem[]
  storeId: string | null
  lastAdded: CartItem | null
  addItem: (item: Omit<CartItem, 'quantity'>) => void
  removeItem: (productId: string) => void
  updateQty: (productId: string, qty: number) => void
  clearCart: () => void
  clearLastAdded: () => void
  total: () => number
  count: () => number
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      storeId: null,
      lastAdded: null,

      addItem: (item) => set(state => {
        const existing = state.items.find(i => i.productId === item.productId)
        const newItem = existing
          ? { ...existing, quantity: Math.min(existing.quantity + 1, existing.max ?? 999) }
          : { ...item, quantity: 1 }
        return {
          lastAdded: newItem,
          items: existing
            ? state.items.map(i => i.productId === item.productId ? newItem : i)
            : [...state.items, newItem],
        }
      }),

      clearLastAdded: () => set({ lastAdded: null }),

      removeItem: (productId) =>
        set(state => ({ items: state.items.filter(i => i.productId !== productId) })),

      updateQty: (productId, qty) =>
        set(state => ({
          items: qty <= 0
            ? state.items.filter(i => i.productId !== productId)
            : state.items.map(i =>
                i.productId === productId
                  ? { ...i, quantity: Math.min(qty, i.max ?? 999) }
                  : i
              ),
        })),

      clearCart: () => set({ items: [] }),

      total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    { name: 'bazarko-cart' }
  )
)
