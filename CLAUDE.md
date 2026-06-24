# Bazarko — دليل المشروع لـ Claude

> هذا الملف يُقرأ تلقائياً في كل جلسة. هو المرجع الوحيد — لا تحتاج لأي ملف آخر.
> **آخر تحديث:** مايو 2026 | **Build:** 37 route، يعمل بدون أخطاء

---

## ما هو هذا المشروع؟

**Bazarko** — منصة SaaS لإدارة الأعمال التجارية في الدول العربية (فلسطين وسوريا أولاً).
كل تاجر يحصل على: متجر إلكتروني + طلبيات + محاسبة + مخزون + زبائن وذمم + نظام صيانة.

---

## ⚖️ قواعد ثابتة (الدستور) — لا تُكسر أبداً

1. **كل الأرقام في التطبيق أرقام إنجليزية (لاتينية) `0123456789` — وليست عربية-هندية `٠١٢٣`. الآن وفي كل ميزة مستقبلية.**
   - عند تنسيق أي رقم أو تاريخ استخدم اللوكال **`'ar-u-nu-latn'`** — يحافظ على أسماء الأشهر العربية (يونيو، الخ) مع أرقام لاتينية وفاصلة آلاف لاتينية.
   - **ممنوع** استخدام `'ar'` أو `'ar-SA'` في `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` — لأنها تُنتج أرقاماً عربية-هندية.
   - مثال صحيح: `n.toLocaleString('ar-u-nu-latn')` و `new Date(d).toLocaleDateString('ar-u-nu-latn', { month: 'long', day: 'numeric' })`.

---

## Stack التقني

| الأداة | الاستخدام |
|---|---|
| Next.js 14 App Router | Framework |
| TypeScript | اللغة |
| Tailwind CSS | التصميم |
| Supabase | Database + Auth + Storage |
| `@supabase/ssr` | إدارة الـ cookies في App Router |
| Zustand + persist | سلة التسوق (localStorage) |
| Resend | إرسال الإيميل |
| `@/*` → `./` | TypeScript path alias في tsconfig.json |

---

## متغيرات البيئة (.env.local)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://hncjwffgicesmlpuwegr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # سري — لا يُستخدم في client components أبداً
NEXT_PUBLIC_DOMAIN=bazarko.com
RESEND_API_KEY=...              # اختياري — بدونه الإيميل يُتجاهل بهدوء
```

---

## بنية المجلدات الكاملة

```
app/
├── login/page.tsx
├── auth/callback/route.ts
├── onboarding/page.tsx                        ← wizard 3 خطوات: بلد، اسم، subdomain
│
├── dashboard/
│   ├── layout.tsx                             ← auth guard + sidebar
│   ├── page.tsx                               ← إحصائيات عامة
│   ├── settings/page.tsx
│   │
│   ├── categories/page.tsx
│   │
│   ├── products/
│   │   ├── page.tsx
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx
│   │
│   ├── orders/
│   │   ├── page.tsx                           ← قائمة + تبويبات + بحث + pagination
│   │   ├── new/page.tsx                       ← POS + ذمة (NewOrderForm)
│   │   └── [id]/page.tsx                      ← تفاصيل + زر "إنشاء فاتورة"
│   │
│   ├── offers/
│   │   ├── page.tsx                           ← قائمة العروض + إحصائيات (جارٍ/مجدول/منتهي)
│   │   ├── new/page.tsx                       ← إنشاء عرض + بوابة الخطط (free = عرض واحد)
│   │   └── [id]/
│   │       ├── page.tsx                       ← تعديل + تحليلات (مشاهدات/مبيعات/إيراد) + مشاركة
│   │       └── actions.ts                     ← sendOfferToCustomers (إيميل لكل الزبائن)
│   │
│   ├── accounting/
│   │   ├── page.tsx                           ← نظرة مالية عامة
│   │   ├── invoices/
│   │   │   ├── page.tsx                       ← قائمة + stat cards + تبويبات
│   │   │   ├── new/page.tsx                   ← يقبل ?from_order=ID للتعبئة التلقائية
│   │   │   └── [id]/page.tsx                  ← عرض + طباعة + رابط للطلبية المرتبطة
│   │   ├── receipts/page.tsx
│   │   ├── payments/page.tsx
│   │   └── reports/page.tsx                   ← تقارير P&L + Cash Flow + مصاريف
│   │
│   ├── customers/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx                      ← ملف زبون + كشف حساب
│   │
│   ├── inventory/
│   │   ├── page.tsx
│   │   ├── movements/page.tsx
│   │   ├── alerts/page.tsx
│   │   └── reports/page.tsx                   ← تقارير: الأكثر مبيعاً + راكدة + قيمة بالفئة + رسم بياني
│   │
│   └── maintenance/
│       ├── page.tsx                           ← Kanban board + إحصائيات
│       ├── new/page.tsx                       ← استلام جهاز جديد
│       └── [id]/page.tsx                      ← تفاصيل الطلب + وصل استلام
│
├── admin/                                         ← لوحة مالك النظام (is_admin فقط)
│   ├── layout.tsx                             ← guard: is_admin + sidebar خاص
│   ├── page.tsx                               ← Overview: إحصائيات المنصة + آخر متاجر
│   ├── stores/
│   │   ├── page.tsx                           ← قائمة كل المتاجر + فلاتر (حالة/خطة/بلد)
│   │   └── [id]/
│   │       ├── page.tsx                       ← تفاصيل متجر: إحصائيات + بيانات المالك
│   │       ├── StoreActions.tsx               ← تعليق/تفعيل + تغيير الخطة (Server Actions)
│   │       └── actions.ts                     ← suspendStore / activateStore / updateStorePlan
│   └── plans/page.tsx                         ← خطط الاشتراك + اشتراكات منتهية قريباً
│
├── api/
│   └── orders/create/route.ts                 ← POST: POS/ذمة + ledger + إيميل
│
├── marketplace/[country]/
│   ├── layout.tsx                             ← هيدر ثابت + شريط بحث + navbar
│   ├── page.tsx                               ← الرئيسية: Hero + منتجات مميزة + أحدث المنتجات + المتاجر
│   ├── search/page.tsx                        ← بحث عبر كل المتاجر + فلاتر السعر والمتجر
│   └── stores/page.tsx                        ← دليل المتاجر الكامل + عدد المنتجات لكل متجر
│
└── store/[country]/[subdomain]/
    ├── page.tsx                               ← Storefront (+ قسم العروض الحصرية)
    ├── product/[slug]/page.tsx
    ├── cart/page.tsx
    ├── checkout/page.tsx
    ├── order/[id]/page.tsx                    ← تتبع الطلبية (بدون auth)
    ├── offer/[id]/page.tsx                    ← صفحة العرض الحصري (بدون auth) + عداد تنازلي
    └── repair/[job_number]/page.tsx           ← تتبع الصيانة (بدون auth)

components/
├── dashboard/
│   ├── Sidebar.tsx                            ← يحتوي روابط الصيانة دائماً
│   ├── categories/CategoryManager.tsx
│   ├── products/ProductsTable.tsx + ProductForm.tsx
│   ├── orders/
│   │   ├── OrdersTable.tsx
│   │   ├── OrderDetail.tsx
│   │   └── NewOrderForm.tsx
│   ├── accounting/
│   │   ├── NewInvoiceForm.tsx                 ← يقبل prop prefill من طلبية
│   │   ├── InvoiceView.tsx                    ← يعرض رابط الطلبية المرتبطة
│   │   ├── VouchersTable.tsx
│   │   └── ReportsPeriodFilter.tsx            ← client component لفلتر التاريخ
│   ├── offers/
│   │   ├── OfferForm.tsx                      ← إنشاء/تعديل عرض: فترة + منتجات + أسعار + خصم جماعي + فئات + كميات
│   │   └── OfferShareActions.tsx              ← إرسال إيميل للزبائن + مشاركة واتساب + نسخ رابط
│   └── maintenance/
│       ├── RepairIntakeForm.tsx               ← نموذج استلام الجهاز
│       ├── RepairKanban.tsx                   ← لوحة Kanban بـ 5 أعمدة
│       └── RepairJobDetail.tsx                ← إدارة الطلب الكامل
└── store/
    ├── StoreHeader.tsx                        ← يطبّق ثيم الهيدر المختار (header_theme)
    ├── headerThemes.ts                        ← 6 ثيمات هيدر (classes كاملة ليلتقطها Tailwind)
    ├── ProductCard.tsx
    ├── CategoryFilter.tsx
    ├── OfferCountdown.tsx                     ← عداد تنازلي client (sm/lg، onDark)
    └── AddToCartButton.tsx

lib/
├── supabase/client.ts + server.ts
├── supabase/storage.ts                        ← uploadProductImage / deleteProductImage
├── store/cart.ts                              ← Zustand persist، key: bazarko-cart
├── email/order-email.ts                       ← sendOrderEmail() بـ Resend
├── email/offer-email.ts                       ← sendOfferEmail() — قالب عرض حصري بجدول الأسعار
└── utils/slug.ts                              ← Arabic → Latin transliteration

db/
├── schema.sql                                 ← Schema كامل — يُشغَّل مرة واحدة
└── migrations/
    ├── 001_fix_trigger_security.sql           ✅ مطبّق
    ├── 002_orders_customer_fields.sql         ✅ مطبّق
    ├── 003_customer_email.sql                 ✅ مطبّق
    ├── 004_invoices_vouchers.sql              ✅ مطبّق
    ├── 005_repair_jobs.sql                    ✅ مطبّق
    ├── 006_admin_panel.sql                    ✅ مطبّق
    ├── 007_public_store_access.sql            ✅ مطبّق
    ├── 008_delivery_zones.sql                 ✅ مطبّق
    ├── 009_store_social_hours.sql             ✅ مطبّق
    ├── 010_repair_photos.sql                  ✅ مطبّق
    ├── 011_video_and_secondary_currency.sql   ✅ مطبّق
    ├── 012_offers.sql                         ⚠️ يجب تطبيقه في Supabase SQL Editor
    ├── 013_offers_extras.sql                  ⚠️ يجب تطبيقه في Supabase SQL Editor (بعد 012)
    ├── 014_header_theme.sql                   ⚠️ يجب تطبيقه في Supabase SQL Editor
    ├── 015_product_status.sql                 ⚠️ يجب تطبيقه في Supabase SQL Editor
    ├── 016_price_secondary_prefer.sql         ⚠️ يجب تطبيقه في Supabase SQL Editor
    ├── 022_treasury.sql                       ⚠️ يجب تطبيقه — الصندوق + حركات + جلسات إغلاق + trigger السندات
    ├── 023_audit_invoices.sql                 ⚠️ يجب تطبيقه — سجل العمليات + حالة فاتورة partial + paid_at
    └── 024_support_tickets.sql                ⚠️ يجب تطبيقه — تذاكر دعم الزبائن + محادثة
    └── 025_staff_activity.sql                 ⚠️ يجب تطبيقه — تتبّع نشاط الموظفين (وقت فعلي + تحركات + لصق) + RPC
    └── 026_ticket_rating.sql                  ⚠️ يجب تطبيقه — تقييم خدمة الدعم (نجوم 1..5 + ملاحظة) على support_tickets
    └── 027_product_reviews.sql                ⚠️ يجب تطبيقه — تقييمات المنتجات (نجوم+تعليق+صور+مراجعة) + bucket review-photos العام
```

### تتبّع نشاط الموظفين (migration 025)
لمراقبة موظف يعمل على المتجر عن بُعد: **كم وقتاً قضى فعلاً + كل ما فعله بدقة**.
- جدول `staff_activity` يلتقط: `session_start/heartbeat/session_end` (لحساب الوقت النشط)، `page_view` (التنقّل)، `action` (إنشاء/تعديل/حذف/تغيير حالة مع diff)، `paste` (لصق نص طويل — مؤشر AI/نسخ). + أعمدة الجهاز/الشبكة: `ip_address, user_agent, browser, os, device_type, screen, viewport, language, timezone`.
- RPC `log_staff_activity(...)` بـ `SECURITY DEFINER` — يملأ actor تلقائياً ويتحقق من العضوية. GRANT لـ authenticated.
- **الـ IP ومعلومات الجهاز تُلتقط خادمياً**: التتبّع يمرّ عبر `app/api/activity/route.ts` (POST) الذي يقرأ `x-forwarded-for` ويشتقّ المتصفح/النظام من User-Agent ثم يستدعي الـ RPC. (لا يمكن أخذ IP الحقيقي من RPC مباشر لأن الاتصال يمرّ عبر pooler.)
- `lib/activity/track.ts` — `trackActivity` / `trackAction` / `diffFields` (client). يرسل عبر `fetch keepalive` (أو `sendBeacon` لـ session_end) مع معلومات المتصفح (شاشة/نافذة/لغة/منطقة زمنية). يُستدعى بعد نجاح كل كتابة Supabase.
- `components/dashboard/StaffActivityTracker.tsx` — مركّب في `DashboardShell`: بداية جلسة مرة واحدة، نبضة كل 30ث (تتوقف عند الخمول >60ث أو إخفاء التبويب)، page_view عند كل تغيّر مسار، كشف اللصق >40 حرف.
- الكتابات المرصودة: المنتجات (نموذج + جدول)، الفئات، العروض، الإعدادات، حالة الطلبية، الصيانة. (المالية يغطّيها `financial_audit_log` المنفصل.)
- **التقرير**: `/admin/stores/[id]/activity` (super admin) — بطاقة لكل موظف (وقت نشط، جلسات، عدد العمليات، تصفّح، نسبة لصق، أعمدة وقت يومي، **عناوين IP المستخدمة + الأجهزة + المنطقة الزمنية**) + تايملاين موحّد (مع IP والجهاز لكل حدث) يدمج `staff_activity` + `financial_audit_log`. رابط من صفحة تفاصيل المتجر.

---

## قاعدة البيانات — الجداول والقواعد

### RLS
- كل الجداول محمية بـ RLS
- `is_store_member(store_id)` تُستخدم في جميع الـ policies
- `orders`: INSERT مفتوح للجميع، SELECT/UPDATE للتاجر فقط
- `repair_jobs`: SELECT مفتوح للجميع (تتبع الزبون)، بقية العمليات للتاجر

### Triggers
```sql
handle_new_user()   -- ينشئ profile عند تسجيل مستخدم جديد
handle_new_store()  -- SECURITY DEFINER: ينشئ store_member (owner) + حسابات افتراضية
```
**تحذير:** `handle_new_store` يجب أن يبقى `SECURITY DEFINER` — بدونه يفشل إنشاء المتجر.

### Migrations المطبّقة
```
001 — SECURITY DEFINER لـ handle_new_store                                          ✅
002 — customer_name + customer_phone في orders                                      ✅
003 — customer_email في orders                                                      ✅
004 — invoices + invoice_items + vouchers + RLS                                     ✅
005 — repair_jobs + repair_job_parts + repair_job_history + RLS                    ✅
006 — is_admin في profiles + is_active/plan/suspended في stores + is_platform_admin() ✅
007-011 — public read + delivery_zones + social/hours + repair photos + video/عملة ثانية ✅
012 — offers + offer_items + RLS (التاجر إدارة كاملة، الزبون قراءة فقط)            ⚠️ طبّقه
013 — per_customer_limit/view_count + max/sold_quantity + RPC views/sales           ⚠️ طبّقه
014 — header_theme في stores (classic/ocean/sunset/emerald/royal/midnight)          ⚠️ طبّقه
015 — status في products (active/draft/hidden/archived) + is_active محسوب            ⚠️ طبّقه
016 — price_secondary في products + prefer_secondary في stores                       ⚠️ طبّقه
```

### Storage (product-images bucket — PUBLIC)
```sql
CREATE POLICY "authenticated can upload product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "public can read product images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'product-images');

CREATE POLICY "authenticated can delete product images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images');
```

---

## نظام الطلبيات — الأنواع الثلاثة

| النوع | source | status أولي | payment_status | الذمة |
|---|---|---|---|---|
| POS (كاشير) | `dashboard` | `delivered` | `paid` | لا |
| ذمة زبون | `dashboard` | `pending` | حسب الدفع | نعم إذا متبقٍ |
| أونلاين | `store` | `pending` | `unpaid` | لا |

**API Route:** `POST /api/orders/create`
- mode=`pos` → status=delivered, paid
- mode=`account` + customerId → يُضيف لـ customer_ledger + يُحدّث customers.balance
- يُرسل إيميل عبر Resend إذا وُجد عنوان

**حالات الطلبية:**
```
pending → confirmed → processing → ready → shipped → delivered
                                                    ↘ cancelled
```

---

## وحدة المحاسبة

### الجداول
- `invoices` + `invoice_items` — الفواتير
- `vouchers` — سندات القبض والصرف في جدول موحد (`type: 'receipt' | 'payment'`)

### الفواتير
- رقم تلقائي: `INV-XXXX` (count-based)
- حالات: `draft → sent → paid` (+ `cancelled`)
- حقل `order_id` — يربط الفاتورة بطلبية

### ربط الفاتورة بالطلبية
- في `orders/[id]`: زر "📋 إنشاء فاتورة" → يفتح `/accounting/invoices/new?from_order=ORDER_ID`
- بعد إنشاء الفاتورة: الزر يتحول لـ "📋 INV-XXXX" رابط مباشر
- `NewInvoiceForm` يقبل prop `prefill` يملأ الزبون والبنود تلقائياً ويحفظ `order_id`
- في `invoices/[id]`: رابط 🔗 للطلبية الأصلية في الشريط العلوي

### التقارير المالية (`/dashboard/accounting/reports`)
- فلتر الفترة: هذا الشهر / هذا الربع / هذه السنة / مخصص (via URL params)
- **P&L**: إيرادات الطلبيات + سندات قبض − سندات صرف = صافي الربح + هامش %
- **Cash Flow**: رسم بياني أعمدة لآخر 6 أشهر (مقبوضات vs مدفوعات)
- **توزيع المصاريف**: كل تصنيف بشريط تقدم ونسبة
- **ملخص الطلبيات**: عدد، مكتملة، قيد التنفيذ، متوسط القيمة

---

## وحدة الصيانة

### الجداول (migration 005)
```sql
repair_jobs          -- طلب الصيانة الرئيسي
repair_job_parts     -- قطع الغيار المستخدمة
repair_job_history   -- Audit Trail لكل تغيير حالة
```

### حقول repair_jobs
| الحقل | الوصف |
|---|---|
| job_number | `REP-XXXX` تلقائي (count-based) |
| device_type | phone/laptop/tablet/tv/printer/camera/appliance/other |
| status | received/diagnosing/in_repair/waiting_parts/ready/delivered/cancelled |
| priority | normal/urgent |
| estimated_cost / final_cost / deposit_paid | المالية |
| received_at / estimated_done / delivered_at | التواريخ |
| assigned_to | اسم الفني (text بسيط) |
| invoice_id | ربط بالفاتورة عند الإنشاء |

### تدفق الحالة
```
received → diagnosing → in_repair → ready → delivered
                           ↕
                     waiting_parts     (زر منفصل من in_repair)
```

### الصفحات
- `/dashboard/maintenance` — Kanban بـ 5 أعمدة + بحث + إحصائيات (نشط، عاجل، سُلِّم، إيرادات)
- `/dashboard/maintenance/new` — نموذج استلام: نوع جهاز (8 أنواع بأيقونات)، ماركة، موديل، حالة الاستلام، العطل، أولوية، فني، عربون
- `/dashboard/maintenance/[id]` — تفاصيل كاملة: تشخيص، عمل منجز، قطع غيار (بحث في المخزون)، ملخص مالي، سجل حالات (timeline)، زر إنشاء فاتورة، **وصل استلام قابل للطباعة** مع خانتي توقيع
- `/store/[country]/[subdomain]/repair/[job_number]` — تتبع عام للزبون (بدون auth): حالة، شريط تقدم، معلومات الجهاز، رابط واتساب

### RLS الصيانة
- الموظف: صلاحية كاملة عبر `is_store_member`
- الزبون: `SELECT` مفتوح لكل الجداول — لتتبع الجهاز بدون login

---

## لوحة مالك النظام (Super Admin)

### الحماية
- حقل `is_admin boolean DEFAULT false` في جدول `profiles`
- `is_platform_admin()` — دالة `SECURITY DEFINER` تُعيد قيمة `is_admin` لأي مستخدم
- Layout يتحقق من `is_admin` ويُعيد توجيه لـ `/dashboard` إن لم يكن المستخدم admin

### الحقول الجديدة في stores (migration 006)
| الحقل | الوصف |
|---|---|
| `is_active` | `boolean DEFAULT true` — تفعيل/تعطيل المتجر |
| `suspended_at` | تاريخ التعليق |
| `suspended_reason` | سبب التعليق |
| `plan` | `free / basic / pro` |
| `plan_expires_at` | تاريخ انتهاء الاشتراك |

### الصفحات
- `/admin` — Overview: إحصائيات المنصة (GMV، متاجر، طلبيات، صيانة) + آخر 8 متاجر
- `/admin/stores` — قائمة كل المتاجر + فلاتر (حالة/خطة/بلد) باستخدام URL params
- `/admin/stores/[id]` — تفاصيل متجر: إحصائيات (منتجات/طلبيات/زبائن/إيرادات) + بيانات المالك + رابط المتجر
- `/admin/plans` — عرض الخطط الثلاث + اشتراكات تنتهي خلال 14 يوم + قائمة متاجر لكل خطة

### الإجراءات (Server Actions)
```typescript
// app/admin/stores/[id]/actions.ts
suspendStore(storeId, reason)    // تعليق مع سبب + تاريخ
activateStore(storeId)           // إعادة تفعيل + مسح سبب التعليق
updateStorePlan(storeId, plan, expiresAt)  // تغيير الخطة + تاريخ الانتهاء
```
كل action تتحقق من `is_admin` أولاً قبل التنفيذ.

---

## العروض الحصرية (Flash Sales)

### الجداول (migrations 012 + 013)
```sql
offers       -- store_id, title, description, banner_url, starts_at, ends_at, is_active,
             -- per_customer_limit (حد لكل زبون)، view_count (مشاهدات)
offer_items  -- offer_id, product_id, offer_price, max_quantity (كمية محدودة للعرض)،
             -- sold_quantity (UNIQUE per offer+product)

-- RPC functions (SECURITY DEFINER، GRANT لـ anon):
increment_offer_views(offer_id)               -- عداد مشاهدات من صفحة العرض العامة
record_offer_sale(store_id, product_id, qty)  -- يزيد sold_quantity للعروض الجارية فقط
```

### RLS
- التاجر: إدارة كاملة عبر `is_store_member`
- الزبون: `SELECT` للعروض `is_active = true` فقط (فلترة الفترة الزمنية في الـ query)

### السلوك
- حالة العرض تُحسب في TypeScript: مجدول (قبل البداية) / جارٍ (ضمن الفترة) / منتهي / متوقف (is_active=false)
- في صفحة العرض العامة وصفحة المنتج: أثناء السريان يُمرَّر `price = offer_price` و `compare_price = السعر الأصلي` — فتُضاف للسلة بسعر العرض تلقائياً
- **Checkout يثبّت الأسعار من DB وقت الطلب** (سعر المنتج أو سعر العرض الجاري) — يحمي من سلة قديمة بسعر عرض انتهى، ثم يستدعي `record_offer_sale` لكل منتج عرض
- حد السلة = min(المخزون، كمية العرض المتبقية، حد الزبون)
- `ProductCard` يقبل prop اختياري `offerSold={sold, max}` → شريط "تم بيع X%" + "بقي N فقط"
- `OfferCountdown`: يبدأ بعد الـ mount (hydration-safe)، يتحول أحمر نابض في آخر ساعة
- **بوابة الخطط**: الخطة المجانية = عرض نشط واحد فقط (يُفحص في `offers/new` server-side)
- **تحليلات** في صفحة التعديل: مشاهدات (view_count) + قطع مبيعة + إيراد العرض (order_items خلال الفترة)
- **تسويق**: `sendOfferToCustomers` server action (إيميل لكل الزبائن عبر Resend على دفعات) + مشاركة واتساب + نسخ رابط (`OfferShareActions`)
- `OfferForm`: فلتر فئات + "إضافة الكل" (عروض فئة كاملة) + خصم % جماعي + كمية عرض لكل منتج
- التعديل يعيد بناء `offer_items` (delete ثم insert) **مع الحفاظ على sold_quantity**
- الـ Marketplace: قسم "🔥 عروض اليوم" يجمع العروض الجارية عبر كل متاجر البلد
- التواريخ: `datetime-local` محلياً → تُحفظ ISO/UTC

---

## تقييمات المنتجات (Product Reviews)

- جدول `product_reviews` (migration 027): `store_id, product_id, customer_name, rating(1..5), comment, photos[], status(pending/approved/rejected)`.
- **RLS**: الزبون (anon) يقرأ `approved` فقط ويضيف تقييماً بحالة `pending`؛ التاجر إدارة كاملة عبر `is_store_member`.
- **الصور**: bucket عام منفصل `review-photos` (الزبون غير مسجّل، لذلك سياسة رفع عامة) — `uploadReviewPhoto` في `lib/supabase/storage.ts`.
- **صفحة المنتج**: `ProductReviews.tsx` — ملخص (متوسط + عدد) + نجوم تحت الاسم + قائمة التقييمات المعتمدة + نموذج إضافة (نجوم + اسم + تعليق + حتى 4 صور). التقييم الجديد يُحفظ `pending`.
- **لوحة التاجر**: `/dashboard/reviews` — تبويبات (بانتظار/معتمدة/مخفية/الكل) + اعتماد/إخفاء/حذف لكل تقييم (`ReviewsModeration.tsx`). رابط "التقييمات ⭐" في الـ Sidebar.

## الوحدات (modules) والقائمة الجانبية

- لكل متجر حقل `stores.modules` (JSONB): `store/accounting/inventory/maintenance/marketplace`.
- الـ Sidebar يُخفي أي مجموعة لها `module` إذا كانت القيمة false. **وحدة الصيانة `maintenance` افتراضياً false** — تظهر فقط لمحلات التصليح التي تفعّلها.
- التفعيل/الإيقاف من الإعدادات (قسم "الوحدات").

## الإيميل (Resend)

```typescript
// lib/email/order-email.ts
await sendOrderEmail({ to, customerName, storeName, orderNumber,
  currencyCode, subtotal, totalAmount, paymentMethod, trackingUrl, items })
```
- بدون `RESEND_API_KEY` أو بدون `to` → يُتجاهل بهدوء
- المُرسل: `orders@bazarko.com` (يحتاج domain verification)

---

## قرارات تقنية مهمة

| القرار | الاختيار | السبب |
|---|---|---|
| Auth | بريد + كلمة سر | Google OAuth مؤجل لبعد النشر |
| Multi-user | store_members من اليوم الأول | ضروري للـ MVP |
| Cart state | Zustand + localStorage | لا يحتاج login |
| Order creation | API Route لا Server Action | منطق معقد (email + ledger) |
| handle_new_store | SECURITY DEFINER | trigger يعمل قبل RLS |
| Slug عربي | transliteration عربي→لاتيني | يعمل في URL بدون encoding |
| Invoice number | count-based `INV-XXXX` | بسيط، لا يحتاج RPC |
| Repair job number | count-based `REP-XXXX` | نفس السبب |
| Kanban | server-rendered + client search | لا drag-and-drop، بسيط وسريع |
| repair_jobs SELECT | مفتوح للجميع | الزبون يتتبع جهازه بدون login |
| Admin guard | is_admin في profiles + redirect | لا middleware منفصل — بسيط |
| Admin actions | Server Actions في actions.ts | تعليق/تفعيل/تغيير خطة بأمان |
| is_platform_admin() | SECURITY DEFINER function | يُقرأ is_admin بدون حاجة RLS |

---

## أنماط الكود — اتبعها دائماً

### Supabase في Server Components
```typescript
import { createClient } from '@/lib/supabase/server'
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
```

### Supabase في Client Components
```typescript
import { createClient } from '@/lib/supabase/client'
const supabase = createClient()
```

### Auth Guard في صفحات Dashboard
```typescript
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect('/login')
const { data: store } = await supabase.from('stores').select('id, currency_code').eq('owner_id', user.id).single()
if (!store) redirect('/onboarding')
```

### لا تستخدم `SUPABASE_SERVICE_ROLE_KEY` في client components أبداً

---

## ما تم بناؤه ✅

| الوحدة | الحالة |
|---|---|
| Auth (بريد + كلمة سر) + Onboarding | ✅ |
| Products + Categories + Images (Storage) | ✅ |
| Storefront + Cart + Checkout | ✅ |
| Order tracking للزبون | ✅ |
| Orders Dashboard — POS + ذمة + أونلاين | ✅ |
| Email عند إنشاء طلبية (Resend) | ✅ |
| Customers + كشف حساب + ذمم | ✅ |
| Inventory + حركات + تنبيهات نفاد | ✅ |
| المحاسبة — نظرة مالية عامة | ✅ |
| المحاسبة — فواتير (إنشاء + عرض + طباعة + تغيير حالة) | ✅ |
| المحاسبة — سندات قبض وصرف | ✅ |
| المحاسبة — تقارير (P&L + Cash Flow + مصاريف) | ✅ |
| ربط الفاتورة بالطلبية (prefill + order_id + روابط ثنائية) | ✅ |
| **وحدة الصيانة الكاملة** | ✅ |
| — Kanban board + إحصائيات | ✅ |
| — استلام جهاز (8 أنواع + كل التفاصيل) | ✅ |
| — تفاصيل الطلب (تشخيص + قطع + مالية + timeline) | ✅ |
| — وصل استلام قابل للطباعة | ✅ |
| — تتبع عام للزبون بدون login | ✅ |
| **ERP مالي — الصندوق والخزينة + P&L + سجل العمليات** | ✅ |
| — الصندوق: رصيد حالي + حركات + إيداع/سحب + إغلاق يومي ومطابقة | ✅ |
| — كل سند يولّد حركة صندوق تلقائياً (trigger) + نقد الكاشير | ✅ |
| — لوحة مؤشرات مالية (7 بطاقات + رصيد الصندوق + رسم تدفق) | ✅ |
| — تقارير P&L (مبيعات − تكلفة بضاعة − مصروفات) + تدفق نقدي | ✅ |
| — فواتير: مدفوعة جزئياً + متأخرة + شريط دفع + تسجيل دفعة + إشعار واتساب | ✅ |
| — سجل العمليات المالية (من فعل ماذا ومتى، غير قابل للتعديل) | ✅ |
| **لوحة مالك النظام (Super Admin)** | ✅ |
| — Overview: GMV + متاجر + طلبيات المنصة | ✅ |
| — قائمة المتاجر مع فلاتر (حالة/خطة/بلد) | ✅ |
| — تفاصيل متجر: إحصائيات + بيانات المالك | ✅ |
| — تعليق/تفعيل المتجر مع سبب | ✅ |
| — إدارة الخطط (free/basic/pro) + تاريخ انتهاء | ✅ |
| — صفحة الخطط: تنبيه اشتراكات تنتهي قريباً | ✅ |
| **ربط الفاتورة بكشف حساب الزبون** | ✅ |
| — عند إنشاء فاتورة لزبون: تسجيل debit + تحديث balance | ✅ |
| — عند دفع مبلغ لحظي: تسجيل credit فوراً | ✅ |
| — عند تحديد الفاتورة كـ paid: تسجيل الدفعة المتبقية | ✅ |
| — عند إلغاء فاتورة: عكس الحركات + credit_note | ✅ |
| **إرسال الفاتورة بالإيميل للزبون** | ✅ |
| — زر "إرسال بالإيميل" في صفحة الفاتورة | ✅ |
| — قالب HTML احترافي عربي مع جدول البنود والمالية | ✅ |
| — Server Action يجلب البيانات ويرسل عبر Resend | ✅ |
| **تقارير المخزون المتقدمة** | ✅ |
| — الأكثر مبيعاً (آخر 30 يوم) | ✅ |
| — المنتجات الراكدة (لا مبيعات في 30 يوم) | ✅ |
| — توزيع قيمة المخزون بالفئة (شريط تقدم) | ✅ |
| — رسم بياني للحركات اليومية (آخر 7 أيام) | ✅ |
| **الـ Marketplace (المرحلة 3)** | ✅ |
| — صفحة رئيسية: Hero + منتجات مميزة + أحدث المنتجات + أبرز المتاجر | ✅ |
| — بحث عبر كل المتاجر مع فلاتر السعر والمتجر | ✅ |
| — دليل المتاجر الكامل مع عدد المنتجات | ✅ |
| — Layout ثابت مع شريط بحث في كل الصفحات | ✅ |
| **العروض الحصرية (Flash Sales)** | ✅ |
| — إنشاء/تعديل عرض: فترة + منتجات + سعر عرض لكل منتج + خصم % جماعي | ✅ |
| — قائمة العروض مع حالات (جارٍ/مجدول/منتهي/متوقف) | ✅ |
| — قسم العروض في رئيسية المتجر (بانر متدرج + عداد) | ✅ |
| — صفحة عرض عامة للزبون + عداد تنازلي + شراء بسعر العرض | ✅ |
| — سعر العرض وبانره في صفحة المنتج نفسها | ✅ |
| — كمية محدودة للعرض + شريط "تم بيع X%" + "بقي N فقط" | ✅ |
| — حد أقصى لكل زبون | ✅ |
| — تثبيت الأسعار من DB وقت الطلب + تسجيل مبيعات العرض | ✅ |
| — إرسال العرض بالإيميل لكل الزبائن + مشاركة واتساب + نسخ رابط | ✅ |
| — تحليلات العرض (مشاهدات/قطع مبيعة/إيراد) | ✅ |
| — عروض فئة كاملة (فلتر فئات + إضافة الكل) | ✅ |
| — بوابة الخطط: عرض نشط واحد للخطة المجانية | ✅ |
| — قسم "عروض اليوم" في الـ Marketplace | ✅ |
| — عداد أحمر نابض في آخر ساعة | ✅ |
| **ثيمات هيدر المتجر (6 تصاميم متحركة)** | ✅ |
| — اسم المتجر بتدرج لوني متحرك + لمعان يمر فوق الهيدر | ✅ |
| — اختيار الثيم من الإعدادات مع معاينة حية مصغّرة | ✅ |

## ما لم يُبنَ بعد

| الوحدة | الأولوية |
|---|---|
| Google OAuth | بعد النشر على Vercel |

---

## كيفية إضافة ميزة جديدة

1. **Schema** → `db/migrations/00N_name.sql` بـ `SET search_path = public;` في البداية، طبّقه في Supabase SQL Editor
2. **صفحة Dashboard** → Server Component في `app/dashboard/[feature]/page.tsx` مع auth guard كامل
3. **مكون Client** → `components/dashboard/[feature]/` مع `'use client'`
4. **API Route** → `app/api/[feature]/route.ts` للعمليات المعقدة فقط
5. **حدّث `CLAUDE.md`** بعد كل milestone

---

## تشغيل المشروع

```bash
npm run dev     # localhost:3000
npm run build   # فحص TypeScript — يجب أن ينجح بلا أخطاء
```

الروتينج في localhost: `localhost:3000/store/ps/mystore` (بدل subdomain routing)
