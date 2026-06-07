'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { generateSlug } from '@/lib/utils/slug'

interface Category {
  id: string
  name: string
  slug: string
  parent_id: string | null
  is_active: boolean
  sort_order: number
}

interface Props {
  storeId: string
  initialCategories: Category[]
}

export default function CategoryManager({ storeId, initialCategories }: Props) {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [form, setForm] = useState({ name: '', slug: '', parent_id: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [saveError, setSaveError] = useState('')
  const [deleteError, setDeleteError] = useState('')

  function openAdd() {
    setEditing(null)
    setForm({ name: '', slug: '', parent_id: '' })
    setSaveError('')
    setShowModal(true)
  }

  function openEdit(cat: Category) {
    setEditing(cat)
    setForm({ name: cat.name, slug: cat.slug, parent_id: cat.parent_id ?? '' })
    setSaveError('')
    setShowModal(true)
  }

  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, slug: editing ? f.slug : generateSlug(name) }))
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
    }

    if (editing) {
      const { error } = await supabase
        .from('categories')
        .update({ name: payload.name, slug: payload.slug, parent_id: payload.parent_id })
        .eq('id', editing.id)

      if (error) {
        setSaveError(error.message.includes('duplicate') ? 'يوجد فئة بنفس الرابط (slug)' : error.message)
        setLoading(false)
        return
      }
      setCategories(cats => cats.map(c => c.id === editing.id ? { ...c, ...payload } : c))
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
      if (data) setCategories(cats => [...cats, data])
    }

    setLoading(false)
    setShowModal(false)
    router.refresh()
  }

  async function toggleActive(cat: Category) {
    const supabase = createClient()
    await supabase
      .from('categories')
      .update({ is_active: !cat.is_active })
      .eq('id', cat.id)
    setCategories(cats => cats.map(c =>
      c.id === cat.id ? { ...c, is_active: !c.is_active } : c
    ))
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
    setCategories(cats => cats.filter(c => c.id !== id))
    setDeleteId(null)
    setLoading(false)
    router.refresh()
  }

  const rootCategories = categories.filter(c => !c.parent_id)
  const getChildren = (id: string) => categories.filter(c => c.parent_id === id)
  const parentOptions = categories.filter(c => !c.parent_id && c.id !== editing?.id)

  const q = searchQuery.trim().toLowerCase()
  const filteredRoots = rootCategories.filter(cat =>
    !q ||
    cat.name.toLowerCase().includes(q) ||
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
      {/* شريط البحث والإضافة */}
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="ابحث في الفئات..."
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white placeholder-slate-500 outline-none focus:border-sky-500/50"
        />
        <button
          onClick={openAdd}
          className="shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
        >
          + فئة جديدة
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
          <p className="text-slate-400">لا توجد فئات بعد</p>
          <button onClick={openAdd} className="mt-3 text-sm text-sky-400 hover:text-sky-300">
            أضف أول فئة
          </button>
        </div>
      ) : filteredRoots.length === 0 ? (
        <div className="rounded-xl border border-white/5 py-10 text-center">
          <p className="text-slate-500">لا توجد نتائج لـ &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRoots.map(cat => (
            <div key={cat.id}>
              <CategoryRow
                cat={cat}
                onEdit={() => openEdit(cat)}
                onToggle={() => toggleActive(cat)}
                onDelete={() => setDeleteId(cat.id)}
              />
              {getFilteredChildren(cat.id).map(child => (
                <div key={child.id} className="mr-6 mt-1">
                  <CategoryRow
                    cat={child}
                    isChild
                    onEdit={() => openEdit(child)}
                    onToggle={() => toggleActive(child)}
                    onDelete={() => setDeleteId(child.id)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Modal إضافة/تعديل */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6">
            <h2 className="mb-5 text-lg font-semibold text-white">
              {editing ? 'تعديل الفئة' : 'فئة جديدة'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">اسم الفئة</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="مثال: ملابس رجالية"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-right text-white placeholder-slate-500 outline-none focus:border-sky-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-slate-300">
                  الرابط (slug)
                  <span className="mr-1 text-xs text-slate-500">يُستخدم في الـ URL</span>
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                  dir="ltr"
                  className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-left text-white placeholder-slate-500 outline-none focus:border-sky-500"
                />
              </div>

              {parentOptions.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm text-slate-300">
                    فئة رئيسية
                    <span className="mr-1 text-xs text-slate-500">اختياري</span>
                  </label>
                  <select
                    value={form.parent_id}
                    onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-right text-white outline-none focus:border-sky-500"
                  >
                    <option value="">— بدون فئة رئيسية —</option>
                    {parentOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
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
                disabled={loading || !form.name.trim()}
                className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                {loading ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تأكيد الحذف */}
      {deleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setDeleteId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-slate-900 p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                  <polyline points="3 6 5 6 17 6" />
                  <path d="M8 6V4h4v2" />
                  <path d="M16 6l-1 11H5L4 6" />
                  <line x1="10" y1="11" x2="10" y2="15" />
                  <line x1="8" y1="11" x2="8" y2="15" />
                  <line x1="12" y1="11" x2="12" y2="15" />
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
              هذا الإجراء لا يمكن التراجع عنه. المنتجات المرتبطة بهذه الفئة لن تُحذف.
            </p>

            {deleteError && (
              <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-400">{deleteError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => confirmDelete(deleteId)}
                disabled={loading}
                className="flex-1 rounded-xl border border-red-500/40 bg-red-500/15 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500 hover:text-white hover:border-red-500 disabled:opacity-50 transition-all"
              >
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
  cat, isChild = false, onEdit, onToggle, onDelete,
}: {
  cat: Category
  isChild?: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border border-white/5 bg-slate-900 px-4 py-3 ${isChild ? 'bg-slate-800/50' : ''}`}>
      <div className="flex items-center gap-3">
        {isChild && <span className="text-slate-600">↳</span>}
        <div>
          <span className="font-medium text-white">{cat.name}</span>
          <span className="mr-2 text-xs text-slate-500" dir="ltr">{cat.slug}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${cat.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
          {cat.is_active ? 'نشط' : 'مخفي'}
        </span>
        <Link
          href={`/dashboard/products/new?category_id=${cat.id}`}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-sky-500/10 hover:text-sky-400 transition-colors"
          title={`إضافة منتج في "${cat.name}"`}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="7.5" y1="2" x2="7.5" y2="13" />
            <line x1="2" y1="7.5" x2="13" y2="7.5" />
          </svg>
        </Link>
        <button onClick={onToggle} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors" title="تفعيل/إخفاء">
          {cat.is_active ? '👁️' : '🙈'}
        </button>
        <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors" title="تعديل">
          ✏️
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors"
          title="حذف"
        >
          حذف
        </button>
      </div>
    </div>
  )
}
