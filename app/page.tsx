import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16 text-right">
      <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-10 shadow-xl shadow-slate-900/20">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-400">Bazarko</p>
        <h1 className="mt-6 text-4xl font-semibold text-white sm:text-5xl">منصة إدارة الأعمال والتجارة الإلكترونية</h1>
        <p className="mt-6 max-w-3xl text-slate-300 leading-8">
          منصة SaaS متكاملة لإدارة المتاجر في فلسطين وسوريا، تشمل المخزون، المحاسبة، العملاء، وواجهة سوق لكل دولة.
        </p>
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Link href="/dashboard" className="inline-flex items-center justify-center rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400">
            لوحة التحكم
          </Link>
          <Link href="/marketplace/ps" className="inline-flex items-center justify-center rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-white transition hover:border-sky-400 hover:text-sky-300">
            زيارة السوق الفلسطيني
          </Link>
        </div>
      </section>
    </main>
  );
}
