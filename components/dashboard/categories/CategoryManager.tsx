'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { generateSlug } from '@/lib/utils/slug'
import { uploadCategoryImage } from '@/lib/supabase/storage'
import { trackAction } from '@/lib/activity/track'

interface Category {
  id: string
  name: string
  slug: string
  parent_id: string | null
  is_active: boolean
  sort_order: number
  image_url: string | null
}

interface Props {
  storeId: string
  initialCategories: Category[]
}

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500'

export default function CategoryManager({ storeId, initialCategories }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [categories, setCategories] = useState<Category[]>(
    [...initialCategories].sort((a, b) => a.sort_order - b.sort_order)
  )
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [form, setForm] = useState({
    name: '',
    slug: '',
    parent_id: '',
    sort_order: '0',
    is_active: true,
    image_url: null as string | null,
  })

  function openAdd() {
    const nextOrder = categories.length > 0
      ? Math.max(...categories.map(c => c.sort_order)) + 1
      : 0
    setEditing(null)
    setForm({ name: '', slug: '', parent_id: '', sort_order: String(nextOrder), is_active: true, image_url: null })
    setSaveError('')
    setShowModal(true)
  }

  function openEdit(cat: Category) {
    setEditing(cat)
    setForm({
      name: cat.name,
      slug: cat.slug,
      parent_id: cat.parent_id ?? '',
      sort_order: String(cat.sort_order),
      is_active: cat.is_active,
      image_url: cat.image_url,
    })
    setSaveError('')
    setShowModal(true)
  }

  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, slug: editing ? f.slug : generateSlug(name) }))
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadCategoryImage(storeId, file)
      setForm(f => ({ ...f, image_url: url }))
    } catch {
      setSaveError('فشل رفع الصورة')
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!form.name.trim()) return
    setSaveError('')
    setLoading(true)
    const supabase = createClient()

    const payload = {
      store_id: storeId,
      name: form.name.trim(),
      slug: form.slug || generateSlug(form.name),
      parent_id: form.parent_id || null,
      sort_order: parseInt(form.sort_order) || 0,
      is_active: form.is_active,
      image_url: form.image_url || null,
    }

    if (editing) {
      const { error } = await supabase
        .from('categories')
        .update({
          name: payload.name,
          slug: payload.slug,
          parent_id: payload.parent_id,
          sort_order: payload.sort_order,
          is_active: payload.is_active,
          image_url: payload.image_url,
        })
        .eq('id', editing.id)

      if (error) {
        setSaveError(error.message.includes('duplicate') ? 'يوجد فئة بنفس الرابط (slug)' : error.message)
        setLoading(false)
        return
      }
      trackAction(storeId, {
        action: 'update', entityType: 'category',
        entityId: editing.id, entityLabel: payload.name,
      })
      setCategories(cats =>
        cats.map(c => c.id === editing.id ? { ...c, ...payload } : c)
          .sort((a, b) => a.sort_order - b.sort_order)
      )
    } else {
      const { data, error } = await supabase
        .from('categories')
        .insert(payload)
        .select()
        .single()

      if (error) {
        setSaveError(error.message.includes('duplicate') ? 'يوجد فئة بنفس الرابط (slug)' : error.message)
        setLoading(false)
        return
      }
      if (data) {
        trackAction(storeId, {
          action: 'create', entityType: 'category',
          entityId: data.id, entityLabel: payload.name,
        })
        setCategories(cats => [...cats, data].sort((a, b) => a.sort_order - b.sort_order))
      }
    }

    setLoading(false)
    setShowModal(false)
    router.refresh()
  }

  async function toggleActive(cat: Category) {
    const supabase = createClient()
    await supabase.from('categories').update({ is_active: !cat.is_active }).eq('id', cat.id)
    trackAction(storeId, {
      action: 'status_change', entityType: 'category',
      entityId: cat.id, entityLabel: cat.name,
      details: { is_active: !cat.is_active },
    })
    setCategories(cats => cats.map(c => c.id === cat.id ? { ...c, is_active: !c.is_active } : c))
  }

  // تبديل الترتيب بين فئتين متجاورتين
  async function moveCategory(cat: Category, direction: 'up' | 'down') {
    const siblings = categories.filter(c => c.parent_id === cat.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = siblings.findIndex(c => c.id === cat.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return

    const other = siblings[swapIdx]
    const supabase = createClient()

    await Promise.all([
      supabase.from('categories').update({ sort_order: other.sort_order }).eq('id', cat.id),
      supabase.from('categories').update({ sort_order: cat.sort_order }).eq('id', other.id),
    ])

    setCategories(cats => cats.map(c => {
      if (c.id === cat.id) return { ...c, sort_order: other.sort_order }
      if (c.id === other.id) return { ...c, sort_order: cat.sort_order }
      return c
    }).sort((a, b) => a.sort_order - b.sort_order))
  }

  async function confirmDelete(id: string) {
    setDeleteError('')
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) {
      setDeleteError(error.message)
      setLoading(false)
      return
    }
    trackAction(storeId, {
      action: 'delete', entityType: 'category',
      entityId: id, entityLabel: categories.find(c => c.id === id)?.name ?? null,
    })
    setCategories(cats => cats.filter(c => c.id !== id))
    setDeleteId(null)
    setLoading(false)
    router.refresh()
  }

  const rootCategories = categories.filter(c => !c.parent_id)
  const getChildren    = (id: string) => categories.filter(c => c.parent_id === id)
  const parentOptions  = categories.filter(c => !c.parent_id && c.id !== editing?.id)
  const activeCount    = categories.filter(c => c.is_active).length
  const hiddenCount    = categories.length - activeCount

  const q = searchQuery.trim().toLowerCase()
  const filteredRoots = rootCategories.filter(cat =>
    !q || cat.name.toLowerCase().includes(q) ||
    getChildren(cat.id).some(ch => ch.name.toLowerCase().includes(q))
  )
  function getFilteredChildren(parentId: string) {
    const children = getChildren(parentId)
    if (!q) return children
    const parentMatches = categories.find(c => c.id === parentId)?.name.toLowerCase().includes(q)
    return parentMatches ? children : children.filter(ch => ch.name.toLowerCase().includes(q))
  }

  return (
    <>
      {/* ── شريط البحث والإضافة ── */}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6.5" cy="6.5" r="5" />
            <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" />
          </svg>
          <input
            type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="ابحث في الفئات..."
            className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-4 pr-10 text-sm leading-relaxed text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
          />
        </div>
        <button onClick={openAdd}
          className="shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-400 transition-colors hover:bg-sky-500/20">
          + فئة جديدة
        </button>
      </div>

      {/* ── إحصائيات ── */}
      {categories.length > 0 && (
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-white/5 bg-slate-900 px-4 py-3 text-xs">
          <span className="text-slate-400"><span className="font-semibold text-white">{categories.length}</span> فئة</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-400"><span className="font-semibold">{activeCount}</span> نشط</span>
          {hiddenCount > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400"><span className="font-semibold">{hiddenCount}</span> مخفي</span>
            </>
          )}
          <span className="text-slate-600">·</span>
          <span className="text-slate-400"><span className="font-semibold">{rootCategories.length}</span> رئيسية</span>
        </div>
      )}

      {/* ── القائمة ── */}
      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
          <p className="text-slate-400">لا توجد فئات بعد</p>
          <button onClick={openAdd} className="mt-3 text-sm text-sky-400 hover:text-sky-300">أضف أول فئة</button>
        </div>
      ) : filteredRoots.length === 0 ? (
        <div className="rounded-xl border border-white/5 py-10 text-center">
          <p className="text-slate-500">لا توجد نتائج لـ &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRoots.map((cat, idx) => {
            const siblings = rootCategories
            return (
              <div key={cat.id}>
                <CategoryRow
                  cat={cat}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < siblings.length - 1}
                  onMoveUp={() => moveCategory(cat, 'up')}
                  onMoveDown={() => moveCategory(cat, 'down')}
                  onEdit={() => openEdit(cat)}
                  onToggle={() => toggleActive(cat)}
                  onDelete={() => setDeleteId(cat.id)}
                />
                {getFilteredChildren(cat.id).map((child, cidx, arr) => (
                  <div key={child.id} className="mr-6 mt-1">
                    <CategoryRow
                      cat={child}
                      isChild
                      canMoveUp={cidx > 0}
                      canMoveDown={cidx < arr.length - 1}
                      onMoveUp={() => moveCategory(child, 'up')}
                      onMoveDown={() => moveCategory(child, 'down')}
                      onEdit={() => openEdit(child)}
                      onToggle={() => toggleActive(child)}
                      onDelete={() => setDeleteId(child.id)}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {categories.length > 0 && (
        <p className="mt-6 text-center text-xs text-slate-600">
          استخدم ↑↓ لترتيب الفئات · زر «+ منتج» يضيف منتجاً داخل الفئة · «+ فئة جديدة» بالأعلى لإنشاء فئة
        </p>
      )}

      {/* ── Modal إضافة / تعديل ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6">
            <h2 className="mb-5 text-lg font-semibold text-white">
              {editing ? 'تعديل الفئة' : 'فئة جديدة'}
            </h2>

            <div className="space-y-4">

              {/* الاسم */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  اسم الفئة <span className="text-red-400">*</span>
                </label>
                <input
                  type="text" autoFocus
                  value={form.name} onChange={e => handleNameChange(e.target.value)}
                  placeholder="مثال: ملابس رجالية"
                  className={INPUT}
                />
              </div>

              {/* Slug */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  الرابط (slug)
                  <span className="mr-1 text-xs text-slate-500">يُستخدم في الـ URL</span>
                </label>
                <input
                  type="text" dir="ltr"
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                  className={INPUT + ' text-left'}
                />
              </div>

              {/* الفئة الرئيسية */}
              {parentOptions.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm text-slate-300">
                    الفئة الرئيسية
                    <span className="mr-1 text-xs text-slate-500">اختياري</span>
                  </label>
                  <select
                    value={form.parent_id}
                    onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                    className={INPUT}
                  >
                    <option value="">— بدون فئة رئيسية —</option>
                    {parentOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* صورة الفئة */}
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  صورة الفئة
                  <span className="mr-1 text-xs text-slate-500">اختياري</span>
                </label>
                <div className="flex items-center gap-3">
                  {form.image_url ? (
                    <div className="relative h-14 w-14 shrink-0">
                      <img src={form.image_url} alt="" className="h-full w-full rounded-xl object-cover" />
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, image_url: null }))}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white"
                      >✕</button>
                    </div>
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/3 text-2xl text-slate-600">
                      🖼️
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-slate-400 transition-colors hover:border-sky-500/30 hover:text-sky-400 disabled:opacity-50"
                  >
                    {uploading ? 'جاري الرفع...' : form.image_url ? 'تغيير الصورة' : 'رفع صورة'}
                  </button>
                  <input
                    ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>
              </div>

              {/* الصف السفلي: ترتيب الظهور + حالة النشر */}
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm text-slate-300">ترتيب الظهور</label>
                  <input
                    type="number" min="0"
                    value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    dir="ltr" className={INPUT}
                  />
                  <p className="mt-1 text-xs text-slate-500">الأصغر يظهر أولاً</p>
                </div>
                <div className="pb-6">
                  <label className="mb-1.5 block text-sm text-slate-300">حالة الظهور</label>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                      form.is_active
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${form.is_active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    {form.is_active ? 'نشط' : 'مخفي'}
                  </button>
                </div>
              </div>
            </div>

            {saveError && (
              <p className="mt-4 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{saveError}</p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-white/10 px-5 py-2 text-sm text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                onClick={save}
                disabled={loading || uploading || !form.name.trim()}
                className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                {loading ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── نافذة تأكيد الحذف ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-slate-900 p-6"
            onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                  <polyline points="3 6 5 6 17 6" />
                  <path d="M8 6V4h4v2" />
                  <path d="M16 6l-1 11H5L4 6" />
                  <line x1="10" y1="11" x2="10" y2="15" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">حذف الفئة</p>
                <p className="mt-0.5 text-sm text-slate-400">
                  &quot;{categories.find(c => c.id === deleteId)?.name}&quot;
                </p>
              </div>
            </div>
            <p className="mb-5 text-sm text-slate-500">
              هذا الإجراء لا يمكن التراجع عنه. المنتجات المرتبطة لن تُحذف.
            </p>
            {deleteError && (
              <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white">
                إلغاء
              </button>
              <button onClick={() => confirmDelete(deleteId)} disabled={loading}
                className="flex-1 rounded-xl border border-red-500/40 bg-red-500/15 py-2.5 text-sm font-semibold text-red-400 hover:border-red-500 hover:bg-red-500 hover:text-white disabled:opacity-50">
                {loading ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CategoryRow({
  cat, isChild = false,
  canMoveUp, canMoveDown,
  onMoveUp, onMoveDown,
  onEdit, onToggle, onDelete,
}: {
  cat: Category
  isChild?: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className={`group flex items-center justify-between gap-2 rounded-xl border border-white/5 px-3 py-3 ${isChild ? 'bg-slate-800/50' : 'bg-slate-900'}`}>

      {/* أزرار الترتيب */}
      <div className="flex shrink-0 flex-col gap-0.5">
        <button
          onClick={onMoveUp} disabled={!canMoveUp}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-600 transition-colors hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
          title="تحريك لأعلى"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 2L9 7H1z"/></svg>
        </button>
        <button
          onClick={onMoveDown} disabled={!canMoveDown}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-600 transition-colors hover:bg-white/5 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
          title="تحريك لأسفل"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 8L1 3h8z"/></svg>
        </button>
      </div>

      {/* الصورة */}
      {cat.image_url ? (
        <img src={cat.image_url} alt={cat.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-base text-slate-600">
          {isChild ? '↳' : '📁'}
        </div>
      )}

      {/* الاسم والـ slug */}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-white">{cat.name}</span>
        <span className="mr-2 text-[10px] text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" dir="ltr">
          /{cat.slug}
        </span>
      </div>

      {/* الأدوات */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* badge الحالة */}
        <span className={`rounded-full px-2 py-0.5 text-xs ${cat.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
          {cat.is_active ? 'نشط' : 'مخفي'}
        </span>

        {/* إضافة منتج داخل هذه الفئة (ليس فئة جديدة) */}
        <Link
          href={`/dashboard/products/new?category_id=${cat.id}`}
          className="flex items-center gap-1 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-xs font-medium text-sky-400 transition-colors hover:bg-sky-500/15"
          title={`إضافة منتج في "${cat.name}"`}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="7" y1="1.5" x2="7" y2="12.5" />
            <line x1="1.5" y1="7" x2="12.5" y2="7" />
          </svg>
          منتج
        </Link>

        {/* تفعيل / إخفاء */}
        <button onClick={onToggle}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          title={cat.is_active ? 'إخفاء مؤقت' : 'تفعيل'}>
          {cat.is_active ? '👁️' : '🙈'}
        </button>

        {/* تعديل */}
        <button onClick={onEdit}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          title="تعديل">
          ✏️
        </button>

        {/* حذف */}
        <button onClick={onDelete}
          className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/20">
          حذف
        </button>
      </div>
    </div>
  )
}
