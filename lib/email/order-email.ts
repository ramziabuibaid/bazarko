import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

interface OrderItem {
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
}

interface SendOrderEmailParams {
  to: string
  customerName: string
  storeName: string
  orderNumber: string
  items: OrderItem[]
  subtotal: number
  totalAmount: number
  paymentMethod: string
  currencyCode: string
  trackingUrl?: string
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقداً عند الاستلام',
  bank_transfer: 'تحويل بنكي',
  check: 'شيك',
  online: 'دفع إلكتروني',
  credit: 'آجل',
}

function buildEmailHtml(p: SendOrderEmailParams): string {
  const itemsRows = p.items.map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151">${item.product_name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151;text-align:center">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151;text-align:left" dir="ltr">${item.unit_price.toLocaleString('ar-u-nu-latn')} ${p.currencyCode}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;color:#111827;text-align:left" dir="ltr">${item.total_price.toLocaleString('ar-u-nu-latn')} ${p.currencyCode}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تأكيد الطلب ${p.orderNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;direction:rtl">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

  <!-- Header -->
  <div style="background:#0f172a;padding:28px 32px;text-align:center">
    <p style="margin:0;font-size:12px;letter-spacing:3px;color:#38bdf8;text-transform:uppercase">Bazarko</p>
    <h1 style="margin:8px 0 0;font-size:24px;color:#ffffff;font-weight:700">${p.storeName}</h1>
  </div>

  <!-- Status Banner -->
  <div style="background:#ecfdf5;border-bottom:1px solid #d1fae5;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:16px;color:#065f46;font-weight:600">✅ تم استلام طلبك بنجاح</p>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280">رقم الطلبية: <strong dir="ltr">${p.orderNumber}</strong></p>
  </div>

  <!-- Body -->
  <div style="padding:28px 32px">
    <p style="margin:0 0 20px;font-size:15px;color:#374151">
      أهلاً <strong>${p.customerName}</strong>،<br>
      شكراً لطلبك من <strong>${p.storeName}</strong>. فيما يلي تفاصيل طلبك:
    </p>

    <!-- Items Table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">المنتج</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600">الكمية</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">السعر</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <!-- Total -->
    <div style="margin-top:16px;padding:16px;background:#f9fafb;border-radius:12px;text-align:left" dir="ltr">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;color:#6b7280">المجموع الجزئي</span>
        <span style="font-size:13px;color:#374151">${p.subtotal.toLocaleString('ar-u-nu-latn')} ${p.currencyCode}</span>
      </div>
      <div style="padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between">
        <span style="font-size:16px;font-weight:700;color:#111827">الإجمالي</span>
        <span style="font-size:16px;font-weight:700;color:#111827">${p.totalAmount.toLocaleString('ar-u-nu-latn')} ${p.currencyCode}</span>
      </div>
    </div>

    <!-- Payment Method -->
    <div style="margin-top:16px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px">
      <span style="font-size:13px;color:#6b7280">طريقة الدفع: </span>
      <span style="font-size:13px;font-weight:600;color:#374151">${PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod}</span>
    </div>

    ${p.trackingUrl ? `
    <!-- Tracking Button -->
    <div style="margin-top:24px;text-align:center">
      <a href="${p.trackingUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:600">
        تتبع طلبيتك →
      </a>
    </div>
    ` : ''}

    <p style="margin-top:24px;font-size:14px;color:#6b7280">
      سنقوم بالتواصل معك لتأكيد الطلبية في أقرب وقت.
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#9ca3af">
      مدعوم من <strong>Bazarko</strong> — منصة إدارة الأعمال
    </p>
  </div>
</div>
</body>
</html>`
}

export async function sendOrderEmail(params: SendOrderEmailParams & { idempotencyKey?: string }): Promise<boolean> {
  if (!resend || !params.to) return false

  try {
    const result = await resend.emails.send({
      from: `${params.storeName} <orders@bazarko.app>`,
      to: params.to,
      subject: `✅ تأكيد طلبيتك ${params.orderNumber} — ${params.storeName}`,
      html: buildEmailHtml(params),
    }, { idempotencyKey: params.idempotencyKey })
    return !result.error
  } catch {
    // لا نوقف العملية إذا فشل الإيميل
    console.error('[email] failed to send order email')
    return false
  }
}
