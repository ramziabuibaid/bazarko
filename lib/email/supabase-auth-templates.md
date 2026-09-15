# قوالب إيميلات Supabase Auth المعتمدة لمنصة Bazarko (بزاركو)

تنسيق HTML متوافق مع كافة برامج البريد (Gmail, Outlook, Apple Mail) مع ترويسة الشعار وتوقيع المنظومة.

---

## 1. قالب تأكيد الحساب الجديد (Confirm Signup)
**المسار في Supabase:**
`Authentication` -> `Email Templates` -> `Confirm signup`

### العنوان (Subject):
```text
رمز توثيق حسابك في بزاركو | {{ .Token }}
```

### نص الرسالة (Message Body):
```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>توثيق الحساب - Bazarko</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1320; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; direction: rtl; text-align: right; color: #e2e8f0;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b1320; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" max-width="560" style="max-width: 560px; background-color: #111d33; border: 1px solid #1e293b; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <!-- الترويسة مع الشعار -->
          <tr>
            <td style="padding: 35px 35px 20px; text-align: center; border-bottom: 1px solid #1e293b; background: linear-gradient(180deg, #162442 0%, #111d33 100%);">
              <img src="https://bazarko.app/images/bazarko-logo-mark.jpg" alt="Bazarko Logo" width="56" height="56" style="border-radius: 14px; display: inline-block; box-shadow: 0 4px 15px rgba(56, 189, 248, 0.25); border: 1px solid rgba(56, 189, 248, 0.4);" />
              <h1 style="margin: 12px 0 2px; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">بزاركو | Bazarko</h1>
              <p style="margin: 0; font-size: 12px; color: #38bdf8; font-weight: 600;">منظومة ERP السحابية المتكاملة</p>
            </td>
          </tr>

          <!-- صلب الرسالة -->
          <tr>
            <td style="padding: 35px 35px 25px; text-align: right;">
              <h2 style="margin: 0 0 12px; font-size: 19px; font-weight: 700; color: #f8fafc;">أهلاً بك في عائلة بزاركو 👋</h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.7; color: #94a3b8;">
                شكراً لانضمامك إلينا. لإكمال إنشاء حسابك وتأمينه، يرجى إدخال رمز التحقق التالي في شاشة التسجيل:
              </p>

              <!-- صندوق كود الـ OTP البارز -->
              <div style="background-color: #0a1120; border: 2px dashed #0284c7; border-radius: 16px; padding: 22px; text-align: center; margin: 25px 0;">
                <span style="display: block; font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">رمز التحقق الخاص بك (OTP)</span>
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 12px; color: #ffffff; text-shadow: 0 0 15px rgba(56,189,248,0.5); display: inline-block; padding-left: 12px;">{{ .Token }}</span>
              </div>

              <!-- تنبيهات الأمان والوقت -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 20px; background-color: rgba(2, 132, 199, 0.08); border-radius: 12px; padding: 12px 16px;">
                <tr>
                  <td style="font-size: 12px; color: #cbd5e1; line-height: 1.6;">
                    ⏱️ <strong>صلاحية الرمز:</strong> صالح لمدة <strong>10 دقائق</strong> فقط.<br>
                    🔒 <strong>أمان الحساب:</strong> لا تشارك هذا الرمز مع أي شخص، فريق بزاركو لن يطلبه منك أبداً.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- التوقيع وتذييل الصفحة -->
          <tr>
            <td style="padding: 25px 35px; background-color: #0a101d; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #cbd5e1;">فريق عمل منصة بزاركو</p>
              <p style="margin: 0 0 12px; font-size: 11px; color: #64748b;">كل ما يحتاجه عملك التجاري في مكان واحد</p>
              
              <div style="border-top: 1px solid #1e293b; padding-top: 12px; margin-top: 8px;">
                <a href="https://bazarko.app" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: none; margin: 0 8px;">زيارة المنصة</a>
                <span style="color: #475569;">•</span>
                <a href="https://bazarko.app/support" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: none; margin: 0 8px;">مركز المساعدة</a>
              </div>

              <p style="margin: 12px 0 0; font-size: 10px; color: #475569;">
                © 2026 Bazarko Inc. جميع الحقوق محفوظة.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
```

---

## 2. قالب استعادة ونسيان كلمة المرور (Reset Password)
**المسار في Supabase:**
`Authentication` -> `Email Templates` -> `Reset Password`

### العنوان (Subject):
```text
رمز استعادة كلمة المرور في بزاركو | {{ .Token }}
```

### نص الرسالة (Message Body):
```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>استعادة كلمة المرور - Bazarko</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1320; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; direction: rtl; text-align: right; color: #e2e8f0;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0b1320; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" max-width="560" style="max-width: 560px; background-color: #111d33; border: 1px solid #1e293b; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <!-- الترويسة مع الشعار -->
          <tr>
            <td style="padding: 35px 35px 20px; text-align: center; border-bottom: 1px solid #1e293b; background: linear-gradient(180deg, #162442 0%, #111d33 100%);">
              <img src="https://bazarko.app/images/bazarko-logo-mark.jpg" alt="Bazarko Logo" width="56" height="56" style="border-radius: 14px; display: inline-block; box-shadow: 0 4px 15px rgba(56, 189, 248, 0.25); border: 1px solid rgba(56, 189, 248, 0.4);" />
              <h1 style="margin: 12px 0 2px; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">بزاركو | Bazarko</h1>
              <p style="margin: 0; font-size: 12px; color: #38bdf8; font-weight: 600;">منظومة ERP السحابية المتكاملة</p>
            </td>
          </tr>

          <!-- صلب الرسالة -->
          <tr>
            <td style="padding: 35px 35px 25px; text-align: right;">
              <h2 style="margin: 0 0 12px; font-size: 19px; font-weight: 700; color: #f8fafc;">طلب إعادة تعيين كلمة المرور 🔑</h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.7; color: #94a3b8;">
                تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك المرتبط بالبريد (<span dir="ltr" style="color: #38bdf8;">{{ .Email }}</span>).<br>
                استخدم رمز التحقق التالي لتعيين كلمة مرور جديدة:
              </p>

              <!-- صندوق كود الـ OTP البارز -->
              <div style="background-color: #0a1120; border: 2px dashed #f59e0b; border-radius: 16px; padding: 22px; text-align: center; margin: 25px 0;">
                <span style="display: block; font-size: 11px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">رمز استعادة كلمة المرور</span>
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 12px; color: #ffffff; text-shadow: 0 0 15px rgba(245,158,11,0.5); display: inline-block; padding-left: 12px;">{{ .Token }}</span>
              </div>

              <!-- تنبيهات الأمان والوقت -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 20px; background-color: rgba(245, 158, 11, 0.08); border-radius: 12px; padding: 12px 16px;">
                <tr>
                  <td style="font-size: 12px; color: #cbd5e1; line-height: 1.6;">
                    ⏱️ <strong>صلاحية الرمز:</strong> صالح لمدة <strong>10 دقائق</strong> فقط.<br>
                    🛡️ <strong>إذا لم تطلب هذا:</strong> إذا لم تقم بطلب إعادة التعيين بنفسك، فيمكنك تجاهل هذا الإيميل بأمان، وستظل كلمة مرورك السابقة دون أي تغيير.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- التوقيع وتذييل الصفحة -->
          <tr>
            <td style="padding: 25px 35px; background-color: #0a101d; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #cbd5e1;">فريق أمان منصة بزاركو</p>
              <p style="margin: 0 0 12px; font-size: 11px; color: #64748b;">حماية وأمان بياناتك على رأس أولوياتنا</p>
              
              <div style="border-top: 1px solid #1e293b; padding-top: 12px; margin-top: 8px;">
                <a href="https://bazarko.app" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: none; margin: 0 8px;">زيارة المنصة</a>
                <span style="color: #475569;">•</span>
                <a href="https://bazarko.app/support" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: none; margin: 0 8px;">مركز المساعدة والدعم</a>
              </div>

              <p style="margin: 12px 0 0; font-size: 10px; color: #475569;">
                © 2026 Bazarko Inc. جميع الحقوق محفوظة.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
```
