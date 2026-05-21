export type Country = {
  code: string;
  name_ar: string;
  name_en: string;
  currency_code: string;
  currency_symbol: string;
  domain_prefix: string;
};

const countries: Country[] = [
  {
    code: 'PS',
    name_ar: 'فلسطين',
    name_en: 'Palestine',
    currency_code: 'ILS',
    currency_symbol: '₪',
    domain_prefix: 'ps'
  },
  {
    code: 'SY',
    name_ar: 'سوريا',
    name_en: 'Syria',
    currency_code: 'SYP',
    currency_symbol: 'ل.س',
    domain_prefix: 'sy'
  }
];

export function getCountryByCode(code: string) {
  return countries.find((country) => country.code.toLowerCase() === code.toLowerCase() || country.domain_prefix === code.toLowerCase());
}

export function getAllCountries() {
  return countries;
}
