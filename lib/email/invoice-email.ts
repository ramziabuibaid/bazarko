import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

interface InvoiceItem {
  name: string
  quantity: number
  unit_price: number
  total: number
}

interface SendInvoiceEmailParams {
  to: string
  customerName: string
  storeName: string
  storePhone: string | null
  invoiceNumber: string
  issueDate: string
  dueDate: string | null
  items: InvoiceItem[]
  subtotal: number
  discountAmount: number
  total: number
  amountPaid: number
  currencyCode: string
}

function buildInvoiceHtml(p: SendInvoiceEmailParams): string {
  const remaining = Math.max(0, p.total - p.amountPaid)
  const fmt = (n: number) => n.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 2 })

  const itemsRows = p.items.map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151">${item.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151;text-align:center">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151;text-align:left" dir="ltr">${fmt(item.unit_price)} ${p.currencyCode}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;color:#111827;text-align:left" dir="ltr">${fmt(item.total)} ${p.currencyCode}</td>
    </tr>
  `).join('')

  const dueDateRow = p.dueDate ? `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:13px;color:#6b7280">تاريخ الاستحقاق</span>
      <span style="font-size:13px;color:#374151" dir="ltr">${new Date(p.dueDate).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
    </div>
  ` : ''

  const remainingRow = remaining > 0 ? `
    <div style="padding-top:10px;border-top:2px solid #fbbf24;display:flex;justify-content:space-between;margin-top:10px">
      <span style="font-size:15px;font-weight:700;color:#b45309">المبلغ المتبقي</span>
      <span style="font-size:15px;font-weight:700;color:#b45309" dir="ltr">${fmt(remaining)} ${p.currencyCode}</span>
    </div>
  ` : `
    <div style="padding-top:10px;border-top:1px solid #d1fae5;display:flex;justify-content:space-between;margin-top:10px">
      <span style="font-size:13px;color:#065f46;font-weight:600">✅ مدفوعة بالكامل</span>
    </div>
  `

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>فاتورة ${p.invoiceNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;direction:rtl">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

  <!-- Header -->
  <div style="background:#0f172a;padding:28px 32px;text-align:center">
    <p style="margin:0;font-size:12px;letter-spacing:3px;color:#38bdf8;text-transform:uppercase">Bazarko</p>
    <h1 style="margin:8px 0 0;font-size:24px;color:#ffffff;font-weight:700">${p.storeName}</h1>
  </div>

  <!-- Invoice Banner -->
  <div style="background:#eff6ff;border-bottom:1px solid #bfdbfe;padding:16px 32px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <p style="margin:0;font-size:13px;color:#6b7280">رقم الفاتورة</p>
        <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#1e3a8a" dir="ltr">${p.invoiceNumber}</p>
      </div>
      <div style="text-align:left">
        <p style="margin:0;font-size:13px;color:#6b7280">تاريخ الإصدار</p>
        <p style="margin:4px 0 0;font-size:14px;color:#374151" dir="ltr">${new Date(p.issueDate).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:28px 32px">
    <p style="margin:0 0 24px;font-size:15px;color:#374151">
      أهلاً <strong>${p.customerName}</strong>،<br>
      يسعدنا إرسال فاتورتك من <strong>${p.storeName}</strong>.
    </p>

    <!-- Items Table -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">البيان</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600">الكمية</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">السعر</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <!-- Totals -->
    <div style="margin-top:16px;padding:16px;background:#f9fafb;border-radius:12px" dir="ltr">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px;color:#6b7280">المجموع الجزئي</span>
        <span style="font-size:13px;color:#374151">${fmt(p.subtotal)} ${p.currencyCode}</span>
      </div>
      ${p.discountAmount > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px;color:#6b7280">الخصم</span>
        <span style="font-size:13px;color:#dc2626">- ${fmt(p.discountAmount)} ${p.currencyCode}</span>
      </div>
      ` : ''}
      <div style="padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between">
        <span style="font-size:16px;font-weight:700;color:#111827">الإجمالي</span>
        <span style="font-size:16px;font-weight:700;color:#111827">${fmt(p.total)} ${p.currencyCode}</span>
      </div>
      ${p.amountPaid > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:13px;color:#6b7280">المدفوع</span>
        <span style="font-size:13px;color:#059669">- ${fmt(p.amountPaid)} ${p.currencyCode}</span>
      </div>
      ` : ''}
      ${remainingRow}
    </div>

    <!-- Dates -->
    ${dueDateRow ? `
    <div style="margin-top:16px;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px" dir="ltr">
      ${dueDateRow}
    </div>
    ` : ''}

    ${p.storePhone ? `
    <p style="margin-top:24px;font-size:14px;color:#6b7280">
      للتواصل: <strong dir="ltr">${p.storePhone}</strong>
    </p>
    ` : ''}
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

export async function sendInvoiceEmail(params: SendInvoiceEmailParams): Promise<void> {
  if (!resend || !params.to) return

  try {
    await resend.emails.send({
      from: `${params.storeName} <invoices@bazarko.app>`,
      to: params.to,
      subject: `فاتورة ${params.invoiceNumber} من ${params.storeName}`,
      html: buildInvoiceHtml(params),
    })
  } catch {
    console.error('[email] failed to send invoice email')
  }
}
