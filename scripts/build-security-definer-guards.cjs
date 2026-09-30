const fs=require('node:fs')
const snapshot=require('../docs/audit/deployed-schema.json')
const readNames=['shamel_statement','shamel_item_card','shamel_cheques_browse','shamel_get_cheque_stats']
const writeNames=['shamel_bulk_upsert_accounts','shamel_bulk_upsert_assets','shamel_bulk_upsert_checks','shamel_bulk_upsert_cost_centers','shamel_bulk_upsert_customers','shamel_bulk_upsert_price_lists','shamel_bulk_upsert_products','shamel_bulk_upsert_sales_reps','shamel_bulk_upsert_suppliers','shamel_delete_operational_document','shamel_promote_entity','shamel_reconstruct_from_operations','shamel_refresh_customer_summaries','shamel_reset_store','shamel_save_isolated_batch']
const otherNames=['ensure_cash_box','log_staff_activity']
let sql=`-- Regenerated from the read-only deployed function definitions captured in docs/audit/deployed-schema.json.\n-- Guards run inside each SECURITY DEFINER function, even for direct RPC calls.\nBEGIN;\nCREATE FUNCTION public.assert_store_read_permission(p_store uuid) RETURNS void\nLANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$\nBEGIN\n IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.store_members WHERE store_id=p_store AND profile_id=auth.uid() AND is_active IS TRUE) THEN\n   RAISE EXCEPTION 'غير مخول لقراءة المتجر' USING ERRCODE='42501'; END IF;\nEND $$;\nREVOKE ALL ON FUNCTION public.assert_store_read_permission(uuid) FROM PUBLIC,anon,authenticated;\n`
for(const name of [...readNames,...writeNames,...otherNames]){
 const f=snapshot.functions.find(f=>f.signature.startsWith(name+'('));if(!f)throw Error('Missing '+name)
 const needle='\nBEGIN\n';const pos=f.definition.indexOf(needle)
 if(pos<0)throw Error('Cannot locate body of '+name)
 const guard=readNames.includes(name)?'PERFORM public.assert_store_read_permission(p_store_id);':writeNames.includes(name)?"PERFORM public.assert_financial_permission(p_store_id,'admin');":name==='ensure_cash_box'?"PERFORM public.assert_financial_permission(p_store_id,'post');":'PERFORM public.assert_store_read_permission(p_store_id);'
 let definition=f.definition.slice(0,pos+needle.length)+`  ${guard}\n`+f.definition.slice(pos+needle.length)
 definition=definition.replace(/SET search_path TO 'public'/i,"SET search_path TO 'pg_catalog', 'public'")
 sql+=`\n-- Guard ${name}\n${definition};\n`
 const signature=f.signature.replace(/^([^()]+)\(/,'public.$1(')
 sql+=`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon;\nGRANT EXECUTE ON FUNCTION ${signature} TO authenticated;\n`
}
sql+=`\n-- Trigger helpers and bootstrap functions never need a direct public RPC surface.\n`
for(const name of ['create_default_accounts','ensure_full_chart_of_accounts','sync_voucher_checks_to_portfolio','voucher_to_cash_movement','voucher_update_cash_movement','voucher_delete_cash_movement','handle_new_store','handle_new_user']){
 const f=snapshot.functions.find(f=>f.signature.startsWith(name+'('));if(f)sql+=`REVOKE ALL ON FUNCTION public.${f.signature} FROM PUBLIC,anon,authenticated;\n`
}
sql+=`REVOKE ALL ON FUNCTION public.record_offer_sale(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;\n`
sql+=`CREATE OR REPLACE FUNCTION public.generate_sequence_number(p_store_id uuid,p_prefix text) RETURNS text\nLANGUAGE plpgsql SET search_path=pg_catalog,public AS $$\nDECLARE n integer;\nBEGIN\n IF p_prefix IS NULL OR length(p_prefix)>40 THEN RAISE EXCEPTION 'بادئة الترقيم غير صالحة'; END IF;\n INSERT INTO public.sequence_counters(store_id,prefix,last_value) VALUES(p_store_id,p_prefix,1)\n ON CONFLICT(store_id,prefix) DO UPDATE SET last_value=public.sequence_counters.last_value+1 RETURNING last_value INTO n;\n RETURN p_prefix || lpad(n::text,greatest(4,length(n::text)),'0');\nEND $$;\nCOMMIT;\n`
fs.writeFileSync('db/migrations/063_security_definer_guards.sql',sql)
console.log('Wrote guards for',readNames.length+writeNames.length+otherNames.length,'deployed functions')
