import {createClient} from '@/lib/supabase/server'
import {allRows} from '@/lib/dashboard/load-simple-dashboard'
import {type StatementProduct,type StockMovement} from './statement'
export async function loadStockStatement(supabase:ReturnType<typeof createClient>,storeId:string,userId:string,productId?:string,includeCost=true){
 const [{data:store},{data:member}]=await Promise.all([supabase.from('stores').select('id,name,currency_code,owner_id').eq('id',storeId).single(),supabase.from('store_members').select('role').eq('store_id',storeId).eq('profile_id',userId).eq('is_active',true).maybeSingle()]);if(!store)throw new Error('تعذر تحميل المتجر')
 const canViewCost=includeCost&&(store.owner_id===userId||['owner','admin'].includes(member?.role||''));let products:StatementProduct[]=[],movements:StockMovement[]=[],error=false
 try{products=await allRows<StatementProduct>((from,to)=>supabase.from('products').select(canViewCost?'id,name,sku,barcode,stock_quantity,price,cost_price,thumbnail_url,track_stock':'id,name,sku,barcode,stock_quantity,price,thumbnail_url,track_stock').eq('store_id',storeId).order('id').range(from,to))}catch{error=true}
 products.sort((a,b)=>a.name.localeCompare(b.name,'ar'));const product=products.find(p=>p.id===(productId||products[0]?.id))||null
 if(product)try{movements=await allRows<StockMovement>((from,to)=>supabase.from('inventory_movements').select(canViewCost?'id,movement_date,created_at,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after,unit_price':'id,movement_date,created_at,movement_type,document_number,document_type,ref_id,entity_name,quantity_in,quantity_out,balance_after').eq('store_id',storeId).eq('product_id',product.id).order('id').range(from,to))}catch{error=true}
 return {store,products,product,movements,error,canViewCost}
}
