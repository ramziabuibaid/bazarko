'use client'

import { useEffect, useState } from 'react'

interface Props {
  target: string            // ISO date — الوقت الذي يعد العداد نحوه
  size?: 'sm' | 'lg'
  onDark?: boolean          // ألوان فاتحة فوق خلفية داكنة/متدرجة
  endedText?: string
}

function diff(target: string) {
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) return null
  const s = Math.floor(ms / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    urgent: ms < 3600_000, // آخر ساعة — إلحاح بصري
  }
}

export default function OfferCountdown({ target, size = 'sm', onDark = false, endedText = 'انتهى العرض' }: Props) {
  // null قبل الـ mount لتجنّب اختلاف الـ hydration بين السيرفر والمتصفح
  const [time, setTime] = useState<ReturnType<typeof diff> | null | 'pending'>('pending')

  useEffect(() => {
    setTime(diff(target))
    const interval = setInterval(() => setTime(diff(target)), 1000)
    return () => clearInterval(interval)
  }, [target])

  if (time === 'pending') {
    return <div className={size === 'lg' ? 'h-20' : 'h-10'} />
  }

  if (time === null) {
    return (
      <span className={`font-semibold ${onDark ? 'text-white/90' : 'text-red-600'} ${size === 'lg' ? 'text-xl' : 'text-sm'}`}>
        {endedText}
      </span>
    )
  }

  const units = [
    { value: time.days, label: 'يوم' },
    { value: time.hours, label: 'ساعة' },
    { value: time.minutes, label: 'دقيقة' },
    { value: time.seconds, label: 'ثانية' },
  ]

  const box = size === 'lg'
    ? 'min-w-[64px] rounded-2xl px-3 py-2.5'
    : 'min-w-[42px] rounded-xl px-2 py-1.5'
  const numCls = size === 'lg' ? 'text-2xl font-bold' : 'text-base font-bold'
  const labelCls = size === 'lg' ? 'text-[11px]' : 'text-[9px]'
  const colors = time.urgent
    ? 'animate-pulse bg-red-600 text-white shadow-lg shadow-red-600/40'
    : onDark
      ? 'bg-white/15 text-white backdrop-blur-sm'
      : 'bg-gray-900 text-white'

  return (
    <div className="flex items-center gap-1.5" dir="ltr">
      {units.map((u, i) => (
        <div key={u.label} className="flex items-center gap-1.5">
          <div className={`flex flex-col items-center ${box} ${colors}`}>
            <span className={`${numCls} tabular-nums leading-tight`}>
              {String(u.value).padStart(2, '0')}
            </span>
            <span className={`${labelCls} ${onDark ? 'text-white/70' : 'text-white/60'}`}>{u.label}</span>
          </div>
          {i < units.length - 1 && (
            <span className={`font-bold ${onDark ? 'text-white/60' : 'text-gray-400'}`}>:</span>
          )}
        </div>
      ))}
    </div>
  )
}
