import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

interface OfferEmailItem {
  name: string
  price: number
  offer_price: number
}

interface SendOfferEmailParams {
  to: string
  customerName: string
  storeName: string
  offerTitle: string
  offerDescription?: string | null
  endsAt: string
  currencyCode: string
  offerUrl: string
  items: OfferEmailItem[]
}

function buildOfferEmailHtml(p: SendOfferEmailParams): string {
  const endsText = new Date(p.endsAt).toLocaleDateString('ar', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  const maxDiscount = Math.max(
    0,
    ...p.items.filter(i => i.price > 0).map(i => Math.round((1 - i.offer_price / i.price) * 100))
  )

  const itemsRows = p.items.slice(0, 6).map(item => {
    const pct = item.price > 0 ? Math.round((1 - item.offer_price / item.price) * 100) : 0
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151">${item.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#9ca3af;text-align:left;text-decoration:line-through" dir="ltr">${item.price.toLocaleString('ar')} ${p.currencyCode}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700;color:#dc2626;text-align:left" dir="ltr">${item.offer_price.toLocaleString('ar')} ${p.currencyCode}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:center"><span style="background:#fee2e2;color:#dc2626;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px">-${pct}%</span></td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.offerTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;direction:rtl">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#ea580c,#dc2626,#e11d48);padding:36px 32px;text-align:center">
    <p style="margin:0;font-size:12px;letter-spacing:3px;color:rgba(255,255,255,0.85);text-transform:uppercase">${p.storeName}</p>
    ${maxDiscount > 0 ? `<p style="margin:12px 0 0;display:inline-block;background:rgba(255,255,255,0.2);color:#ffffff;font-size:13px;font-weight:700;padding:4px 14px;border-radius:999px">🔥 خصومات حتى ${maxDiscount}%</p>` : ''}
    <h1 style="margin:12px 0 0;font-size:26px;color:#ffffff;font-weight:800">${p.offerTitle}</h1>
    ${p.offerDescription ? `<p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.85)">${p.offerDescription}</p>` : ''}
  </div>

  <!-- Body -->
  <div style="padding:28px 32px">
    <p style="margin:0 0 20px;font-size:15px;color:#374151">
      أهلاً <strong>${p.customerName}</strong>،<br>
      لدينا عرض حصري لفترة محدودة — لا تفوّته!
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">المنتج</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">السعر</th>
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">سعر العرض</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600">الخصم</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>
    ${p.items.length > 6 ? `<p style="margin:10px 0 0;font-size:13px;color:#6b7280;text-align:center">+ ${p.items.length - 6} منتجات أخرى ضمن العرض</p>` : ''}

    <!-- Deadline -->
    <div style="margin-top:20px;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;text-align:center">
      <p style="margin:0;font-size:13px;color:#991b1b">⏰ العرض ينتهي: <strong>${endsText}</strong></p>
    </div>

    <!-- CTA -->
    <div style="margin-top:24px;text-align:center">
      <a href="${p.offerUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:15px;font-weight:700">
        تسوق العرض الآن →
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#9ca3af">
      وصلك هذا الإيميل لأنك زبون لدى <strong>${p.storeName}</strong> — مدعوم من <strong>Bazarko</strong>
    </p>
  </div>
</div>
</body>
</html>`
}

export async function sendOfferEmail(params: SendOfferEmailParams): Promise<boolean> {
  if (!resend || !params.to) return false

  try {
    await resend.emails.send({
      from: `${params.storeName} <offers@bazarko.app>`,
      to: params.to,
      subject: `🔥 ${params.offerTitle} — ${params.storeName}`,
      html: buildOfferEmailHtml(params),
    })
    return true
  } catch {
    console.error('[email] failed to send offer email')
    return false
  }
}
