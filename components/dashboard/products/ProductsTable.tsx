'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { uniqueSlug } from '@/lib/utils/slug'
import { trackAction } from '@/lib/activity/track'

import {productDirectory,productStock,type DirectoryProduct as Product} from '@/lib/products/directory'
import styles from '../accounting/invoices-list.module.css'

const STATUS_META: Record<string, { label: string; icon: string; badgeCls: string }> = {
  active:   { label: 'فعال',   icon: '✅', badgeCls: 'bg-emerald-500/10 text-emerald-400' },
  draft:    { label: 'مسودة',  icon: '✏️', badgeCls: 'bg-sky-500/10 text-sky-400'         },
  hidden:   { label: 'مخفي',   icon: '🙈', badgeCls: 'bg-amber-500/10 text-amber-400'     },
  archived: { label: 'مؤرشف',  icon: '📦', badgeCls: 'bg-slate-700 text-slate-400'        },
}

interface Props {
  products: Product[]
  categories: { id: string; name: string }[]
  storeId: string
  currencyCode: string
  filters: { brand_id?:string; q?: string; category?: string; status?: string; stock?:string; sort?: string; page?:string;size?:string }
  sales?:Record<string,number>;loadError?:boolean;categoryError?:boolean;salesError?:boolean;preview?:boolean
}

export default function ProductsTable({ products: initial, categories, storeId, currencyCode, filters, sales={},loadError=false,categoryError=false,salesError=false,preview=false }: Props) {
  const router = useRouter()
  const [products, setProducts] = useState(initial)
  const [search, setSearch]     = useState(filters.q ?? '')
  const [category, setCategory] = useState(filters.category ?? '')
  const [status, setStatus]     = useState(['low_stock','out_of_stock'].includes(filters.status||'')?'':filters.status ?? '')
  const [sort, setSort]         = useState(salesError && filters.sort==='best_selling'?'newest':filters.sort ?? 'newest')
  const [deleteId, setDeleteId]   = useState<string | null>(null)
  const [deleting, setDeleting]   = useState(false)
  const [duplicating, setDuplicating] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setProducts(initial)
  }, [initial])

  const [stock,setStock]=useState(filters.stock || (['low_stock','out_of_stock'].includes(filters.status||'')?filters.status:''))
  const [page,setPage]=useState(Number(filters.page)||1),[size,setSize]=useState(Number(filters.size)||5),[actionError,setActionError]=useState('')
  const view=productDirectory(products,{brand_id:filters.brand_id,q:search,category,status:['low_stock','out_of_stock'].includes(status)?'':status,stock,sort,page,size},sales)
  function reset(){setPage(1)}
  useEffect(()=>{const p=new URLSearchParams();if(filters.brand_id)p.set('brand_id',filters.brand_id);if(search)p.set('q',search);if(category)p.set('category',category);if(status&&!['low_stock','out_of_stock'].includes(status))p.set('status',status);if(stock)p.set('stock',stock);if(sort!=='newest')p.set('sort',sort);if(view.page>1)p.set('page',String(view.page));if(view.size!==5)p.set('size',String(view.size));window.history.replaceState(null,'',window.location.pathname+(p.size?'?'+p.toString():''))},[search,category,status,stock,sort,view.page,view.size])

  async function toggleActive(product: Product) {
    const next = product.status === 'active' ? 'hidden' : 'active'
    const supabase = createClient()
    if(preview)return;setActionError('');const {data:updated,error}=await supabase.from('products').update({ status: next,is_active:next==='active' }).eq('id', product.id).eq('store_id',storeId).select('id').maybeSingle();if(error||!updated){setActionError('تعذر تغيير ظهور المنتج');return}
    trackAction(storeId, {
      action: 'status_change', entityType: 'product',
      entityId: product.id, entityLabel: product.name,
      details: { from: product.status, to: next },
    })
    setProducts(ps => ps.map(p => p.id === product.id ? { ...p, status: next, is_active: next === 'active' } : p))
  }

  async function duplicateProduct(product: Product) {
    if(preview)return;setActionError('');setDuplicating(prev => ({ ...prev, [product.id]: true }))
    const supabase = createClient()

    const { data: full,error:fullError } = await supabase
      .from('products')
      .select('description, track_stock, allow_backorder, low_stock_alert, weight, dimensions, images, tags, metadata, barcode, cost_price, compare_price, category_id, video_url, secondary_price, secondary_currency_code')
      .eq('id', product.id)
      .eq('store_id',storeId)
      .single()

    if(fullError||!full){setDuplicating(prev=>({...prev,[product.id]:false}));setActionError('تعذر تحميل المنتج لنسخه');return}
    const { data: copy, error } = await supabase
      .from('products')
      .insert({
        store_id:       storeId,
        name:           `نسخة - ${product.name}`,
        slug:           uniqueSlug(product.name),
        price:          product.price,
        compare_price:  full?.compare_price ?? product.compare_price ?? null,
        cost_price:     full?.cost_price ?? product.cost_price ?? null,
        category_id:    full?.category_id ?? null,
        description:    full?.description ?? null,
        sku:            null,
        barcode:        null,
        stock_quantity: 0,
        track_stock:    full?.track_stock ?? true,
        allow_backorder: full?.allow_backorder ?? false,
        low_stock_alert: full?.low_stock_alert ?? 5,
        weight:         full?.weight ?? null,
        dimensions:     full?.dimensions ?? null,
        images:         full?.images ?? [],
        thumbnail_url:  product.thumbnail_url,
        tags:           full?.tags ?? [],
        status:         'draft',
        is_featured:    false,
        metadata:       full?.metadata ?? {},
        video_url:      full?.video_url ?? null,
        secondary_price: full?.secondary_price ?? null,
        secondary_currency_code: full?.secondary_currency_code ?? null,
      })
      .select('id')
      .single()

    setDuplicating(prev => { const n = { ...prev }; delete n[product.id]; return n })

    if(error)setActionError('تعذر نسخ المنتج');
    if (!error && copy) {
      trackAction(storeId, {
        action: 'create', entityType: 'product',
        entityId: copy.id, entityLabel: `نسخة - ${product.name}`,
        details: { duplicatedFrom: product.id },
      })
      router.push(`/dashboard/products/${copy.id}`)
    }
  }

  async function confirmDelete(id: string) {
    setDeleting(true)
    const supabase = createClient()
    const deleted = products.find(p => p.id === id)
    if(preview){setDeleting(false);return};setActionError('');const {data:removed,error}=await supabase.from('products').delete().eq('id', id).eq('store_id',storeId).select('id').maybeSingle();if(error||!removed){setActionError('تعذر حذف المنتج؛ قد يكون مرتبطاً بعمليات مسجلة.');setDeleting(false);return}
    trackAction(storeId, {
      action: 'delete', entityType: 'product',
      entityId: id, entityLabel: deleted?.name ?? null,
    })
    setProducts(ps => ps.filter(p => p.id !== id))
    setDeleteId(null)
    setDeleting(false)
  }

  function stockBadge(p:Product){const kind=productStock(p);return <span className={`rounded-full px-3 py-1 text-xs ${kind==='out_of_stock'?'bg-rose-500/15 text-rose-300':kind==='low_stock'?'bg-amber-500/15 text-amber-300':'bg-slate-800 text-slate-300'}`}>{kind==='untracked'?'غير متتبع':kind==='unknown'?'غير متاح':kind==='out_of_stock'?'نفد':`${p.stock_available} ${kind==='low_stock'?'متبقي':'متوفر'}`}</span>}
  return <div className={styles.page} dir="rtl">
    {filters.brand_id&&<p className="rounded-xl border border-sky-800 p-3 text-sky-300">القائمة مقيدة بالماركة المختارة · <Link href="/dashboard/products">عرض جميع الماركات</Link></p>}
    <div className={styles.stats}>{[{label:'إجمالي المنتجات',value:view.stats.total},{label:'فعال',value:view.stats.active},{label:'مخفي',value:view.stats.hidden},{label:'مسودة',value:view.stats.draft}].map(m=><section className={styles.stat} key={m.label}><div>{m.label}<strong>{loadError?'—':m.value}</strong></div></section>)}</div>
    <p className={styles.hint}>المؤشرات بحسب البحث والفئة قبل فلاتر الظهور والمخزون. إخفاء المنتج لا يغيّر كمية المخزون.</p>
    {(loadError||categoryError||salesError||actionError)&&<p role="alert" className={styles.error}>{loadError?'تعذر تحميل المنتجات؛ الأرقام غير متاحة. ':''}{categoryError?'تعذر تحميل الفئات. ':''}{salesError?'ترتيب الأكثر مبيعاً غير متاح. ':''}{actionError}</p>}
    <section className={styles.panel}><input aria-label="البحث في المنتجات" className="w-full rounded-xl border border-slate-600 bg-slate-900 p-3 mb-3" placeholder="ابحث باسم المنتج أو الكود أو الباركود…" value={search} onChange={e=>{setSearch(e.target.value);reset()}}/><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    <select aria-label="الفئة" className="rounded-xl border border-slate-600 bg-slate-900 p-3" disabled={categoryError} value={category} onChange={e=>{setCategory(e.target.value);reset()}}><option value="">كل الفئات</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <select aria-label="حالة الظهور" className="rounded-xl border border-slate-600 bg-slate-900 p-3" value={status} onChange={e=>{setStatus(e.target.value);reset()}}><option value="">كل حالات الظهور</option>{Object.entries(STATUS_META).map(([key,m])=><option key={key} value={key}>{m.label}</option>)}</select>
    <select aria-label="حالة المخزون" className="rounded-xl border border-slate-600 bg-slate-900 p-3" value={stock} onChange={e=>{setStock(e.target.value);reset()}}><option value="">كل حالات المخزون</option><option value="available">متوفر</option><option value="low_stock">منخفض</option><option value="out_of_stock">نفد</option><option value="untracked">غير متتبع</option><option value="unknown">غير متاح</option></select>
    <select aria-label="ترتيب المنتجات" className="rounded-xl border border-slate-600 bg-slate-900 p-3" value={sort} onChange={e=>{setSort(e.target.value);reset()}}><option value="newest">الأحدث أولاً</option><option value="oldest">الأقدم أولاً</option><option value="price_low">الأقل سعراً</option><option value="price_high">الأعلى سعراً</option><option disabled={salesError} value="best_selling">الأكثر مبيعاً</option></select></div><button className="mt-3 text-sky-400" onClick={()=>{setSearch('');setCategory('');setStatus('');setStock('');setSort('newest');reset()}}>مسح الفلاتر</button></section>
    <section className={styles.tableWrap}><table><thead><tr><th>المنتج</th><th>الفئة</th><th>سعر البيع</th><th>المخزون</th><th>الظهور بالمتجر</th><th>إجراءات</th></tr></thead><tbody>{!loadError&&view.visible.map(p=><tr key={p.id}><td><div className="flex items-center gap-3">{p.thumbnail_url?<img src={p.thumbnail_url} alt="" className="h-12 w-12 rounded-xl object-cover"/>:<span className="h-12 w-12 flex items-center justify-center rounded-xl bg-slate-800">▧</span>}<div><strong>{p.name}</strong><small dir="ltr">{p.sku||p.barcode||'بدون كود'}</small></div></div></td><td>{p.categories?.name||'غير مصنف'}</td><td dir="ltr"><strong>{Number(p.price).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} {currencyCode}</strong>{Number(p.compare_price)>Number(p.price)&&<small><s>{p.compare_price}</s></small>}</td><td>{stockBadge(p)}</td><td><span className={`rounded-full px-3 py-1 text-xs ${(STATUS_META[p.status]||STATUS_META.draft).badgeCls}`}>{(STATUS_META[p.status]||STATUS_META.draft).label}</span>{p.status==='active'&&!p.is_active&&<small>غير منشور فعلياً</small>}</td><td><div className={styles.rowActions}><Link href={`/dashboard/products/${p.id}`}>تعديل</Link><details><summary className="cursor-pointer">المزيد</summary><div className="flex gap-2 flex-wrap mt-2"><button disabled={preview||p.status==='archived'} onClick={()=>toggleActive(p)}>{p.status==='active'?'إخفاء':'تفعيل'}</button><button disabled={preview||!!duplicating[p.id]} onClick={()=>duplicateProduct(p)}>نسخ</button><button disabled={preview} onClick={()=>setDeleteId(p.id)}>حذف</button></div></details></div></td></tr>)}{(loadError||!view.filtered.length)&&<tr><td colSpan={6} className={styles.empty}>{loadError?'تعذر عرض المنتجات':products.length?'لا توجد منتجات تطابق الفلاتر':'لا توجد منتجات حتى الآن'}</td></tr>}</tbody></table></section>
    <footer className={styles.pagination}><label>لكل صفحة <select aria-label="عدد المنتجات لكل صفحة" value={view.size} onChange={e=>{setSize(Number(e.target.value));reset()}} className="bg-slate-900 border border-slate-600 rounded-lg p-2">{[5,10,25,50].map(n=><option key={n}>{n}</option>)}</select></label><span>{loadError?'—':`عرض ${view.filtered.length?(view.page-1)*view.size+1:0}–${Math.min(view.page*view.size,view.filtered.length)} من ${view.filtered.length}`}</span><div><button disabled={loadError||view.page===1} onClick={()=>setPage(view.page-1)}>السابق</button><span>{view.page} / {view.pages}</span><button disabled={loadError||view.page===view.pages} onClick={()=>setPage(view.page+1)}>التالي</button></div></footer>
    {deleteId&&<div role="dialog" aria-modal="true" aria-label="حذف المنتج" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="max-w-sm bg-slate-900 border border-slate-600 rounded-xl p-6"><h2 className="font-bold">حذف المنتج نهائياً؟</h2><p className="my-4 text-slate-400">لا يمكن التراجع عن هذا الإجراء. يمكنك إخفاء المنتج للاحتفاظ بسجله.</p><button className="rounded-lg bg-rose-600 p-3" disabled={deleting} onClick={()=>confirmDelete(deleteId)}>{deleting?'جاري الحذف…':'تأكيد الحذف'}</button><button className="p-3" onClick={()=>setDeleteId(null)}>إلغاء</button></div></div>}
  </div>
}
