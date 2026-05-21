'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

  function openAdd() {
    setEditing(null)
    setForm({ name: '', slug: '', parent_id: '' })
    setShowModal(true)
  }

  function openEdit(cat: Category) {
    setEditing(cat)
    setForm({ name: cat.name, slug: cat.slug, parent_id: cat.parent_id ?? '' })
    setShowModal(true)
  }

  function handleNameChange(name: string) {
    setForm(f => ({ ...f, name, slug: editing ? f.slug : generateSlug(name) }))
  }

  async function save() {
    if (!form.name.trim()) return
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

      if (!error) {
        setCategories(cats => cats.map(c =>
          c.id === editing.id ? { ...c, ...payload } : c
        ))
      }
    } else {
      const { data, error } = await supabase
        .from('categories')
        .insert(payload)
        .select()
        .single()

      if (!error && data) {
        setCategories(cats => [...cats, data])
      }
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
    setLoading(true)
    const supabase = createClient()
    await supabase.from('categories').delete().eq('id', id)
    setCategories(cats => cats.filter(c => c.id !== id))
    setDeleteId(null)
    setLoading(false)
  }

  const rootCategories = categories.filter(c => !c.parent_id)
  const getChildren = (id: string) => categories.filter(c => c.parent_id === id)
  const parentOptions = categories.filter(c => !c.parent_id && c.id !== editing?.id)

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          onClick={openAdd}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
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
      ) : (
        <div className="space-y-2">
          {rootCategories.map(cat => (
            <div key={cat.id}>
              <CategoryRow
                cat={cat}
                onEdit={() => openEdit(cat)}
                onToggle={() => toggleActive(cat)}
                onDelete={() => setDeleteId(cat.id)}
              />
              {getChildren(cat.id).map(child => (
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

      {/* Confirm Delete */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-center">
            <p className="text-white">هل تريد حذف هذه الفئة؟</p>
            <p className="mt-1 text-sm text-slate-400">المنتجات المرتبطة بها لن تُحذف</p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-xl border border-white/10 px-5 py-2 text-sm text-slate-400"
              >
                إلغاء
              </button>
              <button
                onClick={() => confirmDelete(deleteId)}
                disabled={loading}
                className="rounded-xl bg-red-500 px-5 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
              >
                حذف
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
        <button onClick={onToggle} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" title="تفعيل/إخفاء">
          {cat.is_active ? '👁️' : '🙈'}
        </button>
        <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" title="تعديل">
          ✏️
        </button>
        <button onClick={onDelete} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-400" title="حذف">
          🗑️
        </button>
      </div>
    </div>
  )
}
