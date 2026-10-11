import React from 'react';

interface KmfriLogoProps {
  className?: string;
  compact?: boolean;
  showSubtitle?: boolean;
  iconOnly?: boolean;
  variant?: 'light' | 'dark' | 'auto';
}

/**
 * Official KMFRI (Kenya Marine and Fisheries Research Institute) Vector Logo Lockup
 * Renders the circular marine emblem (royal-blue upper fish, black lower fish, microscope,
 * research vessel RV Mtafiti, mangrove tree, and ocean water) alongside the KMFRI wordmark.
 */
export const KmfriLogo: React.FC<KmfriLogoProps> = ({
  className = '',
  compact = false,
  showSubtitle = true,
  iconOnly = false,
  variant = 'auto',
}) => {
  const titleColorClass =
    variant === 'dark'
      ? 'text-white'
      : variant === 'light'
      ? 'text-[#2E4B9E]'
      : 'text-[#2E4B9E] dark:text-sky-400';

  const subtitleColorClass =
    variant === 'dark'
      ? 'text-sky-200/80'
      : variant === 'light'
      ? 'text-slate-600'
      : 'text-slate-600 dark:text-slate-400';

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Official KMFRI Circular Marine Emblem */}
      <svg
        viewBox="0 0 120 120"
        className={`${compact ? 'w-9 h-9' : 'w-12 h-12'} shrink-0 drop-shadow-xs`}
        aria-label="KMFRI Emblem"
      >
        <defs>
          <linearGradient id="kmfriSeaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="45%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#0369A1" />
          </linearGradient>
          <clipPath id="innerGlobeClip">
            <circle cx="60" cy="60" r="34" />
          </clipPath>
        </defs>

        {/* Crisp white circular badge disc so the black lower fish & inner globe remain high-contrast on any background */}
        <circle cx="60" cy="60" r="56" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.5" />

        {/* Inner Ocean & Horizon */}
        <g clipPath="url(#innerGlobeClip)">
          <rect x="24" y="24" width="72" height="72" fill="#FFFFFF" />
          {/* Lower Ocean Waves */}
          <path
            d="M24 62 Q42 59 60 62 T96 62 L96 96 L24 96 Z"
            fill="url(#kmfriSeaGrad)"
          />
          {/* Subtle Wave Ripples */}
          <path
            d="M32 70 Q50 68 68 70 M38 78 Q58 76 82 78 M44 86 Q60 85 76 86"
            stroke="#BAE6FD"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />

          {/* Left: Scientific Microscope */}
          <g transform="translate(31, 39)" fill="#0F172A">
            <path d="M2 20 L16 20 L16 22.5 L2 22.5 Z" />
            <path d="M6 20 C3 15 3 8 8 4 L11 6 C7 9 7 15 9 20 Z" />
            <rect
              x="8"
              y="1"
              width="3.5"
              height="11"
              rx="1"
              transform="rotate(-28 8 1)"
            />
            <circle cx="13" cy="14" r="1.4" />
            <circle cx="16" cy="16" r="1.2" />
          </g>

          {/* Center: Research Vessel (RV Mtafiti) */}
          <g transform="translate(46, 36)">
            <rect x="5" y="7" width="18" height="11" rx="1.5" fill="#2E4B9E" />
            <rect x="7.5" y="9.5" width="5" height="4" fill="#FFFFFF" />
            <rect x="15.5" y="9.5" width="5" height="4" fill="#FFFFFF" />
            <rect x="11.5" y="2" width="5" height="5" fill="#2E4B9E" />
            <line x1="9" y1="3" x2="19" y2="3" stroke="#2E4B9E" strokeWidth="1.8" />
            <path
              d="M2 17 L14 14 L26 17 L22 28 L6 28 Z"
              fill="#2E4B9E"
              stroke="#FFFFFF"
              strokeWidth="1"
            />
          </g>

          {/* Right: Coastal Mangrove Tree & Prop Roots */}
          <g transform="translate(72, 46)">
            <path
              d="M9 12 L4 21 M9 12 L8 22 M9 12 L13 21 M9 12 L16 19 M9 6 L9 13"
              stroke="#78350F"
              strokeWidth="1.4"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="6" cy="6" r="4" fill="#15803D" />
            <circle cx="11" cy="4" r="4.5" fill="#16A34A" />
            <circle cx="14" cy="8" r="3.8" fill="#15803D" />
            <circle cx="8" cy="8" r="3.5" fill="#22C55E" />
          </g>
        </g>

        {/* Top Arching Royal-Blue Fish */}
        <path
          d="M 16 54 C 18 22, 56 10, 86 24 L 82 14 L 95 29 L 106 43 C 93 48, 80 43, 73 34 C 54 22, 29 30, 19 52 Z"
          fill="#2E4B9E"
        />
        <path d="M 18 48 L 8 42 L 15 58 L 22 50 Z" fill="#2E4B9E" />
        <circle cx="91" cy="36" r="2.3" fill="#FFFFFF" />

        {/* Bottom Arching Black Fish */}
        <path
          d="M 104 68 C 100 98, 62 110, 32 95 L 36 105 L 23 90 L 14 75 C 27 71, 40 76, 47 85 C 66 97, 90 89, 100 68 Z"
          fill="#0A0A0A"
        />
        <path d="M 101 72 L 111 78 L 104 62 L 97 70 Z" fill="#0A0A0A" />
        <circle cx="28" cy="83" r="2.3" fill="#FFFFFF" />
      </svg>

      {/* Official KMFRI Wordmark */}
      {!iconOnly && (
        <div className="flex flex-col justify-center min-w-0">
          <span
            className={`font-display font-extrabold tracking-wide leading-none ${
              compact ? 'text-base' : 'text-2xl'
            } ${titleColorClass}`}
          >
            KMFRI
          </span>
          {showSubtitle && (
            <span
              className={`font-semibold tracking-tight leading-tight mt-0.5 truncate ${
                compact ? 'text-[10px]' : 'text-[11px]'
              } ${subtitleColorClass}`}
            >
              {compact
                ? 'Kenya Marine & Fisheries'
                : 'Kenya Marine and Fisheries Research Institute'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
