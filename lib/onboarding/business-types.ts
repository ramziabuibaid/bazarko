export type BusinessType = 'home' | 'retail' | 'company'
export const ONBOARDING_DRAFT_KEY = 'bazarko.onboarding.v1'
export function isBusinessType(value: unknown): value is BusinessType {
  return value === 'home' || value === 'retail' || value === 'company'
}
export const BUSINESS_TYPES = [
  { id: 'home' as const, title: 'مشروع من البيت', description: 'منتجات، طلبات، مصاريف ومتجر إلكتروني', nameLabel: 'اسم مشروعك', placeholder: 'مثال: حلويات سارة', intro: 'بدايتك ستكون بسيطة', tools: ['منتجاتي', 'طلباتي', 'مصاريفي', 'متجري'], detail: 'جهّز اسم مشروعك ورابطه، ثم أضف أول منتج وشاركه مع زبائنك.' },
  { id: 'retail' as const, title: 'عندي محل', description: 'مبيعات، مخزون، زبائن ومتابعة التحصيل', nameLabel: 'اسم المحل', placeholder: 'مثال: محل المنار', intro: 'بداية تناسب حركة محلك', tools: ['المبيعات', 'المخزون', 'الزبائن', 'متجري'], detail: 'ابدأ بمنتجاتك ومبيعاتك، وتابع المخزون وحسابات الزبائن من مكان واحد.' },
  { id: 'company' as const, title: 'شركة أو محاسب', description: 'حسابات، تقارير وتنظيم أعمال الشركة', nameLabel: 'اسم الشركة أو المكتب', placeholder: 'مثال: شركة الأفق', intro: 'بداية لتنظيم أعمالك', tools: ['المبيعات', 'المشتريات', 'الحسابات', 'التقارير'], detail: 'أنشئ مساحة عمل لشركتك. توفر الأدوات المتقدمة يعتمد على خطتك وصلاحياتك.' },
]
export function initialStoreSettings(businessType: BusinessType) {
  return { order_notification_email: true, low_stock_alert: true, low_stock_threshold: 5, allow_backorder: false, show_stock_count: false,
    business_type: businessType, dashboard_mode: businessType === 'home' ? 'simple' : 'advanced', onboarding_version: 1 }
}
