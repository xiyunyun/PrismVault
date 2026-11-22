import React from 'react'

interface AppLogoProps {
  size?: number
  className?: string
}

export const AppLogo: React.FC<AppLogoProps> = ({ size = 26, className = '' }) => {
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
        <linearGradient id="pv-ui-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0b1020" />
          <stop offset="50%" stopColor="#12264a" />
          <stop offset="100%" stopColor="#0a4a7a" />
        </linearGradient>
        <linearGradient id="pv-ui-vault" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60cdff" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="pv-ui-left" x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#e0f7ff" />
          <stop offset="100%" stopColor="#60cdff" />
        </linearGradient>
        <linearGradient id="pv-ui-right" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="pv-ui-bottom" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
        <linearGradient id="pv-ui-ray1" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pv-ui-ray2" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pv-ui-ray3" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#pv-ui-bg)" />
      <rect x="28" y="28" width="456" height="456" rx="108" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="5" />
      <rect x="86" y="86" width="340" height="340" rx="68" fill="url(#pv-ui-vault)" stroke="#7dd3fc" strokeOpacity="0.3" strokeWidth="4" />

      <path d="M 310 250 L 434 198 L 434 224 L 316 268 Z" fill="url(#pv-ui-ray1)" />
      <path d="M 316 268 L 434 252 L 434 280 L 320 288 Z" fill="url(#pv-ui-ray2)" />
      <path d="M 320 288 L 434 306 L 434 332 L 312 308 Z" fill="url(#pv-ui-ray3)" />
      <path d="M 78 266 L 194 250 L 186 274 L 78 286 Z" fill="#ffffff" fillOpacity="0.55" />

      <polygon points="256,112 140,354 256,306" fill="url(#pv-ui-left)" />
      <polygon points="256,112 372,354 256,306" fill="url(#pv-ui-right)" />
      <polygon points="140,354 256,306 372,354 256,386" fill="url(#pv-ui-bottom)" />
      <line x1="256" y1="112" x2="256" y2="306" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="5" strokeLinecap="round" />
      <polygon points="256,112 140,354 256,386 372,354" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  )
}
