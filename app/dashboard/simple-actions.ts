'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getStoreForUser } from '@/lib/supabase/getStore'

export async function markStoreLinkCopied() {
  const supabase=createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user) return {ok:false}
  const storeId=await getStoreForUser(supabase,user.id)
  if(!storeId) return {ok:false}
  const {data:store,error}=await supabase.from('stores').select('settings').eq('id',storeId).single()
  if(error||!store) return {ok:false}
  const settings=store.settings && typeof store.settings==='object'&&!Array.isArray(store.settings)?store.settings:{}
  const {data:updated,error:updateError}=await supabase.from('stores').update({settings:{...settings,onboarding_store_link_copied:true}}).eq('id',storeId).select('id').maybeSingle()
  if(updateError || !updated) return {ok:false}
  revalidatePath('/dashboard')
  return {ok:true}
}
