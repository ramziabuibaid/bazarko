import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function parseEnv(path: string) {
  const content = fs.readFileSync(path, 'utf8');
  const res: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = (match[2] || '').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      res[match[1]] = val;
    }
  }
  return res;
}

const STORE_ID = '745b94f5-6d9c-43cc-a079-96b370b01a45';

const mktEnv = parseEnv('.env.local');
const mkt = createClient(mktEnv.NEXT_PUBLIC_SUPABASE_URL, mktEnv.SUPABASE_SERVICE_ROLE_KEY);

const myshopEnv = parseEnv('/Users/iquik/Developer/myshop/.env.local');
const myshop = createClient(myshopEnv.NEXT_PUBLIC_SUPABASE_URL, myshopEnv.SUPABASE_SERVICE_ROLE_KEY);

function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\w\s\u0621-\u064A]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractModelCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  // Extract alphanumeric tokens like CR-5097, 5304, QL32SW, or sequences of digits >= 3 digits
  const tokens = text.match(/[a-zA-Z0-9]{3,}/g) || [];
  return Array.from(new Set(tokens.map(t => t.toLowerCase())));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s\-_]+/g, '-')
    .replace(/[^\w\u0621-\u064A\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '') || 'item-' + Math.random().toString(36).substring(2, 7);
}

function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  let clean = url.trim();
  if (!clean) return null;

  // If path like Products_Images/PRD-0074.Image.130334.jpg
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    if (clean.startsWith('Products_Images/')) {
      const fileName = clean.replace('Products_Images/', '');
      clean = `https://db.almnarhome.com/storage/v1/object/public/products/${fileName}`;
    } else {
      clean = `https://db.almnarhome.com/storage/v1/object/public/products/${clean.replace(/^\/+/, '')}`;
    }
  }

  // Replace internal Tailscale DNS with public SSL hostname
  clean = clean.replace('homeserver.tail59a1fd.ts.net', 'db.almnarhome.com');

  return clean;
}

function extractAllImages(m: any): string[] {
  const rawList = [
    m.image_url,
    m.image_url_2,
    m.image_url_3,
    m.image,
    m.image_2,
    m.image_3
  ];

  const seen = new Set<string>();
  const images: string[] = [];

  for (const raw of rawList) {
    const normalized = normalizeImageUrl(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      images.push(normalized);
    }
  }

  return images;
}

function buildSpecifications(m: any): Array<{ key: string; value: string }> {
  const specs: Array<{ key: string; value: string }> = [];

  if (m.type && m.type.trim()) specs.push({ key: 'النوع', value: m.type.trim() });
  if (m.brand && m.brand.trim()) specs.push({ key: 'العلامة التجارية', value: m.brand.trim() });
  if (m.size && m.size.trim()) specs.push({ key: 'الحجم', value: m.size.trim() });
  if (m.color && m.color.trim()) specs.push({ key: 'اللون', value: m.color.trim() });
  if (m.origin && m.origin.trim()) specs.push({ key: 'بلد المنشأ', value: m.origin.trim() });
  if (m.warranty && m.warranty.trim()) specs.push({ key: 'الكفالة', value: m.warranty.trim() });
  if (m.dimention && m.dimention.trim()) specs.push({ key: 'الأبعاد', value: m.dimention.trim() });

  if (Array.isArray(m.specifications)) {
    for (const item of m.specifications) {
      if (item && item.key && item.value) {
        // avoid duplicate keys
        if (!specs.some(s => s.key === item.key)) {
          specs.push({ key: item.key.trim(), value: String(item.value).trim() });
        }
      }
    }
  }

  return specs;
}

async function runEnrichment() {
  console.log('--- STARTING ENRICHMENT FOR ALMNARJ ---');

  // 1. Fetch Bazarko products for almnarj
  let allBazarko: any[] = [];
  let page = 0;
  const pageSize = 500;
  while (true) {
    const { data, error } = await mkt
      .from('products')
      .select('id, name, sku, store_id, thumbnail_url, images, specifications, category_id, brand_id')
      .eq('store_id', STORE_ID)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allBazarko = allBazarko.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`Loaded ${allBazarko.length} products from Bazarko for store ${STORE_ID}`);

  // 2. Fetch Myshop products
  let allMyshop: any[] = [];
  page = 0;
  while (true) {
    const { data, error } = await myshop
      .from('products')
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allMyshop = allMyshop.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  console.log(`Loaded ${allMyshop.length} products from Myshop`);

  // Index Myshop products
  interface MyshopIndexed {
    raw: any;
    normName: string;
    typeNorm: string;
    brandNorm: string;
    modelCodes: string[];
    words: Set<string>;
  }

  const indexedMyshop: MyshopIndexed[] = allMyshop.map(m => {
    const normName = normalizeText(m.name);
    return {
      raw: m,
      normName,
      typeNorm: normalizeText(m.type),
      brandNorm: normalizeText(m.brand),
      modelCodes: extractModelCodes(m.name),
      words: new Set(normName.split(' ').filter(w => w.length > 1))
    };
  });

  // 3. Match Bazarko products with Myshop
  interface MatchResult {
    bazarkoProd: any;
    myshopProd: any;
    tier: number;
    reason: string;
  }

  const matches: MatchResult[] = [];
  const unmatched: any[] = [];

  for (const b of allBazarko) {
    const bNorm = normalizeText(b.name);
    const bWords = new Set(bNorm.split(' ').filter(w => w.length > 1));
    const bCodes = extractModelCodes(b.name);

    // Tier 1: Exact normalized name
    const t1 = indexedMyshop.find(m => m.normName === bNorm);
    if (t1) {
      matches.push({ bazarkoProd: b, myshopProd: t1.raw, tier: 1, reason: 'Exact normalized name' });
      continue;
    }

    // Tier 2: Model code match with guard (type or brand or word match)
    let foundT2: MyshopIndexed | null = null;
    if (bCodes.length > 0) {
      for (const m of indexedMyshop) {
        const sharedCodes = bCodes.filter(c => m.modelCodes.includes(c));
        if (sharedCodes.length > 0) {
          // Guard: verify either type or brand or high word overlap
          const hasTypeGuard = m.typeNorm && bNorm.includes(m.typeNorm);
          const hasBrandGuard = m.brandNorm && bNorm.includes(m.brandNorm);
          let sharedWordsCount = 0;
          for (const w of bWords) {
            if (m.words.has(w)) sharedWordsCount++;
          }
          if (hasTypeGuard || hasBrandGuard || sharedWordsCount >= 3) {
            foundT2 = m;
            break;
          }
        }
      }
    }
    if (foundT2) {
      matches.push({ bazarkoProd: b, myshopProd: foundT2.raw, tier: 2, reason: 'Model code match' });
      continue;
    }

    // Tier 3: High token subset match
    let bestT3: MyshopIndexed | null = null;
    let bestT3Score = 0;
    for (const m of indexedMyshop) {
      let sharedCount = 0;
      for (const w of bWords) {
        if (m.words.has(w)) sharedCount++;
      }
      const score = sharedCount / Math.max(bWords.size, m.words.size);
      if (score > 0.7 && score > bestT3Score) {
        bestT3Score = score;
        bestT3 = m;
      }
    }
    if (bestT3) {
      matches.push({ bazarkoProd: b, myshopProd: bestT3.raw, tier: 3, reason: `Token overlap ${(bestT3Score * 100).toFixed(0)}%` });
      continue;
    }

    unmatched.push(b);
  }

  console.log(`\nMatching Summary:`);
  console.log(`- Total Bazarko items: ${allBazarko.length}`);
  console.log(`- Total Matched: ${matches.length} (${((matches.length / allBazarko.length) * 100).toFixed(1)}%)`);
  console.log(`  * Tier 1 (Exact Name): ${matches.filter(m => m.tier === 1).length}`);
  console.log(`  * Tier 2 (Model Code): ${matches.filter(m => m.tier === 2).length}`);
  console.log(`  * Tier 3 (High Token Overlap): ${matches.filter(m => m.tier === 3).length}`);
  console.log(`- Unmatched items: ${unmatched.length}`);

  // 4. Ensure Categories exist in Bazarko
  const uniqueCategoryNames = new Set<string>();
  for (const m of matches) {
    if (m.myshopProd.type && m.myshopProd.type.trim()) {
      uniqueCategoryNames.add(m.myshopProd.type.trim());
    }
  }
  console.log(`\nFound ${uniqueCategoryNames.size} distinct categories from matched products.`);

  // Fetch existing categories in Bazarko for store
  const { data: existingCats, error: catFetchErr } = await mkt
    .from('categories')
    .select('id, name')
    .eq('store_id', STORE_ID);
  if (catFetchErr) throw catFetchErr;

  const categoryMap = new Map<string, string>(); // name -> id
  (existingCats || []).forEach(c => categoryMap.set(c.name.trim(), c.id));

  for (const catName of uniqueCategoryNames) {
    if (!categoryMap.has(catName)) {
      const slug = slugify(catName);
      const { data: newCat, error: insertCatErr } = await mkt
        .from('categories')
        .insert({
          store_id: STORE_ID,
          name: catName,
          slug: `${slug}-${Math.random().toString(36).substring(2, 6)}`,
          is_active: true
        })
        .select()
        .single();
      if (insertCatErr) {
        console.error(`Failed to insert category ${catName}:`, insertCatErr);
      } else {
        categoryMap.set(catName, newCat.id);
        console.log(`+ Created Category: "${catName}" (ID: ${newCat.id})`);
      }
    }
  }

  // 5. Ensure Brands exist in Bazarko
  const uniqueBrandNames = new Set<string>();
  for (const m of matches) {
    if (m.myshopProd.brand && m.myshopProd.brand.trim()) {
      uniqueBrandNames.add(m.myshopProd.brand.trim());
    }
  }
  console.log(`\nFound ${uniqueBrandNames.size} distinct brands from matched products.`);

  // Fetch existing brands in Bazarko for store
  const { data: existingBrands, error: brandFetchErr } = await mkt
    .from('brands')
    .select('id, name')
    .eq('store_id', STORE_ID);
  if (brandFetchErr) throw brandFetchErr;

  const brandMap = new Map<string, string>(); // name -> id
  (existingBrands || []).forEach(b => brandMap.set(b.name.trim(), b.id));

  for (const brandName of uniqueBrandNames) {
    if (!brandMap.has(brandName)) {
      const slug = slugify(brandName);
      const { data: newBrand, error: insertBrandErr } = await mkt
        .from('brands')
        .insert({
          store_id: STORE_ID,
          name: brandName,
          slug: `${slug}-${Math.random().toString(36).substring(2, 6)}`,
          is_active: true
        })
        .select()
        .single();
      if (insertBrandErr) {
        console.error(`Failed to insert brand ${brandName}:`, insertBrandErr);
      } else {
        brandMap.set(brandName, newBrand.id);
        console.log(`+ Created Brand: "${brandName}" (ID: ${newBrand.id})`);
      }
    }
  }

  // 6. Update Bazarko products with images, specifications, category_id, brand_id
  console.log(`\nUpdating Bazarko products...`);
  let updatedCount = 0;
  let withImagesCount = 0;
  let totalImagesAttached = 0;

  for (const m of matches) {
    const images = extractAllImages(m.myshopProd);
    const specs = buildSpecifications(m.myshopProd);

    const catName = m.myshopProd.type?.trim();
    const categoryId = catName ? categoryMap.get(catName) || null : null;

    const brandName = m.myshopProd.brand?.trim();
    const brandId = brandName ? brandMap.get(brandName) || null : null;

    const thumbnail = images.length > 0 ? images[0] : null;

    if (images.length > 0) {
      withImagesCount++;
      totalImagesAttached += images.length;
    }

    const { error: updateErr } = await mkt
      .from('products')
      .update({
        thumbnail_url: thumbnail,
        images: images,
        category_id: categoryId,
        brand_id: brandId,
        specifications: specs
      })
      .eq('id', m.bazarkoProd.id);

    if (updateErr) {
      console.error(`Error updating product ${m.bazarkoProd.id} (${m.bazarkoProd.name}):`, updateErr);
    } else {
      updatedCount++;
    }
  }

  console.log(`\n========================================`);
  console.log(`MIGRATION & ENRICHMENT COMPLETED!`);
  console.log(`- Products updated in Bazarko: ${updatedCount}`);
  console.log(`- Products enriched with images: ${withImagesCount}`);
  console.log(`- Total image links added: ${totalImagesAttached}`);
  console.log(`- Categories linked: ${categoryMap.size}`);
  console.log(`- Brands linked: ${brandMap.size}`);
  console.log(`========================================\n`);
}

runEnrichment().catch(err => {
  console.error('Fatal error during enrichment:', err);
  process.exit(1);
});
