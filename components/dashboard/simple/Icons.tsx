export type IconName = 'home' | 'orders' | 'box' | 'users' | 'expense' | 'store' | 'settings' | 'tools' | 'plus' | 'sale' | 'share' | 'copy' | 'wallet' | 'check' | 'arrow' | 'sun' | 'bell'
export default function Icon({name}:{name:IconName}) {
  const paths = {
    home:<><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/></>,
    orders:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    box:<><path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M8 5l9 5"/></>,
    users:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/></>,
    expense:<><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM9 7h6M9 11h6M9 15h3"/></>,
    store:<><path d="M3 10V7l2-4h14l2 4v3M4 11v10h16V11M9 21v-7h6v7M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2"/></>,
    settings:<><path d="m10 3-1 3-3 1-3 3 2 3-1 3 3 2 3-1 3 2 3-1 1-3 3-2-1-3 1-3-3-2-3 1-1-3Z"/><circle cx="12" cy="12" r="3"/></>,
    tools:<><path d="m4 21 10-10M14 3a5 5 0 0 0-3 8l7 7a2 2 0 0 0 3-3l-7-7a5 5 0 0 0 0-5Z"/></>,
    plus:<path d="M12 4v16M4 12h16"/>,
    sale:<><path d="M3 3h2l3 12h11l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
    share:<><circle cx="18" cy="4" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="20" r="3"/><path d="m9 10 6-4M9 14l6 4"/></>,
    copy:<><rect x="8" y="7" width="12" height="15" rx="2"/><path d="M16 7V2H3v15h5"/></>,
    wallet:<><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 6V4l15-2v4M21 11h-6v5h6"/></>,
    check:<path d="m5 12 4 4L19 6"/>,
    arrow:<path d="M19 12H5m6-6-6 6 6 6"/>,
    sun:<><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2"/></>,
    bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
