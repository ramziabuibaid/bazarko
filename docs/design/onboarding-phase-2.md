# بازاركو — المرحلة الثانية: التسجيل حسب النشاط

تم تنفيذ اختيار مشروع منزلي / محل / شركة أو محاسب، مع نصوص وحقول وخطوات بداية تتكيف مع الاختيار. تفاصيل المشروع محفوظة مؤقتاً في sessionStorage لتستعاد بعد إنشاء الحساب أو تسجيل الدخول في التبويب نفسه. لا تُحفظ كلمات مرور أو بيانات مصادقة في هذه المسودة.

عند إنشاء مساحة العمل، يُحفظ `business_type` و`dashboard_mode` و`onboarding_version` داخل `stores.settings` مع قيم الإعدادات الأساسية. لا تحتاج هذه المرحلة إلى تعديل مخطط قاعدة البيانات، ولا تمنح الاختيارات صلاحيات أو ميزات مدفوعة. استخدام dashboard_mode لتغيير لوحة التحكم جزء من المرحلة الثالثة.

## التحقق

- نجح بناء الإنتاج، وفحص الأنواع وlint ضمن البناء.
- اختُبر اختيار الشركة وتغيير تسمية حقل الاسم، والرابط المحجوز، والتحقق الفعلي من رابط متاح عبر Supabase، ومراجعة التفاصيل.
- اختُبر استرجاع المسودة بعد إعادة تحميل الصفحة، وانتقال الزائر إلى `/login?mode=signup` حيث يظهر نموذج الحساب الجديد.
- فُحصت الصفحة على عرض 1280px و390px؛ لا تمرير أفقي في نموذج المراجعة.
- لم يُنشأ حساب أو متجر تجريبي، ولم يُختبر الإدخال النهائي بجلسة مستخدم مسجل. التعديلات محلية ولم تُنشر.

## الصورة

Mode: generate. Tool: built-in imagegen. أصل واحد يحتوي ثلاث لوحات متناسقة تُعرض بإزاحة الخلفية في CSS دون تشويه نسب الأبعاد. تم تحويل الأصل إلى WebP بجودة 88.

Asset: `public/images/onboarding/business-types-v1.webp`

Original: `/Users/iquik/.codex/generated_images/01a0f147-e424-7be0-a26f-f5f247ef5564/exec-66e590a2-c4db-4e85-ab16-ffa811cee652.png`

Final prompt:

Use case: stylized-concept. Asset type: three-panel illustration strip for Bazarko onboarding choice cards. Landscape 3:1 image, exactly three equal-width panels with separate miniature 3D dioramas centered in each panel. LEFT: cozy white home business with small wooden desk, laptop, parcels and plants. CENTER: welcoming small retail shop with turquoise-and-white awning, warm lit windows, boxes and plants. RIGHT: modern accounting office with desk, laptop, shelving with binders and plants. All three on identical deep midnight navy #081727 seamless background, matching scale, soft cyan rim light and warm windows, polished realistic stylized 3D, no people. Leave margins around each diorama, no objects crossing panel boundaries. No dividers, no lettering, no words, no logos, no watermark. Art only; captions will be rendered in HTML.

## المرحلة التالية

لوحة تحكم مبسطة للنسخة المجانية، مع مؤشرات حقيقية وطلبات اليوم وخطوات البداية وأزرار واضحة، ثم الوصول للأدوات المتقدمة.
