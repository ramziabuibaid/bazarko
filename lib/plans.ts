export type PlanType = 'free' | 'basic' | 'pro'

export interface PlanFeature {
  name: string
  free: boolean | string
  pro: boolean | string
  description?: string
}

export const FREE_ALLOWED_ROUTES = [
  '/dashboard',
  '/dashboard/sales',
  '/dashboard/pos',
  '/dashboard/accounting/invoices',
  '/dashboard/invoices/returns',
  '/dashboard/orders/receipt',
  '/dashboard/purchases-hub',
  '/dashboard/purchases',
  '/dashboard/purchases/returns',
  '/dashboard/accounting/receipts',
  '/dashboard/accounting/payments',
  '/dashboard/customers',
  '/dashboard/suppliers',
  '/dashboard/inventory-hub',
  '/dashboard/products',
  '/dashboard/categories',
  '/dashboard/store-hub',
  '/dashboard/orders',
  '/dashboard/delivery',
  '/dashboard/settings',
  '/dashboard/accounting/shamel',
  '/dashboard/upgrade',
]

/**
 * Checks whether a given path is accessible on the store's current plan.
 */
export function isRouteAllowed(path: string, plan: string = 'free'): boolean {
  if (plan === 'pro' || plan === 'basic') return true

  // Check if root or explicitly allowed
  return FREE_ALLOWED_ROUTES.some(allowed => {
    if (allowed === '/dashboard') return path === '/dashboard'
    return path.startsWith(allowed)
  })
}

/**
 * Plan Comparison Matrix for the Upgrade Page
 */
export const PLAN_COMPARISON: PlanFeature[] = [
  {
    name: 'فواتير المبيعات ونقاط البيع (POS)',
    free: 'نعم',
    pro: 'نعم (غير محدود)',
    description: 'إنشاء وطباعة فواتير المبيعات، الفاتورة النقدية والآجلة، إيصال نقطة البيع'
  },
  {
    name: 'فواتير المشتريات وإدارة الموردين',
    free: 'نعم',
    pro: 'نعم (غير محدود)',
    description: 'تسجيل المشتريات، كشوف حسابات الموردين، ومردودات المشتريات'
  },
  {
    name: 'سندات القبض وسندات الصرف',
    free: 'نعم',
    pro: 'نعم',
    description: 'سندات القبض والصرف الرسمية مع التفقيط والطباعة'
  },
  {
    name: 'إدارة الزبائن وحسابات العملاء',
    free: 'نعم',
    pro: 'نعم',
    description: 'دليل الزبائن، الحدود الائتمانية، وكشوف الحسابات'
  },
  {
    name: 'المتجر الإلكتروني واستقبال الطلبات',
    free: 'نعم',
    pro: 'نعم (باسم نطاق مخصص)',
    description: 'عرض المنتجات، سلة الشراء، واستقبال طلبات الزبائن أونلاين'
  },
  {
    name: 'عروض الأسعار الرسمية (Quotations)',
    free: 'غير متاح',
    pro: 'نعم (تصميم رسمي وتفقيط)',
    description: 'إصدار عروض أسعار للشركات والجهات الرسمية مع التحويل المباشر إلى فواتير'
  },
  {
    name: 'محفظة الشيكات والأوراق المالية',
    free: 'غير متاح 🔒',
    pro: 'نعم (إدارة كاملة)',
    description: 'شيكات واردة، صادرة، تحصيل، تظهير، إرجاع، وإصدار وطباعة الشيكات'
  },
  {
    name: 'الحسابات البنكية ومطابقة الكشوفات',
    free: 'غير متاح 🔒',
    pro: 'نعم',
    description: 'إدارة الحسابات البنكية، تتبع الأرصدة بالعملات، ومطابقة الكشوفات'
  },
  {
    name: 'القيود اليومية وشجرة الحسابات العامة',
    free: 'غير متاح 🔒',
    pro: 'نعم (معيار دولي)',
    description: 'قيود محاسبية مزدوجة، دليل الحسابات الشامل، وميزان المراجعة'
  },
  {
    name: 'التقارير المالية المتقدمة والأرباح والخسائر',
    free: 'غير متاح 🔒',
    pro: 'نعم',
    description: 'قائمة الدخل، الأرباح الصافية، والتحليل المالي التفصيلي'
  },
  {
    name: 'الصيانة والورشة وإدارة الأجهزة',
    free: 'غير متاح 🔒',
    pro: 'نعم',
    description: 'استلام أجهزة، طباعة وصولات استلام، تتبع حالة الصيانة، ورسائل WhatsApp'
  },
  {
    name: 'استوديو حملات وإعلانات WhatsApp',
    free: 'غير متاح 🔒',
    pro: 'نعم',
    description: 'توليد بطاقات عروض ورسائل ترويجية بضغطة زر لمشاركتها مع الزبائن'
  },
  {
    name: 'مزامنة وربط المخزون التلقائي (Sync API)',
    free: 'غير متاح 🔒',
    pro: 'نعم',
    description: 'ربط الفروع، تصدير واستيراد المخزون، وربط الموردين معاً'
  },
  {
    name: 'النسخ الاحتياطي السحابي والدعم الفني المباشر',
    free: 'دعم أساسي',
    pro: 'دعم أولوية مخصص 24/7',
    description: 'فريق دعم تقني واستشارات محاسبية مخصصة من شركة المنار'
  },
]
