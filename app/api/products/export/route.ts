import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'
import * as XLSX from 'xlsx'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const storeId = await getStoreForUser(supabase, user.id)
  if (!storeId) return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 })

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, currency_code')
    .eq('id', storeId)
    .single()
  if (!store) return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 })

  const { data: products, error } = await supabase
    .from('products')
    .select(`
      id, name, description, sku, barcode,
      price, compare_price, cost_price,
      stock_quantity, track_stock, low_stock_alert,
      status, is_featured, weight,
      categories(name)
    `)
    .eq('store_id', store.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'خطأ في جلب البيانات' }, { status: 500 })

  // بناء صفوف البيانات
  const rows = (products ?? []).map(p => ({
    'معرّف المنتج ⚠️ لا تعدّل': p.id,
    'اسم المنتج *': p.name,
    'الوصف': p.description ?? '',
    'الفئة': (p.categories as unknown as { name: string } | null)?.name ?? '',
    [`سعر البيع * (${store.currency_code})`]: p.price,
    'سعر المقارنة': p.compare_price ?? '',
    'سعر التكلفة': p.cost_price ?? '',
    'كود SKU': p.sku ?? '',
    'الباركود': p.barcode ?? '',
    'الكمية': p.stock_quantity,
    'تتبع المخزون (نعم/لا)': p.track_stock ? 'نعم' : 'لا',
    'تنبيه عند الكمية': p.low_stock_alert ?? '',
    'الحالة': p.status ?? 'active',
    'منتج مميز (نعم/لا)': p.is_featured ? 'نعم' : 'لا',
    'الوزن (كغ)': p.weight ?? '',
  }))

  const wb = XLSX.utils.book_new()

  // ورقة المنتجات
  const wsProducts = XLSX.utils.json_to_sheet(rows)
  wsProducts['!cols'] = [
    { wch: 40 }, // id
    { wch: 32 }, // name
    { wch: 45 }, // description
    { wch: 20 }, // category
    { wch: 16 }, // price
    { wch: 16 }, // compare
    { wch: 16 }, // cost
    { wch: 16 }, // sku
    { wch: 16 }, // barcode
    { wch: 10 }, // qty
    { wch: 20 }, // track
    { wch: 18 }, // alert
    { wch: 18 }, // status
    { wch: 22 }, // featured
    { wch: 14 }, // weight
  ]

  // ورقة التعليمات
  const instructions: (string | number)[][] = [
    ['📘 تعليمات استيراد وتصدير المنتجات'],
    [''],
    ['✏️  كيف أعدّل على منتج موجود؟'],
    ['   ← ابقِ قيمة "معرّف المنتج" كما هي، وعدّل أي حقل آخر تريده.'],
    [''],
    ['➕  كيف أضيف منتجاً جديداً؟'],
    ['   ← أضف صفاً جديداً في الأسفل، واترك خانة "معرّف المنتج" فارغة تماماً.'],
    ['   ← أدخل الاسم والسعر على الأقل.'],
    [''],
    ['📋  الحقول الإلزامية (*)'],
    ['   - اسم المنتج *'],
    ['   - سعر البيع *  (رقم موجب)'],
    [''],
    ['🔢  قيم مقبولة للحالة'],
    ['   active    →  فعال (يظهر في المتجر)'],
    ['   draft     →  مسودة (غير مرئي للزبائن)'],
    ['   hidden    →  مخفي'],
    ['   archived  →  أرشيف'],
    [''],
    ['⚠️  تحذيرات مهمة'],
    ['   - لا تعدّل ولا تحذف عمود "معرّف المنتج" — يُستخدم للتعرف على المنتجات الموجودة.'],
    ['   - لا تحذف أي عمود من الأعمدة.'],
    ['   - الأسعار والكميات يجب أن تكون أرقاماً صحيحة موجبة.'],
    ['   - النظام لا يحذف أي منتج من قاعدة البيانات عند الاستيراد.'],
    ['   - سيتم إبلاغك بأي خطأ في الصفوف قبل تطبيق أي تغيير.'],
    [''],
    ['💡  نصيحة'],
    ['   - صدّر الملف مجدداً بعد الاستيراد للتحقق من أن البيانات حُفظت بشكل صحيح.'],
  ]

  const wsInstr = XLSX.utils.aoa_to_sheet(instructions)
  wsInstr['!cols'] = [{ wch: 70 }]

  XLSX.utils.book_append_sheet(wb, wsProducts, 'المنتجات')
  XLSX.utils.book_append_sheet(wb, wsInstr, 'تعليمات')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const fileName = `products-${store.name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  })
}
