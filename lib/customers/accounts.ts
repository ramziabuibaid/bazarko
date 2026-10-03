export function accountKind(balance:number){return balance>0.001?'debtors':balance<-.001?'creditors':'cleared'}
export function accountStats(rows:{balance:number}[]){let totalDebt=0,totalCredit=0,debtorsCount=0,creditorsCount=0,clearedCount=0;for(const row of rows){const b=Number(row.balance)||0,kind=accountKind(b);if(kind==='debtors'){totalDebt+=b;debtorsCount++}else if(kind==='creditors'){totalCredit+=Math.abs(b);creditorsCount++}else clearedCount++}return {totalDebt,totalCredit,debtorsCount,creditorsCount,clearedCount,totalCount:rows.length}}
export function validStatementRange(from:string,to:string){const valid=(v:string)=>!v||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);return valid(from)&&valid(to)&&(!from||!to||from<=to)}
export interface StatementTx{id:string;date:string;type:string;doc_no:string;description:string;debit:number;credit:number;created_at?:string}
export function calculateStatement(txs:StatementTx[],from='',to=''){
 const sorted=[...txs].sort((a,b)=>a.date.localeCompare(b.date)||(a.created_at||'').localeCompare(b.created_at||'')||a.id.localeCompare(b.id))
 let openingBalance=0
 const rows=sorted.filter(tx=>{if(from&&tx.date<from){openingBalance+=tx.debit-tx.credit;return false}return !to||tx.date<=to}).map(tx=>({...tx,balance:0}))
 let running=openingBalance;for(const row of rows){running+=row.debit-row.credit;row.balance=running}
 return {openingBalance,rows,totalDebit:rows.reduce((n,r)=>n+r.debit,0),totalCredit:rows.reduce((n,r)=>n+r.credit,0),closingBalance:running}
}
