export function normalizeArabicText(text: string): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\-_/\\,.]/g, ' ')
}

export function allowedQuantity(quantity:number,max:number|null){return Number.isFinite(quantity)&&Number.isInteger(quantity)&&quantity>=0&&(max===null||quantity<=max)}
export function cashChange(total:number,tender:string){const received=tender===''?total:Number(tender);return {received,valid:Number.isFinite(received)&&received>=total,change:Number.isFinite(received)?Math.max(0,received-total):0}}
export function matchesProduct(p:{name:string;sku:string|null;barcode?:string|null},query:string){
  const q = (query || '').trim()
  if (!q) return true
  const tokens = normalizeArabicText(q).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const target = normalizeArabicText(`${p.name} ${p.sku || ''} ${p.barcode || ''}`)
  return tokens.every(token => target.includes(token))
}
