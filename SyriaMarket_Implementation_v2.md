# Bazarko — وثيقة التخطيط والتنفيذ الشاملة

> **الإصدار:** 3.0 | **آخر تحديث:** مايو 2026 | **الحالة:** قيد التطوير النشط
> **الأسواق المستهدفة:** فلسطين 🇵🇸 — سوريا 🇸🇾 — قابل للتوسع لأي دولة
> **مستوى الإنجاز:** المرحلة الأولى — الأسابيع 1-8 مكتملة ✅

---

## ⚡ للمرجعة السريعة — ما تم إنجازه حتى الآن

| الوحدة | الحالة | الملفات الرئيسية |
|---|---|---|
| Schema + قاعدة البيانات | ✅ مكتمل | `db/schema.sql` + migration 001, 002 |
| Auth (بريد + كلمة سر) | ✅ مكتمل | `app/login/page.tsx`, `app/auth/callback/route.ts` |
| Onboarding (3 خطوات) | ✅ مكتمل | `app/onboarding/page.tsx` |
| Dashboard Layout + Sidebar | ✅ مكتمل | `app/dashboard/layout.tsx`, `components/dashboard/Sidebar.tsx` |
| إدارة الفئات | ✅ مكتمل | `app/dashboard/categories/`, `components/dashboard/categories/` |
| إدارة المنتجات (CRUD كامل + صور) | ✅ مكتمل | `app/dashboard/products/`, `components/dashboard/products/` |
| واجهة المتجر للزبون (Storefront) | ✅ مكتمل | `app/store/[country]/[subdomain]/` |
| صفحة المنتج التفصيلية | ✅ مكتمل | `app/store/.../product/[slug]/page.tsx` |
| سلة التسوق (Zustand + localStorage) | ✅ مكتمل | `lib/store/cart.ts`, `app/store/.../cart/` |
| الـ Checkout + إنشاء الطلبية | ✅ مكتمل | `app/store/.../checkout/page.tsx` |
| لوحة إدارة الطلبيات | ✅ مكتمل | `app/dashboard/orders/`, `components/dashboard/orders/` |
| إنشاء طلبية من الداشبورد (POS + ذمة) | ✅ مكتمل | `app/dashboard/orders/new/`, `app/api/orders/create/` |
| صفحة تتبع الطلبية للزبون | ✅ مكتمل | `app/store/.../order/[id]/page.tsx` |
| إرسال إيميل عند الطلب (Resend) | ✅ مكتمل | `lib/email/order-email.ts` — يحتاج `RESEND_API_KEY` |
| إعدادات المتجر (لوغو، غلاف، تواصل) | ✅ مكتمل | `app/dashboard/settings/`, `components/dashboard/settings/` |
| رفع صور المنتجات (Supabase Storage) | ✅ مكتمل | `lib/supabase/storage.ts`, bucket: `product-images` |
| Google OAuth | ⏳ مؤجل | مقرر بعد النشر على Vercel |
| إدارة الزبائن + كشف الحساب + دفعات | ✅ مكتمل | `app/dashboard/customers/`, `components/dashboard/customers/` |
| طباعة كشف الحساب (window.print) | ✅ مكتمل | زر طباعة في ملف الزبون |
| وحدة الفواتير الكاملة | ⏳ قادم | المرحلة 2 |
| وحدة الصيانة | ⏳ قادم | المرحلة 2 |
| صفحة الـ Marketplace | ⏳ قادم | المرحلة 3 |

---

## فهرس الوثيقة

1. رؤية المشروع
2. بنية تعدد الدول (Multi-Country Architecture)
3. الهيكلية التقنية الكاملة
4. قاعدة البيانات — Schema الكامل
5. ما تم بناؤه بالتفصيل (Implementation Details)
6. قرارات تقنية مهمة اتُّخذت
7. Migrations المطبّقة
8. بنية المجلدات الفعلية
9. وحدات النظام المخططة
10. نموذج الإيرادات
11. خطة التنفيذ (Roadmap) — مع تتبع الإنجاز

---

# الجزء الأول: رؤية المشروع

## ما هو Bazarko؟

منصة SaaS متكاملة لإدارة الأعمال التجارية في الدول العربية الناشئة، مع بنية تحتية تدعم التوسع الجغرافي من اليوم الأول.

## الفرق الجوهري عن المنافسين

معظم منصات التجارة الإلكترونية تحل مشكلة "البيع عبر الإنترنت" فقط. هذا المشروع يحل المشكلة الأكبر: **إدارة العمل التجاري كاملاً** — من أول طلبية حتى الميزانية السنوية.

**ما يحصل عليه التاجر:**
- متجر إلكتروني احترافي (واجهة للزبون)
- نظام إدارة طلبيات كامل مع تتبع الحالة
- محاسبة مالية (قبض، صرف، أرباح، خسائر)
- إدارة الزبائن وذممهم
- إدارة المخزون والتنبيهات
- نظام صيانة (للمتاجر المؤهلة)
- كل ذلك بدعم متعدد المستخدمين من اليوم الأول

---

# الجزء الثاني: بنية تعدد الدول

## 2.1 المبدأ الأساسي

كل دولة هي **سوق مستقل تماماً** بـ:
- Marketplace منفصل
- عملة خاصة بها
- إعدادات ضريبية مختلفة
- شركات توصيل محلية

لكن البنية التقنية والكود **مشترك بالكامل**.

## 2.2 استراتيجية الدومين

```
الدومين الرئيسي:      bazarko.com
فلسطين:               ps.bazarko.com       (الـ Marketplace الفلسطيني)
سوريا:                sy.bazarko.com       (الـ Marketplace السوري)
متجر في فلسطين:       storename.ps.bazarko.com
متجر في سوريا:        storename.sy.bazarko.com
لوحة تحكم التاجر:    bazarko.com/dashboard  (مشتركة)
```

## 2.3 جدول الدول

```sql
CREATE TABLE countries (
  code          TEXT PRIMARY KEY,      -- 'PS', 'SY'
  name_ar       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  currency_code TEXT NOT NULL,         -- 'ILS', 'SYP'
  currency_symbol TEXT NOT NULL,       -- '₪', 'ل.س'
  domain_prefix TEXT NOT NULL,         -- 'ps', 'sy'
  is_active     BOOLEAN DEFAULT TRUE,
  launch_date   DATE,
  settings      JSONB DEFAULT '{}'
);

INSERT INTO countries VALUES
  ('PS', 'فلسطين', 'Palestine', 'ILS', '₪', 'ps', TRUE, '2026-06-01', '{}'),
  ('SY', 'سوريا', 'Syria', 'SYP', 'ل.س', 'sy', TRUE, '2026-08-01', '{}');
```

---

# الجزء الثالث: الهيكلية التقنية

## 3.1 Stack التقني

```
Frontend:     Next.js 14 (App Router) + TypeScript
Styling:      Tailwind CSS
State:        Zustand (سلة التسوق) + React useState/useEffect
Database:     Supabase (PostgreSQL 15)
Auth:         Supabase Auth — بريد + كلمة سر (Google OAuth مؤجل)
Storage:      Supabase Storage — bucket: product-images (PUBLIC)
Hosting:      Vercel (مخطط)
Package:      @supabase/ssr (لإدارة الـ cookies في App Router)
Path Alias:   @/* → ./* (في tsconfig.json)
```

## 3.2 المتغيرات البيئية (.env.local)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://hncjwffgicesmlpuwegr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>  # سري، لا يُعرض للعميل
NEXT_PUBLIC_DOMAIN=bazarko.com
```

## 3.3 Middleware — نظام الـ Multi-Country Routing

الملف: `middleware.ts`

المهام:
1. تجديد جلسة Auth في كل طلب
2. `ps.bazarko.com` → يعيد توجيه إلى `/marketplace/ps`
3. `storename.ps.bazarko.com` → يعيد توجيه إلى `/store/ps/storename`
4. `localhost:3000` → يمر مباشرة

```typescript
// المنطق الأساسي في middleware.ts
// ps.bazarko.com → /marketplace/ps
// storename.ps.bazarko.com → /store/ps/storename
```

---

# الجزء الرابع: قاعدة البيانات الكاملة

الملف الكامل: `db/schema.sql`

## الجداول الرئيسية

| الجدول | الوصف |
|---|---|
| `countries` | الدول المدعومة |
| `profiles` | امتداد بيانات المستخدم من auth.users |
| `stores` | المتاجر (store_id, owner_id, subdomain, country_code) |
| `store_members` | أعضاء المتجر (multi-user) — دور: owner/admin/staff |
| `categories` | فئات المنتجات لكل متجر |
| `products` | المنتجات مع كل بياناتها |
| `stock_movements` | سجل حركات المخزون |
| `customers` | الزبائن مع الذمم المالية |
| `delivery_companies` | شركات التوصيل لكل دولة |
| `orders` | الطلبيات (+ customer_name, customer_phone — migration 002) |
| `order_items` | عناصر كل طلبية |
| `order_tracking` | سجل تغييرات حالة الطلبية |
| `accounts` | دليل الحسابات (Chart of Accounts) |
| `invoices` + `invoice_items` | الفواتير |
| `receipt_vouchers` | سندات القبض |
| `payment_vouchers` | سندات الصرف |
| `suppliers` | الموردون |
| `customer_ledger` | كشف حساب الزبائن |
| `maintenance_requests` | طلبات الصيانة |
| `maintenance_parts` | قطع الغيار لكل طلب صيانة |
| `maintenance_status_history` | سجل حالات الصيانة |
| `marketplace_categories` | فئات الـ Marketplace لكل دولة |
| `store_marketplace_categories` | ربط المتجر بفئات Marketplace |
| `store_reviews` | تقييمات المتاجر |
| `sequence_counters` | عدادات أرقام المستندات |

## الدوال (Functions) والـ Triggers المهمة

```sql
-- دالة للتحقق من عضوية المتجر (تستخدمها سياسات RLS)
is_store_member(store_id UUID) → BOOLEAN

-- trigger عند إنشاء مستخدم جديد → ينشئ profile
handle_new_user() SECURITY DEFINER

-- trigger عند إنشاء متجر جديد → ينشئ store_member (owner) + حسابات افتراضية
handle_new_store() SECURITY DEFINER SET search_path = public
-- ⚠️ مهم: SECURITY DEFINER ضروري لأن الـ trigger يعمل بصلاحيات المالك لا المستخدم

-- دالة توليد أرقام المستندات بشكل atomic (بدون تكرار)
generate_sequence_number(p_store_id UUID, p_prefix TEXT) → TEXT
-- مثال: generate_sequence_number(id, 'ORD-2026-') → 'ORD-2026-0042'

-- دالة إنشاء الحسابات الافتراضية عند إنشاء المتجر
create_default_accounts(store_id UUID)
```

## سياسات RLS

كل الجداول محمية بـ Row Level Security. المبدأ:
- التاجر يرى/يعدل بيانات متجره فقط عبر `is_store_member(store_id)`
- الزبون يرى فقط بيانات المتاجر النشطة `status = 'active'`
- جدول `orders`: INSERT مفتوح (يملأه الزبون)، SELECT/UPDATE للتاجر فقط

## حقول orders الإضافية (migrations)

```sql
-- migration 002
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- migration 003
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_email TEXT;
```

---

# الجزء الخامس: ما تم بناؤه بالتفصيل

## 5.1 المصادقة (Auth)

**القرار:** بريد إلكتروني + كلمة سر فقط. Google OAuth مؤجل لما بعد النشر.

- `app/login/page.tsx` — نموذج واحد يتحول بين Login/Signup
- `app/auth/callback/route.ts` — يستقبل code من Supabase، يوجه لـ `/dashboard` إذا عنده متجر أو `/onboarding` إذا لا
- `lib/supabase/client.ts` — `createBrowserClient` من `@supabase/ssr`
- `lib/supabase/server.ts` — `createServerClient` مع cookie handling

## 5.2 Onboarding (إنشاء المتجر)

`app/onboarding/page.tsx` — wizard بـ 3 خطوات:

1. **اختيار البلد:** فلسطين 🇵🇸 أو سوريا 🇸🇾
2. **اسم المتجر:** نص حر
3. **الـ Subdomain:** مع تحقق فوري من التوفر (`is_taken`)

عند الإنشاء: يُدخل في `stores` → trigger `handle_new_store` يُنشئ:
- سجل في `store_members` (دور: owner)
- الحسابات المحاسبية الافتراضية

## 5.3 لوحة التحكم (Dashboard)

`app/dashboard/layout.tsx` — server component:
- يتحقق من وجود مستخدم → يوجه لـ `/login`
- يتحقق من وجود متجر → يوجه لـ `/onboarding`
- يمرر بيانات المتجر للـ Sidebar

`components/dashboard/Sidebar.tsx` — قائمة التنقل الجانبية:
- مجموعات: عامة، المتجر الإلكتروني، المحاسبة، الزبائن، المخزون، الصيانة (مشروطة)
- رابط معاينة المتجر
- زر تسجيل الخروج

`app/dashboard/page.tsx` — الصفحة الرئيسية:
- 4 بطاقات إحصائية: إجمالي الطلبيات، الزبائن، المنتجات النشطة، الإيرادات

## 5.4 الفئات

`app/dashboard/categories/page.tsx` — Server Component يجلب الفئات  
`components/dashboard/categories/CategoryManager.tsx` — Client Component:
- عرض الفئات بشجرة (أب/طفل)
- إضافة/تعديل عبر modal
- حذف مع تأكيد
- تفعيل/تعطيل

## 5.5 المنتجات

`app/dashboard/products/page.tsx` — قائمة مع:
- 4 بطاقات إحصاء (إجمالي، نشط، نفد المخزون، إجمالي قيمة)
- بحث نصي + فلتر بالفئة والحالة

`components/dashboard/products/ProductsTable.tsx`:
- صورة، اسم، SKU، سعر، مخزون (badge ملون)، toggle نشط/معطل، تعديل، حذف

`components/dashboard/products/ProductForm.tsx` — نموذج شامل:
- المعلومات الأساسية (اسم، وصف، فئة، slug تلقائي من الاسم)
- التسعير (سعر البيع، سعر المقارنة، سعر التكلفة)
- المخزون (الكمية، track_stock، allow_backorder)
- الصور (رفع متعدد لـ Supabase Storage)
- التصنيف والحالة

`lib/supabase/storage.ts`:
- `uploadProductImage(storeId, file)` → يرفع لـ bucket `product-images` ويُعيد الـ public URL
- `deleteProductImage(url)` → يحذف الصورة

`lib/utils/slug.ts`:
- تحويل النص العربي لـ slug لاتيني بالتحويل الصوتي
- fallback: timestamp إذا فشل التحويل

## 5.6 Supabase Storage — product-images

- **البكت:** `product-images` (PUBLIC)
- **path pattern:** `{storeId}/{timestamp}-{random}.{ext}`
- **سياسات RLS** (يجب تطبيقها في SQL Editor):

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

## 5.7 واجهة المتجر للزبون (Storefront)

`app/store/[country]/[subdomain]/page.tsx`:
- يجلب بيانات المتجر بالـ subdomain + country_code
- يعرض: صورة الغلاف، المنتجات المميزة، فلاتر الفئات، بحث، شبكة منتجات
- 404 إذا لم يُوجد المتجر أو كان غير نشط

`app/store/[country]/[subdomain]/product/[slug]/page.tsx`:
- صور المنتج (gallery)، السعر مع نسبة الخصم
- زر "أضف للسلة" مع تحكم بالكمية
- رابط واتساب للاستفسار
- "نفد المخزون" إذا الكمية 0 مع track_stock

`app/store/[country]/[subdomain]/cart/page.tsx`:
- قائمة المنتجات مع تعديل الكمية وحذف
- ملخص السعر
- زر المتابعة للدفع

`app/store/[country]/[subdomain]/checkout/page.tsx`:
- نموذج: الاسم، الهاتف، المدينة، العنوان، ملاحظات
- طريقة الدفع: نقداً / تحويل بنكي
- ملخص الطلب
- يُنشئ سجل في `orders` + `order_items` + يحفظ customer_name و customer_phone

**مكونات المتجر:**
- `components/store/StoreHeader.tsx` — header ثابت مع لوغو، زر واتساب، عداد السلة
- `components/store/ProductCard.tsx` — كرت المنتج مع badge الخصم، overlay "نفد المخزون"
- `components/store/CategoryFilter.tsx` — pills قابلة للتمرير
- `components/store/AddToCartButton.tsx` — يتحول لتحكم بالكمية بعد الإضافة

**سلة التسوق:**
- `lib/store/cart.ts` — Zustand store مع `persist` middleware
- يُخزّن في localStorage بالمفتاح `bazarko-cart`
- كل متجر له سلة مستقلة (يُعرّف productId الفريد)

## 5.8 لوحة إدارة الطلبيات

`app/dashboard/orders/page.tsx` — Server Component:
- يعرض قائمة الطلبيات مع إحصاء لكل حالة
- فلترة بالحالة + بحث (رقم طلبية / اسم / هاتف)
- ترقيم صفحات (20/صفحة)

`components/dashboard/orders/OrdersTable.tsx`:
- تبويبات الحالة مع العداد
- جدول: رقم الطلبية، الزبون، المدينة، الإجمالي، الدفع، الحالة (badge ملون)، التاريخ
- رابط لصفحة التفاصيل

`app/dashboard/orders/[id]/page.tsx` — تفاصيل الطلبية

`components/dashboard/orders/OrderDetail.tsx`:
- عناصر الطلب مع الأسعار والمجموع المالي
- تقدّم الحالة بزر واحد: معلق → مؤكد → قيد التجهيز → جاهز للشحن → تم الشحن → مُسلّم
- زر إلغاء الطلب
- بيانات الزبون مع رابط مكالمة + رابط واتساب
- ملاحظات داخلية تُحفظ في قاعدة البيانات

**حالات الطلبية:**
```
pending → confirmed → processing → ready → shipped → delivered
                                                    ↘ cancelled (في أي وقت)
```

## 5.9 نظام إنشاء الطلبيات من الداشبورد (POS + ذمة)

### الأنواع الثلاثة للطلبيات

| النوع | source | status | payment_status | الذمة |
|---|---|---|---|---|
| POS (كاشير) | `dashboard` | `delivered` | `paid` | لا |
| ذمة زبون مسجّل | `dashboard` | `pending` | `unpaid`/`partial`/`paid` | نعم إذا متبقٍ |
| أونلاين من المتجر | `store` | `pending` | `unpaid` | لا |

### الملفات

`app/dashboard/orders/new/page.tsx` — يحمّل store ويمرره لـ NewOrderForm  
`components/dashboard/orders/NewOrderForm.tsx` — الفورم الكامل:
- تبويب POS: بيانات زبون اختيارية (اسم، هاتف، إيميل للفاتورة)
- تبويب ذمة: بحث في قاعدة الزبائن مع عرض رصيدهم الحالي
- بحث المنتجات بـ debounce 250ms، يعرض الصورة والسعر والمخزون
- تعديل السعر مباشرة في الجدول (مرونة للخصومات)
- دفعة مقدمة في وضع الذمة

`app/api/orders/create/route.ts` — POST endpoint:
1. يتحقق من auth
2. يحسب المجاميع
3. يُولّد رقم الطلبية
4. يُنشئ سجل في `orders` + `order_items`
5. إذا ذمة متبقية → يُدخل في `customer_ledger` + يُحدّث `customers.balance`
6. إذا يوجد إيميل → يُرسل بريد الفاتورة

### منطق الذمة

```typescript
// عند إنشاء طلبية بوضع الذمة ويوجد مبلغ غير مدفوع:
const amountRemaining = totalAmount - amountPaid

// إدخال في customer_ledger
{ type: 'invoice', debit: amountRemaining, balance: currentBalance + amountRemaining }

// تحديث customers
{ balance: currentBalance + amountRemaining }
```

## 5.10 إرسال الإيميل (Resend)

`lib/email/order-email.ts` — `sendOrderEmail()`:
- يُرسل HTML template احترافي بالعربية RTL
- يحتوي: اسم المتجر، رقم الطلبية، جدول المنتجات، الإجمالي، طريقة الدفع، رابط التتبع
- إذا `RESEND_API_KEY` غير موجود أو `to` فارغ → يُتجاهل بهدوء (لا يوقف الطلبية)
- المُرسل: `orders@bazarko.com` (يحتاج domain verification في Resend dashboard)

```bash
# أضف للـ .env.local
RESEND_API_KEY=re_xxxxxxxxxxxx
```

## 5.11 صفحة تتبع الطلبية للزبون

`app/store/[country]/[subdomain]/order/[id]/page.tsx`:
- لا تحتاج تسجيل دخول (public)
- شريط تقدم مرئي مع الخطوات الست
- يُبرز الخطوة الحالية مع scale + shadow
- عناصر الطلب والإجمالي
- رابط واتساب للاستفسار عن الطلبية

بعد إتمام الـ Checkout، يرى الزبون: **"تتبع طلبيتك →"** يوصله لهذه الصفحة.

---

# الجزء السادس: قرارات تقنية مهمة اتُّخذت

| القرار | الاختيار | السبب |
|---|---|---|
| Auth | بريد + كلمة سر | Google OAuth يحتاج دومين حقيقي، مؤجل لبعد النشر |
| Multi-user | `store_members` من اليوم الأول | مهم للـ MVP، لا تكلفة إضافية |
| الـ Subdomain | `storename.ps.bazarko.com` | يدعم multi-country بدون تعقيد |
| السلة | Zustand + localStorage | لا يحتاج login، بسيط وسريع |
| Slug عربي | transliteration عربي→لاتيني | يعمل في الـ URL بدون encoding |
| أرقام الطلبيات | PostgreSQL function atomic | يضمن عدم التكرار مع concurrent requests |
| handle_new_store | SECURITY DEFINER | ضروري لأن trigger يُدخل في store_members قبل أن يُضاف المستخدم للـ RLS |

---

# الجزء السابع: Migrations المطبّقة

## Migration 001: إصلاح trigger أمان المتجر

الملف: `db/migrations/001_fix_trigger_security.sql`

**المشكلة:** عند إنشاء متجر جديد، trigger `handle_new_store` كان يحاول إنشاء حسابات محاسبية قبل إضافة المستخدم لـ `store_members`، فكانت سياسة RLS تمنعه.

**الحل:**
```sql
CREATE OR REPLACE FUNCTION handle_new_store()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- أولاً: أضف المالك كعضو (حتى تعمل is_store_member)
  INSERT INTO store_members (store_id, profile_id, role, joined_at)
  VALUES (NEW.id, NEW.owner_id, 'owner', NOW());
  -- ثانياً: أنشئ الحسابات الافتراضية
  PERFORM create_default_accounts(NEW.id);
  RETURN NEW;
END;
$$;
```

## Migration 002: إضافة حقول الزبون للطلبية

الملف: `db/migrations/002_orders_customer_fields.sql`

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;
```

**السبب:** الـ checkout كان يحفظ الاسم والهاتف في form state لكن لم يكن يُدخلهما في قاعدة البيانات، فلم يظهرا في لوحة الطلبيات.

---

# الجزء الثامن: بنية المجلدات الفعلية

```
marketplace/
├── app/
│   ├── auth/callback/route.ts          ✅ code exchange + توجيه
│   ├── login/page.tsx                  ✅ بريد + كلمة سر
│   ├── onboarding/page.tsx             ✅ wizard 3 خطوات
│   │
│   ├── dashboard/
│   │   ├── layout.tsx                  ✅ auth guard + sidebar
│   │   ├── page.tsx                    ✅ overview + stats
│   │   ├── categories/page.tsx         ✅ CRUD كامل
│   │   ├── products/
│   │   │   ├── page.tsx               ✅ قائمة + فلاتر
│   │   │   ├── new/page.tsx           ✅ نموذج إضافة
│   │   │   └── [id]/page.tsx          ✅ نموذج تعديل
│   │   └── orders/
│   │       ├── page.tsx               ✅ قائمة + فلاتر + pagination
│   │       └── [id]/page.tsx          ✅ تفاصيل + تحديث حالة
│   │
│   ├── marketplace/[country]/page.tsx  ⏳ (placeholder)
│   │
│   └── store/[country]/[subdomain]/
│       ├── page.tsx                    ✅ storefront
│       ├── product/[slug]/page.tsx     ✅ تفاصيل المنتج
│       ├── cart/page.tsx              ✅ السلة
│       └── checkout/page.tsx          ✅ إتمام الطلب
│
├── components/
│   ├── dashboard/
│   │   ├── Sidebar.tsx                ✅
│   │   ├── categories/CategoryManager.tsx  ✅
│   │   ├── products/
│   │   │   ├── ProductsTable.tsx      ✅
│   │   │   └── ProductForm.tsx        ✅ (رفع صور مدمج)
│   │   └── orders/
│   │       ├── OrdersTable.tsx        ✅
│   │       └── OrderDetail.tsx        ✅
│   └── store/
│       ├── StoreHeader.tsx            ✅
│       ├── ProductCard.tsx            ✅
│       ├── CategoryFilter.tsx         ✅
│       └── AddToCartButton.tsx        ✅
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts                  ✅ createBrowserClient
│   │   ├── server.ts                  ✅ createServerClient + cookies
│   │   ├── storage.ts                 ✅ uploadProductImage / deleteProductImage
│   │   └── database.types.ts          ✅ TypeScript types
│   ├── store/
│   │   └── cart.ts                    ✅ Zustand persist
│   └── utils/
│       └── slug.ts                    ✅ Arabic → Latin transliteration
│
├── db/
│   ├── schema.sql                     ✅ Schema كامل (20+ جدول)
│   └── migrations/
│       ├── 001_fix_trigger_security.sql  ✅ مطبّق
│       └── 002_orders_customer_fields.sql ✅ مطبّق
│
├── middleware.ts                       ✅ multi-country routing + auth refresh
├── .env.local                          ✅ Supabase credentials
└── tsconfig.json                       ✅ "@/*" path alias
```

---

# الجزء التاسع: وحدات النظام المخططة (القادمة)

## 9.1 إشعارات البريد (الأسبوع 9)

عند إنشاء طلبية جديدة:
- يُرسل بريد للتاجر يحتوي: رقم الطلبية، اسم الزبون، المنتجات، الإجمالي
- الأداة المقترحة: Resend (مجاني حتى 3000 بريد/شهر)

## 9.2 وحدة الفواتير والمحاسبة

**الصفحات:**
- `dashboard/accounting/` — نظرة مالية عامة
- `dashboard/accounting/invoices/` — إنشاء/متابعة الفواتير
- `dashboard/accounting/receipts/` — سندات القبض
- `dashboard/accounting/payments/` — سندات الصرف
- `dashboard/accounting/reports/` — تقارير P&L و cash flow

## 9.3 ذمم الزبائن

- `dashboard/customers/` — قائمة الزبائن مع الرصيد
- `dashboard/customers/[id]/` — كشف حساب كامل
- `dashboard/customers/ledger/` — جميع الذمم مرتبة

## 9.4 وحدة الصيانة

تظهر فقط إذا `store.modules.maintenance = true`

- `dashboard/maintenance/` — قائمة طلبات الصيانة بفلاتر الحالة
- `dashboard/maintenance/new/` — استلام جهاز جديد (wizard)
- `dashboard/maintenance/[id]/` — تفاصيل + تحديث حالة + وصل استلام PDF

## 9.5 المخزون المتقدم

- `dashboard/inventory/` — جدول المخزون مع تعديل الكميات
- `dashboard/inventory/movements/` — سجل حركات المخزون
- `dashboard/inventory/alerts/` — المنتجات القاربة على النفاد

## 9.6 الـ Marketplace

- `marketplace/[country]/` — صفحة رئيسية بالمتاجر المفعّلة
- `marketplace/[country]/[category]/` — تصفح بالفئة
- `marketplace/[country]/stores/[id]/` — صفحة المتجر في الـ Marketplace

---

# الجزء العاشر: نموذج الإيرادات

## التسعير المقترح

### فلسطين (₪)
| الخطة | السعر الشهري | الحدود |
|---|---|---|
| مجاني | 0 | 100 منتج، 50 طلب/شهر |
| Pro | 30-40 ₪ | غير محدود + تقارير + Marketplace |
| Business | 80-100 ₪ | Pro + متعدد موظفين + API |

### سوريا ($)
| الخطة | السعر الشهري | الحدود |
|---|---|---|
| مجاني | 0 | نفس |
| Pro | 5-8 $ | نفس |
| Business | 15-20 $ | نفس |

## مصادر الإيراد المستقبلية
1. الاشتراكات الشهرية
2. عمولة الـ Marketplace (3-5%)
3. الإعلانات داخل الـ Marketplace
4. شارة "بائع موثق" (سنوية)

---

# الجزء الحادي عشر: خطة التنفيذ (Roadmap)

## المرحلة الأولى: Foundation — الأسابيع 1-10

| الأسبوع | المهام | الحالة |
|---|---|---|
| 1-2 | Schema كامل + RLS + Auth | ✅ مكتمل |
| 3 | Multi-country middleware + Onboarding | ✅ مكتمل |
| 4-5 | المنتجات + الفئات + رفع الصور | ✅ مكتمل |
| 6 | واجهة المتجر (Storefront) | ✅ مكتمل |
| 7 | Checkout + إنشاء الطلبية | ✅ مكتمل |
| 8 | لوحة إدارة الطلبيات + تحديث الحالة | ✅ مكتمل |
| 9 | طلبية POS + ذمة زبون + إيميل + إعدادات المتجر | ✅ مكتمل |
| 10 | إدارة الزبائن + كشف حساب + طباعة PDF | ⏳ قادم |

## المرحلة الثانية: Growth — الأسابيع 11-18

| الأسبوع | المهام | الحالة |
|---|---|---|
| 11-12 | إدارة الزبائن الكاملة + كشف الحساب | ⏳ |
| 13-14 | وحدة الصيانة الكاملة | ⏳ |
| 15-16 | إدارة المخزون المتقدمة + حركات | ⏳ |
| 17-18 | تقارير مالية + P&L + Cash flow | ⏳ |

## المرحلة الثالثة: Marketplace — الأسابيع 19-26

| الأسبوع | المهام | الحالة |
|---|---|---|
| 19-20 | إضافة سوريا كدولة + اختبار multi-country | ⏳ |
| 21-22 | واجهة الـ Marketplace لكل دولة | ⏳ |
| 23-24 | نظام التقييم + Verified Seller | ⏳ |
| 25-26 | خطط الاشتراك المدفوعة + بوابة دفع | ⏳ |

---

## قرارات محسومة

| القرار | الاختيار |
|---|---|
| اسم المنصة | Bazarko ✅ |
| تعدد المستخدمين | نعم، من الـ MVP (store_members) ✅ |
| اتجاه النص | RTL أساسي، LTR للمستقبل |
| Auth في الـ MVP | بريد + كلمة سر، Google OAuth بعد النشر |
| سوريا | تُضاف في المرحلة الثالثة (19-20) |

## قرارات معلّقة

| القرار | الخيارات |
|---|---|
| الدفع الإلكتروني في فلسطين | MEPS+ / PayPal / Stripe |
| العملات في سوريا | ل.س أم دولار أم كلاهما؟ |
| نظام الصيانة | يفعّله التاجر بنفسه أم الإدارة تفعّله؟ |

---

*الوثيقة الإصدار 3.0 — يعكس حالة التنفيذ الفعلي حتى مايو 2026*
*يُحدَّث هذا الملف مع كل milestone مكتمل*
