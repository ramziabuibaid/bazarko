import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import BazarkoLogo from '@/components/ui/BazarkoLogo'
import styles from './home.module.css'

export const metadata: Metadata = {
  title: 'بازاركو — مشروعك من البيت، وإدارته من مكان واحد',
  description: 'اعرض منتجاتك، استقبل طلباتك، وتابع مبيعاتك ومصاريفك مع بازاركو. بداية بسيطة لمشروعك المنزلي وأدوات تتوسع مع نشاطك.',
}

function Icon({ name, className = '' }: { name: 'box' | 'link' | 'orders' | 'store' | 'wallet' | 'arrow' | 'play' | 'check' | 'gift'; className?: string }) {
  const paths = {
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
    link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" /></>,
    orders: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    store: <><path d="M3 10V7l2-4h14l2 4v3M4 11v10h16V11M9 21v-7h6v7" /><path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2M8 3l-1 7M16 3l1 7" /></>,
    wallet: <><path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7" /><path d="M21 12h-6v4h6M17 14h.1" /></>,
    arrow: <><path d="M19 12H5m6-6-6 6 6 6" /></>,
    play: <path d="m9 5 11 7-11 7V5Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8S5 8 5 5a2 2 0 0 1 4-1l3 4Zm0 0s7 0 7-3a2 2 0 0 0-4-1l-3 4Z" /></>,
  }
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const steps = [
  { number: '01', icon: 'box' as const, title: 'أضف منتجاتك', description: 'صورة جميلة، وصف مختصر، وسعر واضح. جهّز أول منتجاتك في دقائق.' },
  { number: '02', icon: 'link' as const, title: 'شارك رابط متجرك', description: 'رابط واحد ترسله لزبائنك على واتساب أو تضعه في حساباتك الاجتماعية.' },
  { number: '03', icon: 'orders' as const, title: 'تابع طلباتك', description: 'استقبل الطلبات وتابع تجهيزها وتسليمها، خطوة بخطوة من مكان واحد.' },
]
const categories = ['حلويات منزلية', 'إكسسوارات', 'عطور وهدايا', 'ملابس ومنتجات يدوية']

export default function HomePage() {
  return <main className={styles.home} dir="rtl">
    <div className={styles.darkTop}>
      <header className={styles.header}>
        <BazarkoLogo size="lg" variant="vector" />
        <nav className={styles.nav} aria-label="التنقل الرئيسي">
          <a href="#how-it-works">كيف يعمل؟</a><a href="#pricing">الأسعار</a><Link href="/login">تسجيل الدخول</Link>
        </nav>
        <Link className={styles.navCta} href="/onboarding">ابدأ مجاناً <Icon name="arrow" /></Link>
      </header>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><span /> فكرة صغيرة. بداية تستحق.</span>
          <h1>مشروعك من البيت،<br /><span>وإدارته من مكان واحد.</span></h1>
          <p>اعرض منتجاتك، تابع طلباتك، ونظّم مبيعاتك ومصاريفك بسهولة. بازاركو يرتّب التفاصيل، لتتفرّغ لما تحب.</p>
          <div className={styles.heroActions}>
            <Link href="/onboarding" className={styles.primary}>أنشئ متجرك <Icon name="arrow" /></Link>
            <a href="#how-it-works" className={styles.secondary}><span className={styles.play}><Icon name="play" /></span> اكتشف كيف يعمل</a>
          </div>
          <div className={styles.trust}><span><Icon name="check" /> ابدأ بالخطة المجانية</span><span><Icon name="check" /> يعمل من هاتفك</span><span><Icon name="check" /> أدوات تتوسع معك</span></div>
        </div>
        <div className={styles.heroArt}>
          <Image src="/images/landing/home-business-hero-v1.webp" alt="منتجات مشروع منزلي: هدايا يدوية وحلويات وإكسسوارات على طاولة خشبية" fill priority sizes="(max-width: 900px) 100vw, 650px" className={styles.heroPhoto} />
          <div className={styles.storePreview} aria-label="مثال توضيحي لمتجر على بازاركو">
            <div className={styles.browserBar}><span /><span /><span /><small>متجر لَمسة · مثال توضيحي</small></div>
            <div className={styles.storeHeader}><Icon name="store" /><strong>لَمسة</strong><span>صُنع بحب</span></div>
            <div className={styles.storeBanner}><Icon name="gift" /><div><small>تفاصيل صغيرة، فرحة كبيرة</small><strong>هدايا تشبهك.</strong></div></div>
            <div className={styles.previewProducts}>{[{name:'صندوق هدايا',icon:'gift' as const,price:'65'},{name:'قطعة يدوية',icon:'box' as const,price:'35'},{name:'تغليف مميز',icon:'store' as const,price:'20'}].map(item=><div key={item.name}><div className={styles.productIllustration}><Icon name={item.icon} /></div><strong>{item.name}</strong><span>{item.price} ₪</span></div>)}</div>
          </div>
          <div className={styles.orderNotice}><span><Icon name="check" /></span><div><strong>طلب جديد وصل!</strong><small>كل التفاصيل مرتبة، من أول طلب.</small></div><i /></div>
          <div className={styles.artCaption}>متجرك الخاص، بلمستك أنت.</div>
        </div>
      </section>
    </div>

    <section id="how-it-works" className={styles.stepsSection}>
      <div className={styles.sectionHeading}><span className={styles.sectionLabel}>من الفكرة إلى أول طلب</span><h2>ثلاث خطوات، وأنت جاهز.</h2></div>
      <div className={styles.steps}>{steps.map(step=><article className={styles.step} key={step.number}><div className={styles.stepTop}><div className={styles.stepIcon}><Icon name={step.icon} /></div><span>{step.number}</span></div><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
    </section>

    <section className={styles.categories}><div><span className={styles.sectionLabel}>لأصحاب الأفكار الجميلة</span><h2>مهما كان مشروعك،<br />له مكان في بازاركو.</h2></div><div className={styles.categoryGrid}>{categories.map((category,i)=><div key={category}><span className={styles.categoryNumber}>0{i+1}</span><Icon name={i===0?'gift':i===1?'link':i===2?'gift':'box'} /><h3>{category}</h3></div>)}</div></section>

    <section className={styles.features}>
      <div className={styles.sectionHeading}><span className={styles.sectionLabel}>خفّف التفاصيل اليومية</span><h2>كل ما تحتاجه، واضح أمامك.</h2><p>بداية بسيطة لمشروعك اليوم، ومساحة للنمو غداً.</p></div>
      <div className={styles.featureGrid}>{[{icon:'store' as const,title:'متجر يعكس شخصيتك',text:'اعرض منتجاتك بصورها وتفاصيلها، وشارك رابط متجرك بسهولة مع الزبائن.'},{icon:'orders' as const,title:'طلبات مرتبة وواضحة',text:'تابع الطلب الجديد، وما يحتاج تجهيزاً، وما أصبح جاهزاً للتسليم.'},{icon:'wallet' as const,title:'مبيعات ومصاريف مفهومة',text:'سجّل ما بعته وما صرفته، وتابع ما قبضته وما بقي على حساب الزبائن.'}].map(item=><article key={item.title}><Icon name={item.icon}/><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
    </section>

    <section id="pricing" className={styles.pricing}>
      <div><span className={styles.sectionLabel}>ابدأ على راحتك</span><h2>مشروعك في البداية؟<br />نبدأ معك مجاناً.</h2><p>جرّب الأدوات الأساسية، رتّب منتجاتك وطلباتك، ثم اختر ما يناسبك عندما يكبر نشاطك.</p><Link href="/onboarding" className={styles.primary}>ابدأ رحلتك <Icon name="arrow" /></Link></div>
      <article className={styles.plan}><div className={styles.planTop}><span>البداية المجانية</span><Icon name="store" /></div><div className={styles.price}>0 <span>شيكل / شهرياً</span></div><p>بداية خفيفة لمشروعك الصغير.</p><ul>{['حتى 50 منتجاً','رابط متجر خاص بك','إدارة المنتجات والطلبات والزبائن','تسجيل المبيعات ومتابعتها'].map(item=><li key={item}><Icon name="check" />{item}</li>)}</ul><Link href="/onboarding">أنشئ حسابك مجاناً <Icon name="arrow" /></Link></article>
    </section>

    <section className={styles.growth}><div><span className={styles.sectionLabel}>ومع كل خطوة للأمام</span><h2>عندك محل أو تدير شركة؟</h2><p>بازاركو يتوسع مع طبيعة نشاطك: مبيعات ومخزون، ثم أدوات محاسبية وتقارير عندما تحتاجها.</p></div><Link href="/onboarding">اختر البداية المناسبة لك <Icon name="arrow" /></Link></section>
    <section className={styles.faq}><div className={styles.sectionHeading}><h2>قبل أن تبدأ</h2></div>{[{q:'هل أحتاج خبرة تقنية؟',a:'ابدأ بإضافة منتجاتك وصورها وأسعارها. ستجد الخطوات مرتبة، ويمكنك إدارة متجرك من المتصفح على هاتفك أو جهازك.'},{q:'هل بازاركو مناسب للمحل أو الشركة أيضاً؟',a:'نعم. يمكنك استخدام أدوات المنتجات والمبيعات والمخزون، والتوسع إلى المحاسبة والتقارير حسب احتياجات نشاطك.'},{q:'كيف يدفع زبائني؟',a:'أنت تدير التحصيل مباشرةً مع زبائنك وتحدد طريقة التسديد المناسبة. بازاركو يساعدك في تسجيل الطلبات ومتابعة المدفوعات.'}].map(item=><details key={item.q}><summary>{item.q}<span>+</span></summary><p>{item.a}</p></details>)}</section>
    <footer className={styles.footer}><BazarkoLogo size="md"/><p>بداية بسيطة. مساحة أكبر لمشروعك.</p><div><Link href="/login">تسجيل الدخول</Link><Link href="/marketplace/PS">اكتشف المتاجر</Link><a href="#how-it-works">كيف يعمل؟</a></div><small>© {new Date().getFullYear()} بازاركو</small></footer>
  </main>
}
