// هذا الملف سيُولَّد تلقائياً من Supabase CLI لاحقاً
// npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/supabase/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      countries: {
        Row: {
          code: string
          name_ar: string
          name_en: string
          currency_code: string
          currency_symbol: string
          domain_prefix: string
          is_active: boolean
          launch_date: string | null
          settings: Json
        }
        Insert: Omit<Database['public']['Tables']['countries']['Row'], 'is_active' | 'settings'> & {
          is_active?: boolean
          settings?: Json
        }
        Update: Partial<Database['public']['Tables']['countries']['Row']>
      }
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          phone: string | null
          country_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: { id: string } & Partial<Omit<Database['public']['Tables']['profiles']['Row'], 'id'>>
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
      }
      stores: {
        Row: {
          id: string
          owner_id: string
          country_code: string
          name: string
          subdomain: string
          full_subdomain: string
          description: string | null
          logo_url: string | null
          cover_url: string | null
          phone: string | null
          whatsapp: string | null
          address: string | null
          city: string | null
          email: string | null
          currency_code: string
          tax_number: string | null
          tax_rate: number
          status: 'active' | 'suspended' | 'pending' | 'closed'
          plan: 'free' | 'pro' | 'business'
          plan_expires_at: string | null
          modules: Json
          settings: Json
          marketplace_status: 'none' | 'pending' | 'approved' | 'suspended'
          marketplace_joined_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          owner_id: string
          country_code: string
          name: string
          subdomain: string
          currency_code: string
        } & Partial<Omit<Database['public']['Tables']['stores']['Row'],
          'id' | 'owner_id' | 'country_code' | 'name' | 'subdomain' | 'currency_code' | 'full_subdomain' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Database['public']['Tables']['stores']['Row'], 'id' | 'full_subdomain'>>
      }
      store_members: {
        Row: {
          id: string
          store_id: string
          profile_id: string
          role: 'owner' | 'admin' | 'staff' | 'accountant' | 'viewer'
          is_active: boolean
          invited_at: string
          joined_at: string | null
          created_at: string
        }
        Insert: {
          store_id: string
          profile_id: string
          role?: 'owner' | 'admin' | 'staff' | 'accountant' | 'viewer'
        }
        Update: Partial<Database['public']['Tables']['store_members']['Row']>
      }
      categories: {
        Row: {
          id: string
          store_id: string
          name: string
          slug: string
          parent_id: string | null
          image_url: string | null
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: { store_id: string; name: string; slug: string } & Partial<Omit<Database['public']['Tables']['categories']['Row'], 'id' | 'store_id' | 'name' | 'slug' | 'created_at'>>
        Update: Partial<Database['public']['Tables']['categories']['Row']>
      }
      products: {
        Row: {
          id: string
          store_id: string
          category_id: string | null
          name: string
          slug: string
          description: string | null
          sku: string | null
          barcode: string | null
          price: number
          compare_price: number | null
          cost_price: number | null
          stock_quantity: number
          stock_reserved: number
          stock_available: number
          track_stock: boolean
          allow_backorder: boolean
          low_stock_alert: number
          weight: number | null
          dimensions: Json | null
          images: string[]
          thumbnail_url: string | null
          tags: string[]
          is_active: boolean
          is_featured: boolean
          sort_order: number
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          store_id: string
          name: string
          slug: string
          price: number
        } & Partial<Omit<Database['public']['Tables']['products']['Row'], 'id' | 'store_id' | 'name' | 'slug' | 'price' | 'stock_available' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Database['public']['Tables']['products']['Row'], 'id' | 'stock_available'>>
      }
      customers: {
        Row: {
          id: string
          store_id: string
          name: string
          phone: string | null
          phone_alt: string | null
          email: string | null
          address: string | null
          city: string | null
          national_id: string | null
          notes: string | null
          credit_limit: number
          balance: number
          total_orders: number
          total_invoiced: number
          total_paid: number
          last_order_at: string | null
          last_payment_at: string | null
          customer_type: 'retail' | 'wholesale' | 'vip'
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: { store_id: string; name: string } & Partial<Omit<Database['public']['Tables']['customers']['Row'], 'id' | 'store_id' | 'name' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Database['public']['Tables']['customers']['Row'], 'id'>>
      }
      orders: {
        Row: {
          id: string
          store_id: string
          customer_id: string | null
          order_number: string
          status: 'pending' | 'confirmed' | 'processing' | 'ready' | 'shipped' | 'delivered' | 'cancelled' | 'returned'
          payment_status: 'unpaid' | 'partial' | 'paid' | 'refunded'
          payment_method: 'cash' | 'bank_transfer' | 'check' | 'online' | 'credit' | null
          subtotal: number
          discount_type: 'fixed' | 'percentage' | null
          discount_value: number
          discount_amount: number
          shipping_amount: number
          tax_amount: number
          total_amount: number
          amount_paid: number
          amount_remaining: number
          delivery_company_id: string | null
          tracking_number: string | null
          shipping_address: string | null
          shipping_city: string | null
          expected_delivery: string | null
          source: 'store' | 'dashboard' | 'phone' | 'whatsapp' | 'marketplace'
          customer_notes: string | null
          internal_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          store_id: string
          order_number: string
          subtotal: number
          total_amount: number
        } & Partial<Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'store_id' | 'order_number' | 'subtotal' | 'total_amount' | 'amount_remaining' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'amount_remaining'>>
      }
    }
    Functions: {
      generate_sequence_number: {
        Args: { p_store_id: string; p_prefix: string }
        Returns: string
      }
      is_store_member: {
        Args: { p_store_id: string }
        Returns: boolean
      }
    }
  }
}
