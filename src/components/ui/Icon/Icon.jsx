export function Icon({ name, className = '' }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' }

  if (name === 'shield') return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  if (name === 'bolt') return <svg {...common}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
  if (name === 'replace') return <svg {...common}><path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8" /><path d="M3 3v5h5" /></svg>
  if (name === 'check') return <svg {...common}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
  if (name === 'globe') return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" /></svg>
  if (name === 'contract') return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
  if (name === 'x') return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>

  return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>
}
