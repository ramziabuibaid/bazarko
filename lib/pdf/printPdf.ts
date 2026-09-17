'use client'

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export interface PrintPdfOptions {
  elementId?: string
  element?: HTMLElement | null
  filename?: string
  format?: 'a4' | 'thermal'
  action?: 'print' | 'download' | 'open'
}

/**
 * محرك موحد لإنشاء وطباعة مستندات الـ PDF الرسمية (الفواتير، العروض، إيصالات POS)
 * يقوم بتحويل العنصر إلى PDF عالي الدقة ثم تنفيذ الطباعة من ملف الـ PDF لمنع الشاشة البيضاء.
 */
export async function generateAndPrintPdf({
  elementId,
  element,
  filename = 'document.pdf',
  format = 'a4',
  action = 'print',
}: PrintPdfOptions): Promise<boolean> {
  try {
    const target = element || (elementId ? document.getElementById(elementId) : null)
    if (!target) {
      console.warn('PDF target element not found, falling back to window.print()')
      window.print()
      return false
    }

    // التقاط العنصر عبر Canvas بخلفية بيضاء نقية
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      onclone: (clonedDoc) => {
        // التأكد من إزالة أي كلاسات مخفية أو ألوان داكنة
        const clonedEl = elementId ? clonedDoc.getElementById(elementId) : null
        if (clonedEl) {
          clonedEl.style.backgroundColor = '#ffffff'
          clonedEl.style.color = '#0f172a'
        }
      },
    })

    const imgData = canvas.toDataURL('image/png')

    let doc: jsPDF

    if (format === 'thermal') {
      // إيصال حراري 80mm
      const widthMm = 80
      const heightMm = Math.max(100, (canvas.height * widthMm) / canvas.width)
      doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [widthMm, heightMm],
      })
      doc.addImage(imgData, 'PNG', 0, 0, widthMm, heightMm)
    } else {
      // ورق A4 رسمي (210 x 297 mm)
      doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      })
      const pdfWidth = doc.internal.pageSize.getWidth()
      const pdfHeight = doc.internal.pageSize.getHeight()
      const imgWidth = pdfWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      if (imgHeight <= pdfHeight) {
        doc.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight)
      } else {
        // دعم الصفحات المتعددة إن كانت الفاتورة طويلة
        let heightLeft = imgHeight
        let position = 0

        doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pdfHeight

        while (heightLeft > 0) {
          position = heightLeft - imgHeight
          doc.addPage()
          doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
          heightLeft -= pdfHeight
        }
      }
    }

    if (action === 'download') {
      doc.save(filename)
      return true
    }

    const pdfBlob = doc.output('blob')
    const blobUrl = URL.createObjectURL(pdfBlob)

    if (action === 'open') {
      window.open(blobUrl, '_blank')
      return true
    }

    // تنفيذ الطباعة من ملف الـ PDF عبر iframe معزول لمنع الشاشة البيضاء
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.src = blobUrl

    document.body.appendChild(iframe)

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
        } catch (e) {
          window.open(blobUrl, '_blank')
        }
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe)
          }
          URL.revokeObjectURL(blobUrl)
        }, 60000)
      }, 300)
    }

    return true
  } catch (err) {
    console.error('Error generating PDF:', err)
    window.print()
    return false
  }
}
