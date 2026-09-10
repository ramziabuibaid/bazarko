/**
 * Arabic Tafqeet (Number to Arabic Words) Utility
 * Converts numeric amounts into formal written Arabic text with currency support.
 */

const ones: string[] = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر'
];

const tens: string[] = [
  '',
  '',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون'
];

const hundreds: string[] = [
  '',
  'مائة',
  'مئتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة'
];

function convertThreeDigits(num: number): string {
  let result = '';

  const h = Math.floor(num / 100);
  const remainder = num % 100;

  if (h > 0) {
    result += hundreds[h];
  }

  if (remainder > 0) {
    if (result) result += ' و';

    if (remainder < 20) {
      result += ones[remainder];
    } else {
      const o = remainder % 10;
      const t = Math.floor(remainder / 10);
      if (o > 0) {
        result += ones[o] + ' و' + tens[t];
      } else {
        result += tens[t];
      }
    }
  }

  return result;
}

export function numberToArabicWords(amount: number): string {
  if (amount === 0) return 'صفر';
  if (isNaN(amount) || amount < 0) return '';

  const integerPart = Math.floor(amount);
  const decimalPart = Math.round((amount - integerPart) * 100);

  if (integerPart === 0 && decimalPart === 0) return 'صفر';

  const billions = Math.floor(integerPart / 1_000_000_000);
  const millions = Math.floor((integerPart % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((integerPart % 1_000_000) / 1_000);
  const rest = integerPart % 1_000;

  const parts: string[] = [];

  // Billions
  if (billions > 0) {
    if (billions === 1) parts.push('مليار');
    else if (billions === 2) parts.push('ملياران');
    else if (billions >= 3 && billions <= 10) parts.push(`${convertThreeDigits(billions)} مليارات`);
    else parts.push(`${convertThreeDigits(billions)} مليار`);
  }

  // Millions
  if (millions > 0) {
    if (millions === 1) parts.push('مليون');
    else if (millions === 2) parts.push('مليونان');
    else if (millions >= 3 && millions <= 10) parts.push(`${convertThreeDigits(millions)} ملايين`);
    else parts.push(`${convertThreeDigits(millions)} مليون`);
  }

  // Thousands
  if (thousands > 0) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else if (thousands >= 3 && thousands <= 10) parts.push(`${convertThreeDigits(thousands)} آلاف`);
    else parts.push(`${convertThreeDigits(thousands)} ألف`);
  }

  // Rest (Hundreds, tens, ones)
  if (rest > 0) {
    parts.push(convertThreeDigits(rest));
  }

  let words = parts.join(' و');

  return words;
}

export interface CurrencyConfig {
  name: string;
  subunit: string;
  namePlural?: string;
  subunitPlural?: string;
}

const currencies: Record<string, CurrencyConfig> = {
  ILS: {
    name: 'شيكل إسرائيلي',
    namePlural: 'شواكل',
    subunit: 'أغورة',
    subunitPlural: 'أغورات'
  },
  USD: {
    name: 'دولار أمريكي',
    namePlural: 'دولارات',
    subunit: 'سنت',
    subunitPlural: 'سنتات'
  },
  JOD: {
    name: 'دينار أردني',
    namePlural: 'دنانير',
    subunit: 'قرش',
    subunitPlural: 'قروش'
  },
  EUR: {
    name: 'يورو',
    namePlural: 'يورو',
    subunit: 'سنت',
    subunitPlural: 'سنتات'
  }
};

/**
 * Full Cheque Tafqeet format
 * e.g. "فقط خمسة آلاف وأربعمائة وخمسون شيكل إسرائيلي لا غير"
 */
export function tafqeetCheque(amount: number, currencyCode: string = 'ILS'): string {
  const num = Number(amount || 0);
  if (isNaN(num) || num <= 0) return 'صفر';

  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);

  const curr = currencies[currencyCode.toUpperCase()] || {
    name: currencyCode,
    subunit: 'جزء'
  };

  const intWords = numberToArabicWords(integerPart);
  let result = `فقط ${intWords} ${curr.name}`;

  if (decimalPart > 0) {
    const decWords = numberToArabicWords(decimalPart);
    result += ` و${decWords} ${curr.subunit}`;
  }

  result += ' لا غير';
  return result;
}

export const tafqeet = tafqeetCheque;
export default tafqeetCheque;
