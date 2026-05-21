# Bazarko — دليل المشروع لـ Claude

> هذا الملف يُقرأ تلقائياً في كل جلسة. هو المرجع الوحيد — لا تحتاج لأي ملف آخر.
> **آخر تحديث:** مايو 2026 | **Build:** 37 route، يعمل بدون أخطاء

---

## ما هو هذا المشروع؟

**Bazarko** — منصة SaaS لإدارة الأعمال التجارية في الدول العربية (فلسطين وسوريا أولاً).
كل تاجر يحصل على: متجر إلكتروني + طلبيات + محاسبة + مخزون + زبائن وذمم + نظام صيانة.

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
    ├── page.tsx                               ← Storefront
    ├── product/[slug]/page.tsx
    ├── cart/page.tsx
    ├── checkout/page.tsx
    ├── order/[id]/page.tsx                    ← تتبع الطلبية (بدون auth)
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
│   └── maintenance/
│       ├── RepairIntakeForm.tsx               ← نموذج استلام الجهاز
│       ├── RepairKanban.tsx                   ← لوحة Kanban بـ 5 أعمدة
│       └── RepairJobDetail.tsx                ← إدارة الطلب الكامل
└── store/
    ├── StoreHeader.tsx
    ├── ProductCard.tsx
    ├── CategoryFilter.tsx
    └── AddToCartButton.tsx

lib/
├── supabase/client.ts + server.ts
├── supabase/storage.ts                        ← uploadProductImage / deleteProductImage
├── store/cart.ts                              ← Zustand persist، key: bazarko-cart
├── email/order-email.ts                       ← sendOrderEmail() بـ Resend
└── utils/slug.ts                              ← Arabic → Latin transliteration

db/
├── schema.sql                                 ← Schema كامل — يُشغَّل مرة واحدة
└── migrations/
    ├── 001_fix_trigger_security.sql           ✅ مطبّق
    ├── 002_orders_customer_fields.sql         ✅ مطبّق
    ├── 003_customer_email.sql                 ✅ مطبّق
    ├── 004_invoices_vouchers.sql              ✅ مطبّق
    ├── 005_repair_jobs.sql                    ⚠️ يجب تطبيقه في Supabase SQL Editor
    └── 006_admin_panel.sql                    ⚠️ يجب تطبيقه في Supabase SQL Editor
```

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
005 — repair_jobs + repair_job_parts + repair_job_history + RLS                    ⚠️ طبّقه
006 — is_admin في profiles + is_active/plan/suspended في stores + is_platform_admin() ⚠️ طبّقه
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
