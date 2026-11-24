import React, { useId } from 'react'

interface AppLogoProps {
  size?: number
  className?: string
}

export const AppLogo: React.FC<AppLogoProps> = ({ size = 26, className = '' }) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const idBg = `pv-${uid}-bg`
  const idVault = `pv-${uid}-vault`
  const idLeft = `pv-${uid}-left`
  const idRight = `pv-${uid}-right`
  const idBottom = `pv-${uid}-bottom`
  const idRay1 = `pv-${uid}-ray1`
  const idRay2 = `pv-${uid}-ray2`
  const idRay3 = `pv-${uid}-ray3`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      aria-label="PrismVault 棱镜匣 Logo"
    >
      <defs>
        <linearGradient id={idBg} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0b1020" />
          <stop offset="50%" stopColor="#12264a" />
          <stop offset="100%" stopColor="#0a4a7a" />
        </linearGradient>
        <linearGradient id={idVault} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60cdff" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id={idLeft} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#e0f7ff" />
          <stop offset="100%" stopColor="#60cdff" />
        </linearGradient>
        <linearGradient id={idRight} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id={idBottom} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
        <linearGradient id={idRay1} x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={idRay2} x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={idRay3} x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="24" y="24" width="464" height="464" rx="112" fill={`url(#${idBg})`} />
      <rect x="28" y="28" width="456" height="456" rx="108" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="5" />
      <rect x="86" y="86" width="340" height="340" rx="68" fill={`url(#${idVault})`} stroke="#7dd3fc" strokeOpacity="0.3" strokeWidth="4" />

      <path d="M 310 250 L 434 198 L 434 224 L 316 268 Z" fill={`url(#${idRay1})`} />
      <path d="M 316 268 L 434 252 L 434 280 L 320 288 Z" fill={`url(#${idRay2})`} />
      <path d="M 320 288 L 434 306 L 434 332 L 312 308 Z" fill={`url(#${idRay3})`} />
      <path d="M 78 266 L 194 250 L 186 274 L 78 286 Z" fill="#ffffff" fillOpacity="0.55" />

      <polygon points="256,112 140,354 256,306" fill={`url(#${idLeft})`} />
      <polygon points="256,112 372,354 256,306" fill={`url(#${idRight})`} />
      <polygon points="140,354 256,306 372,354 256,386" fill={`url(#${idBottom})`} />
      <line x1="256" y1="112" x2="256" y2="306" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" />
      <polygon points="256,112 140,354 256,386 372,354" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  )
}
