# Bazarko

منصة SaaS لإدارة المتاجر الإلكترونية والمحاسبة والمخزون في فلسطين وسوريا.

## ما تم تنفيذه حتى الآن

- مشروع Next.js 14 مع App Router وTailwind CSS
- بنية Subdomain + Marketplace + Store
- Middleware لإعادة توجيه `ps.bazarko.com` و`sy.bazarko.com`
- نموذج لوحة تحكم وواجهة سوق
- تكامل أولي مع Supabase عبر `lib/supabaseClient.ts`
- ملف SQL مبدئي لـ schema

## التشغيل المحلي

1. تثبيت الحزم:

   ```bash
   npm install
   ```

2. تشغيل المشروع:

   ```bash
   npm run dev
   ```

3. إعداد متغيرات البيئة:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_DOMAIN` (افتراضي `bazarko.com`)

## المراحل التالية المقترحة

1. بناء شاشة اختيار البلد في تسجيل المستخدم.
2. تنفيذ مصادقة Supabase مع Google OAuth.
3. إضافة لوحة إدارة المتجر ونماذج CRUD للمخزون والعملاء.
4. توسيع قاعدة البيانات في `db/schema.sql` لتشمل الطلبات، الفواتير، الذمم، والمحاسبة.
