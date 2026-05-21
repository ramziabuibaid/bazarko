// Generated-compatible type definitions for Bazarko
// To regenerate: npx supabase gen types typescript --project-id hncjwffgicesmlpuwegr > lib/supabase/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          phone: string | null
          country_code: string | null
          is_admin: boolean
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
          plan: 'free' | 'basic' | 'pro'
          plan_expires_at: string | null
          is_active: boolean
          suspended_at: string | null
          suspended_reason: string | null
          modules: Json
          settings: Json
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
          customer_name: string | null
          customer_phone: string | null
          customer_email: string | null
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
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          unit_price: number
          total_price: number
          created_at: string
        }
        Insert: {
          order_id: string
          product_name: string
          quantity: number
          unit_price: number
          total_price: number
          product_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['order_items']['Row']>
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
      customer_ledger: {
        Row: {
          id: string
          store_id: string
          customer_id: string
          type: 'invoice' | 'payment' | 'credit_note' | 'debit_note' | 'order'
          date: string
          description: string
          debit: number
          credit: number
          balance: number
          reference_id: string | null
          reference_type: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          store_id: string
          customer_id: string
          type: string
          date: string
          description: string
          debit: number
          credit: number
          balance: number
          reference_id?: string | null
          reference_type?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['customer_ledger']['Row']>
      }
      invoices: {
        Row: {
          id: string
          store_id: string
          invoice_number: string
          customer_id: string | null
          customer_name: string | null
          order_id: string | null
          issue_date: string
          due_date: string | null
          status: 'draft' | 'sent' | 'paid' | 'cancelled'
          subtotal: number
          discount_amount: number
          tax_amount: number
          total: number
          amount_paid: number
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          store_id: string
          invoice_number: string
          issue_date: string
          subtotal: number
          total: number
        } & Partial<Omit<Database['public']['Tables']['invoices']['Row'], 'id' | 'store_id' | 'invoice_number' | 'issue_date' | 'subtotal' | 'total' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Database['public']['Tables']['invoices']['Row'], 'id'>>
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          description: string
          quantity: number
          unit_price: number
          total: number
          created_at: string
        }
        Insert: {
          invoice_id: string
          description: string
          quantity: number
          unit_price: number
          total: number
        }
        Update: Partial<Database['public']['Tables']['invoice_items']['Row']>
      }
      vouchers: {
        Row: {
          id: string
          store_id: string
          voucher_number: string
          type: 'receipt' | 'payment'
          date: string
          amount: number
          account_id: string | null
          account_name: string | null
          customer_id: string | null
          description: string | null
          payment_method: string | null
          reference: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          store_id: string
          voucher_number: string
          type: 'receipt' | 'payment'
          date: string
          amount: number
        } & Partial<Omit<Database['public']['Tables']['vouchers']['Row'], 'id' | 'store_id' | 'voucher_number' | 'type' | 'date' | 'amount' | 'created_at'>>
        Update: Partial<Omit<Database['public']['Tables']['vouchers']['Row'], 'id'>>
      }
      inventory_movements: {
        Row: {
          id: string
          store_id: string
          product_id: string
          type: 'purchase' | 'sale' | 'adjustment' | 'return' | 'transfer'
          quantity: number
          unit_cost: number | null
          reference_id: string | null
          reference_type: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          store_id: string
          product_id: string
          type: string
          quantity: number
          unit_cost?: number | null
          reference_id?: string | null
          reference_type?: string | null
          notes?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['inventory_movements']['Row']>
      }
      repair_jobs: {
        Row: {
          id: string
          store_id: string
          job_number: string
          customer_name: string
          customer_phone: string | null
          device_type: string
          device_brand: string | null
          device_model: string | null
          device_condition: string | null
          reported_issue: string | null
          diagnosis: string | null
          work_done: string | null
          status: 'received' | 'diagnosing' | 'in_repair' | 'waiting_parts' | 'ready' | 'delivered' | 'cancelled'
          priority: 'normal' | 'urgent'
          estimated_cost: number | null
          final_cost: number | null
          deposit_paid: number | null
          invoice_id: string | null
          assigned_to: string | null
          received_at: string
          estimated_done: string | null
          delivered_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          store_id: string
          job_number: string
          customer_name: string
          device_type: string
        } & Partial<Omit<Database['public']['Tables']['repair_jobs']['Row'], 'id' | 'store_id' | 'job_number' | 'customer_name' | 'device_type' | 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Database['public']['Tables']['repair_jobs']['Row'], 'id'>>
      }
      repair_job_parts: {
        Row: {
          id: string
          job_id: string
          product_id: string | null
          name: string
          quantity: number
          unit_cost: number
          total_cost: number
          created_at: string
        }
        Insert: {
          job_id: string
          name: string
          quantity: number
          unit_cost: number
          total_cost: number
          product_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['repair_job_parts']['Row']>
      }
      repair_job_history: {
        Row: {
          id: string
          job_id: string
          status: string
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          job_id: string
          status: string
          notes?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['repair_job_history']['Row']>
      }
    }
    Views: {
      [_ in never]: never
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
      is_platform_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
