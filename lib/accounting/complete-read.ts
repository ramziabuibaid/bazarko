/** Never interpret a failed or API-truncated financial read as a zero balance. */
export async function financialRows(factory: () => any): Promise<{ data: any[] }> {
  const rows: any[] = []
  for (;;) {
    const { data, error } = await factory().order('id', { ascending: true }).range(rows.length, rows.length + 499)
    if (error || !Array.isArray(data)) throw new Error('التقرير غير مكتمل: تعذر جلب البيانات المالية')
    if (!data.length) return { data: rows }
    // Advance by the actual returned count, even when max_rows is smaller than our page.
    rows.push(...data)
  }
}
