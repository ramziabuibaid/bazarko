import {businessDay} from '@/lib/dashboard/simple-metrics'
export interface DirectoryCustomer {id:string;name:string;phone:string|null;email:string|null;city:string|null;address:string|null;notes:string|null;social_url:string|null;credit_limit:number|null;balance:number;total_orders:number;customer_type:string;is_active:boolean;created_at:string;shamel_code?:string|null;last_order_at?:string|null;last_payment_at?:string|null}
export function whatsappNumber(phone:string|null,country='PS') {
 const digits=(phone||'').replace(/\D/g,'')
 if(digits.startsWith('00'))return digits.slice(2)
 if(digits.startsWith('0')){const prefix:Record<string,string>={PS:'970',IL:'972',JO:'962',SA:'966',AE:'971'};return prefix[country]?prefix[country]+digits.slice(1):null}
 return digits.length>=8&&digits.length<=15?digits:null
}
export function directoryStats(rows:DirectoryCustomer[],date:string){const active=rows.filter(c=>c.is_active);return {total:rows.length,newThisMonth:rows.filter(c=>businessDay(new Date(c.created_at)).date.startsWith(date.slice(0,7))).length,withPhone:active.filter(c=>!!c.phone?.trim()).length,withDebt:active.filter(c=>Number(c.balance)>0).length,totalDebt:active.reduce((n,c)=>n+Math.max(0,Number(c.balance)),0)}}
export function filterCustomers(rows:DirectoryCustomer[],q:string,type:string,city:string,debt:string,sort:string){const search=q.trim().toLocaleLowerCase();return rows.filter(c=>(!search||[c.name,c.phone,c.email,c.city].some(v=>v?.toLocaleLowerCase().includes(search)))&&(type==='all'||c.customer_type===type)&&(!city||c.city===city)&&(debt==='all'||(debt==='debtor'?c.balance>0:debt==='creditor'?c.balance<0:debt==='non_zero'?c.balance!==0:c.balance===0))).sort((a,b)=>sort==='balance'?b.balance-a.balance:sort==='orders'?b.total_orders-a.total_orders:new Date(b.created_at).getTime()-new Date(a.created_at).getTime())}
export function csvCell(value:unknown){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`}
