// Read-only production preflight. Never applies migrations or reads business rows.
const fs = require('node:fs')
const { Client } = require('pg')
const { loadEnvConfig } = require('@next/env')
loadEnvConfig(process.cwd())
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  try {
    await client.connect()
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '15s'")
    const queries = {
      columns: "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
      tableColumns: "select c.relname as table_name,a.attname as column_name,format_type(a.atttypid,a.atttypmod) as sql_type,a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) as default_expression from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname='public' and c.relkind='r' order by c.relname,a.attnum",
      constraints: "select conrelid::regclass::text as relation,conname,pg_get_constraintdef(oid) as definition from pg_constraint where connamespace='public'::regnamespace order by 1,2",
      functions: "select p.oid::regprocedure::text as signature,p.prosecdef as security_definer,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by 1",
      policies: "select * from pg_policies where schemaname='public' order by tablename,policyname",
      triggers: "select tgrelid::regclass::text as relation,tgname,pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) order by 1,2",
    }
    const result = { capturedAt: new Date().toISOString(), baseline: 'ed35b8e' }
    for (const [name, sql] of Object.entries(queries)) result[name] = (await client.query(sql)).rows
    const exists = await client.query("select to_regclass('supabase_migrations.schema_migrations') as relation")
    result.migrations = exists.rows[0].relation
      ? (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows
      : { unavailable: true }
    await client.query('ROLLBACK')
    fs.mkdirSync('docs/audit', { recursive: true })
    fs.writeFileSync('docs/audit/deployed-schema.json', JSON.stringify(result, null, 2) + '\n')
    console.log('Read-only schema snapshot saved to docs/audit/deployed-schema.json')
  } finally { await client.end() }
}
main().catch(error => { console.error('Schema inspection failed:', error.code || 'connection/query failure'); process.exitCode = 1 })
