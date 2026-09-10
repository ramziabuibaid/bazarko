/**
 * Palestinian Banks & Branches Directory (PMA - سلطة النقد الفلسطينية)
 * Fast 2-digit Bank Code & 3-digit Branch Code auto-recognition
 */

export interface PmaBranch {
  code: string; // 3-digit string e.g. "452"
  name: string; // e.g. "فرع جنين الرئيسي"
  city?: string;
}

export interface PmaBank {
  code: string; // 2-digit string e.g. "01"
  name: string; // e.g. "بنك فلسطين"
  nameEn?: string;
  branches: PmaBranch[];
}

export const PALESTINIAN_BANKS: PmaBank[] = [
  {
    code: '01',
    name: 'بنك فلسطين',
    nameEn: 'Bank of Palestine (BOP)',
    branches: [
      { code: '450', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '451', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '452', name: 'فرع جنين الرئيسي', city: 'جنين' },
      { code: '453', name: 'فرع طولكرم الرئيسي', city: 'طولكرم' },
      { code: '454', name: 'فرع الخليل الرئيسي', city: 'الخليل' },
      { code: '455', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '456', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '457', name: 'فرع أريحا', city: 'أريحا' },
      { code: '458', name: 'فرع سلفيت', city: 'سلفيت' },
      { code: '459', name: 'فرع طوباس', city: 'طوباس' },
      { code: '460', name: 'فرع غزة الرئيسي', city: 'غزة' },
      { code: '461', name: 'فرع رفح', city: 'رفح' },
      { code: '462', name: 'فرع خانيونس', city: 'خانيونس' },
      { code: '463', name: 'فرع دير البلح', city: 'دير البلح' },
      { code: '464', name: 'فرع الشمال - جباليا', city: 'جباليا' },
      { code: '465', name: 'فرع الماصيون - رام الله', city: 'رام الله' },
      { code: '466', name: 'فرع الإرسال - رام الله', city: 'رام الله' },
      { code: '467', name: 'فرع رفيديا - نابلس', city: 'نابلس' },
      { code: '468', name: 'فرع جامعة النجاح', city: 'نابلس' },
      { code: '469', name: 'فرع يعبد - جنين', city: 'جنين' },
      { code: '470', name: 'فرع قباطية - جنين', city: 'جنين' },
      { code: '471', name: 'فرع عتيل - طولكرم', city: 'طولكرم' },
      { code: '472', name: 'فرع عنبتا - طولكرم', city: 'طولكرم' },
      { code: '473', name: 'فرع يطا - الخليل', city: 'الخليل' },
      { code: '474', name: 'فرع حلحول - الخليل', city: 'الخليل' },
      { code: '475', name: 'فرع دورا - الخليل', city: 'الخليل' },
      { code: '476', name: 'فرع العيزرية - القدس', city: 'القدس' },
      { code: '477', name: 'فرع ضاحية البريد - القدس', city: 'القدس' },
      { code: '478', name: 'فرع الرام - القدس', city: 'القدس' }
    ]
  },
  {
    code: '02',
    name: 'البنك العربي',
    nameEn: 'Arab Bank',
    branches: [
      { code: '101', name: 'فرع رام الله الرئيسي - المنارة', city: 'رام الله' },
      { code: '102', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '103', name: 'فرع جنين', city: 'جنين' },
      { code: '104', name: 'فرع الخليل الرئيسي - عين سارة', city: 'الخليل' },
      { code: '105', name: 'فرع بيت لحم - باب الدير', city: 'بيت لحم' },
      { code: '106', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '107', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '108', name: 'فرع أريحا', city: 'أريحا' },
      { code: '109', name: 'فرع البيرة', city: 'البيرة' },
      { code: '110', name: 'فرع رفيديا - نابلس', city: 'نابلس' },
      { code: '111', name: 'فرع غزة - الرمال', city: 'غزة' },
      { code: '112', name: 'فرع خانيونس', city: 'خانيونس' },
      { code: '113', name: 'فرع القدس - شارع صلاح الدين', city: 'القدس' },
      { code: '114', name: 'فرع الماصيون - رام الله', city: 'رام الله' }
    ]
  },
  {
    code: '03',
    name: 'بنك القدس',
    nameEn: 'Quds Bank',
    branches: [
      { code: '201', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '202', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '203', name: 'فرع جنين الرئيسي', city: 'جنين' },
      { code: '204', name: 'فرع الخليل', city: 'الخليل' },
      { code: '205', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '206', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '207', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '208', name: 'فرع أريحا', city: 'أريحا' },
      { code: '209', name: 'فرع سلفيت', city: 'سلفيت' },
      { code: '210', name: 'فرع طوباس', city: 'طوباس' },
      { code: '211', name: 'فرع غزة - الرمال', city: 'غزة' },
      { code: '212', name: 'فرع خانيونس', city: 'خانيونس' },
      { code: '213', name: 'فرع البيرة', city: 'البيرة' },
      { code: '214', name: 'فرع يعبد', city: 'جنين' }
    ]
  },
  {
    code: '04',
    name: 'البنك الإسلامي الفلسطيني',
    nameEn: 'Palestine Islamic Bank (PIB)',
    branches: [
      { code: '301', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '302', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '303', name: 'فرع جنين الرئيسي', city: 'جنين' },
      { code: '304', name: 'فرع الخليل الرئيسي', city: 'الخليل' },
      { code: '305', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '306', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '307', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '308', name: 'فرع سلفيت', city: 'سلفيت' },
      { code: '309', name: 'فرع طوباس', city: 'طوباس' },
      { code: '310', name: 'فرع أريحا', city: 'أريحا' },
      { code: '311', name: 'فرع غزة الرئيسي', city: 'غزة' },
      { code: '312', name: 'فرع خانيونس', city: 'خانيونس' },
      { code: '313', name: 'فرع رفح', city: 'رفح' },
      { code: '314', name: 'فرع البيرة - البالوع', city: 'البيرة' },
      { code: '315', name: 'فرع رفيديا - نابلس', city: 'نابلس' },
      { code: '316', name: 'فرع دورا - الخليل', city: 'الخليل' },
      { code: '317', name: 'فرع حلحول - الخليل', city: 'الخليل' }
    ]
  },
  {
    code: '05',
    name: 'البنك الإسلامي العربي',
    nameEn: 'Arab Islamic Bank (AIB)',
    branches: [
      { code: '350', name: 'فرع البيرة الرئيسي', city: 'البيرة' },
      { code: '351', name: 'فرع رام الله - المنارة', city: 'رام الله' },
      { code: '352', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '353', name: 'فرع جنين الرئيسي', city: 'جنين' },
      { code: '354', name: 'فرع الخليل الرئيسي', city: 'الخليل' },
      { code: '355', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '356', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '357', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '358', name: 'فرع أريحا', city: 'أريحا' },
      { code: '359', name: 'فرع طوباس', city: 'طوباس' },
      { code: '360', name: 'فرع غزة - الرمال', city: 'غزة' },
      { code: '361', name: 'فرع خانيونس', city: 'خانيونس' },
      { code: '362', name: 'فرع رفح', city: 'رفح' },
      { code: '363', name: 'فرع يعبد', city: 'جنين' },
      { code: '364', name: 'فرع عتيل', city: 'طولكرم' }
    ]
  },
  {
    code: '06',
    name: 'بنك القاهرة عمان',
    nameEn: 'Cairo Amman Bank',
    branches: [
      { code: '401', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '402', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '403', name: 'فرع جنين', city: 'جنين' },
      { code: '404', name: 'فرع الخليل', city: 'الخليل' },
      { code: '405', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '406', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '407', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '408', name: 'فرع أريحا', city: 'أريحا' },
      { code: '409', name: 'فرع غزة', city: 'غزة' },
      { code: '410', name: 'فرع خانيونس', city: 'خانيونس' }
    ]
  },
  {
    code: '07',
    name: 'بنك الاستثمار الفلسطيني',
    nameEn: 'Palestine Investment Bank (PIBC)',
    branches: [
      { code: '501', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '502', name: 'فرع نابلس', city: 'نابلس' },
      { code: '503', name: 'فرع جنين', city: 'جنين' },
      { code: '504', name: 'فرع الخليل', city: 'الخليل' },
      { code: '505', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '506', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '507', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '508', name: 'فرع غزة', city: 'غزة' }
    ]
  },
  {
    code: '08',
    name: 'بنك الأردن',
    nameEn: 'Bank of Jordan',
    branches: [
      { code: '601', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '602', name: 'فرع نابلس', city: 'نابلس' },
      { code: '603', name: 'فرع جنين', city: 'جنين' },
      { code: '604', name: 'فرع الخليل', city: 'الخليل' },
      { code: '605', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '606', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '607', name: 'فرع أريحا', city: 'أريحا' },
      { code: '608', name: 'فرع غزة', city: 'غزة' }
    ]
  },
  {
    code: '09',
    name: 'البنك الوطني',
    nameEn: 'The National Bank (TNB)',
    branches: [
      { code: '701', name: 'فرع رام الله الرئيسي - الإرسال', city: 'رام الله' },
      { code: '702', name: 'فرع نابلس الرئيسي', city: 'نابلس' },
      { code: '703', name: 'فرع جنين', city: 'جنين' },
      { code: '704', name: 'فرع الخليل', city: 'الخليل' },
      { code: '705', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '706', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '707', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '708', name: 'فرع سلفيت', city: 'سلفيت' },
      { code: '709', name: 'فرع طوباس', city: 'طوباس' },
      { code: '710', name: 'فرع ضاحية الرام - القدس', city: 'القدس' },
      { code: '711', name: 'فرع العيزرية - القدس', city: 'القدس' },
      { code: '712', name: 'فرع غزة', city: 'غزة' }
    ]
  },
  {
    code: '10',
    name: 'بنك الإسكان للتجارة والتمويل',
    nameEn: 'Housing Bank for Trade & Finance',
    branches: [
      { code: '801', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '802', name: 'فرع نابلس', city: 'نابلس' },
      { code: '803', name: 'فرع جنين', city: 'جنين' },
      { code: '804', name: 'فرع الخليل', city: 'الخليل' },
      { code: '805', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '806', name: 'فرع طولكرم', city: 'طولكرم' },
      { code: '807', name: 'فرع قلقيلية', city: 'قلقيلية' },
      { code: '808', name: 'فرع غزة', city: 'غزة' }
    ]
  },
  {
    code: '12',
    name: 'البنك العقاري المصري العربي',
    nameEn: 'Egyptian Arab Land Bank',
    branches: [
      { code: '851', name: 'فرع رام الله', city: 'رام الله' },
      { code: '852', name: 'فرع نابلس', city: 'نابلس' },
      { code: '853', name: 'فرع جنين', city: 'جنين' },
      { code: '854', name: 'فرع بيت لحم', city: 'بيت لحم' },
      { code: '855', name: 'فرع أريحا', city: 'أريحا' }
    ]
  },
  {
    code: '13',
    name: 'البنك الأهلي الأردني',
    nameEn: 'Jordan Ahli Bank',
    branches: [
      { code: '901', name: 'فرع رام الله', city: 'رام الله' },
      { code: '902', name: 'فرع نابلس', city: 'نابلس' },
      { code: '903', name: 'فرع الخليل', city: 'الخليل' },
      { code: '904', name: 'فرع بيت لحم', city: 'بيت لحم' }
    ]
  },
  {
    code: '20',
    name: 'مصرف الصفا',
    nameEn: 'Safa Bank',
    branches: [
      { code: '951', name: 'فرع رام الله الرئيسي', city: 'رام الله' },
      { code: '952', name: 'فرع نابلس', city: 'نابلس' },
      { code: '953', name: 'فرع جنين', city: 'جنين' },
      { code: '954', name: 'فرع الخليل', city: 'الخليل' },
      { code: '955', name: 'فرع طولكرم', city: 'طولكرم' }
    ]
  },
  {
    code: '31',
    name: 'بنك لئومي / بنك أجنبي',
    nameEn: 'Bank Leumi',
    branches: [
      { code: '001', name: 'الفرع الرئيسي', city: 'القدس' }
    ]
  }
];

/**
 * Normalize bank code (e.g. "1" -> "01", "01" -> "01")
 */
export function normalizeBankCode(code: string | number | undefined | null): string {
  if (!code) return '';
  const clean = String(code).trim().replace(/[^0-9]/g, '');
  if (!clean) return '';
  return clean.length === 1 ? `0${clean}` : clean.slice(-2);
}

/**
 * Normalize branch code (e.g. "45" -> "045", "452" -> "452")
 */
export function normalizeBranchCode(code: string | number | undefined | null): string {
  if (!code) return '';
  const clean = String(code).trim().replace(/[^0-9]/g, '');
  if (!clean) return '';
  if (clean.length === 1) return `00${clean}`;
  if (clean.length === 2) return `0${clean}`;
  return clean;
}

/**
 * Find Bank by 2-digit Code or 1-digit
 */
export function getPmaBankByCode(rawCode: string | number | undefined | null): PmaBank | null {
  const code = normalizeBankCode(rawCode);
  if (!code) return null;
  return PALESTINIAN_BANKS.find(b => b.code === code || Number(b.code) === Number(code)) || null;
}

/**
 * Find Branch by Bank Code and Branch Code
 */
export function getPmaBranchByCode(
  rawBankCode: string | number | undefined | null,
  rawBranchCode: string | number | undefined | null
): PmaBranch | null {
  const bank = getPmaBankByCode(rawBankCode);
  if (!bank || !rawBranchCode) return null;
  const branchCode = String(rawBranchCode).trim().replace(/[^0-9]/g, '');
  if (!branchCode) return null;

  return bank.branches.find(
    br => br.code === branchCode || Number(br.code) === Number(branchCode) || br.code.endsWith(branchCode)
  ) || null;
}

/**
 * Match or search banks by name or code
 */
export function searchPmaBanks(query: string): PmaBank[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return PALESTINIAN_BANKS;
  return PALESTINIAN_BANKS.filter(
    b => b.code.includes(q) || b.name.toLowerCase().includes(q) || (b.nameEn && b.nameEn.toLowerCase().includes(q))
  );
}
