interface Props {
  primaryCode: string
  secondaryCode: string
  rate: number
}

export default function CurrencyRateBar({ primaryCode, secondaryCode, rate }: Props) {
  // نعرض دائماً الاتجاه الذي يعطي رقماً >= 1 ليكون مقروءاً
  const [fromCode, toCode, value] =
    rate >= 1
      ? [primaryCode, secondaryCode, rate]
      : [secondaryCode, primaryCode, 1 / rate]

  const formatted =
    value >= 1000
      ? value.toLocaleString('ar-u-nu-latn', { maximumFractionDigits: 0 })
      : value.toLocaleString('ar-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="border-b border-black/5 bg-gradient-to-r from-amber-50 to-yellow-50 py-1.5 text-center dark:border-white/5 dark:from-slate-800/80 dark:to-slate-800/60">
      <p className="text-xs text-amber-800 dark:text-amber-300/90">
        <span className="mr-1">💱</span>
        <span>سعر الصرف اليوم:</span>
        <span className="mx-1.5 font-bold" dir="ltr">
          1 {fromCode} = {formatted} {toCode}
        </span>
      </p>
    </div>
  )
}
