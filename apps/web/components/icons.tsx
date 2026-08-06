interface IconProps {
  className?: string;
}

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ExploreIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="22" height="22" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-2.2 4.8L8 16l2.2-4.8z" />
    </svg>
  );
}

export function FollowingIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="22" height="22" className={className}>
      <path d="M20.5 8.5c0 4-8.5 9.5-8.5 9.5S3.5 12.5 3.5 8.5a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2z" />
    </svg>
  );
}

export function GoLiveIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="22" height="22" className={className}>
      <rect x="2.5" y="6.5" width="13" height="11" rx="2" />
      <path d="M15.5 10.5l6-3.5v10l-6-3.5z" />
    </svg>
  );
}

export function WalletIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="22" height="22" className={className}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <circle cx="17" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function PersonIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="14" height="14" className={className} fill="currentColor" stroke="none">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7z" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="16" height="16" className={className} fill="currentColor" stroke="none">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.2 7l2.2 1.3M17.6 15.7l2.2 1.3M4.2 17l2.2-1.3M17.6 8.3l2.2-1.3M3 12h2.5M18.5 12H21" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="16" height="16" className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function ProfileIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.5-4 4-6 7.5-6s6 2 7.5 6" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="14" height="14" className={className}>
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <circle cx="18" cy="5" r="2.3" />
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="19" r="2.3" />
      <path d="M8 10.8l8-4.6M8 13.2l8 4.6" />
    </svg>
  );
}

export function GroupIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="16" height="16" className={className}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2.5 20c.7-3.5 3-5.5 5.5-5.5s4.8 2 5.5 5.5M14.5 20c.4-2.2 1.7-3.7 4-4" />
    </svg>
  );
}

export function EmojiIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d="M8 14.5c1 1.3 2.4 2 4 2s3-.7 4-2" />
    </svg>
  );
}

export function GiftIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <rect x="3.5" y="9.5" width="17" height="10" rx="1.5" />
      <path d="M3.5 13.5h17" />
      <path d="M12 9.5v10" />
      <path d="M12 9.5C9.5 9.5 7 8.3 7 6.3S8.5 3 10 4.5c1 1 1.7 2.7 2 5zM12 9.5c2.5 0 5-1.2 5-3.2S15.5 3 14 4.5c-1 1-1.7 2.7-2 5z" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className} fill="currentColor" stroke="none">
      <path d="M3 12l17-8-6.5 17-3-6-6-3z" />
    </svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="14" height="14" className={className}>
      <path d="M12 2l3 3-4 4 1 5-5-1-4 4-1-1 4-4-1-5 5-4z" />
    </svg>
  );
}

export function VerifiedIcon({ className }: IconProps) {
  return (
    <svg
      {...baseProps}
      width="15"
      height="15"
      className={className}
      fill="var(--secondary)"
      stroke="var(--surface-container)"
      strokeWidth="1"
    >
      <path d="M12 2l2.4 1.4 2.8-.3 1.1 2.6 2.6 1.1-.3 2.8L22 12l-1.4 2.4.3 2.8-2.6 1.1-1.1 2.6-2.8-.3L12 22l-2.4-1.4-2.8.3-1.1-2.6-2.6-1.1.3-2.8L2 12l1.4-2.4-.3-2.8 2.6-1.1 1.1-2.6 2.8.3z" />
      <path d="M8.5 12.2l2.2 2.2 4.3-4.6" stroke="var(--surface-container)" strokeWidth="1.8" fill="none" />
    </svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="22" height="22" className={className}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ShuffleIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <path d="M3 6h3.5L14 17.5H21M14 6.5h7M17.5 3l3.5 3.5-3.5 3.5M3 17.5h3.5L10 12" />
      <path d="M17.5 21l3.5-3.5-3.5-3.5" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="16" height="16" className={className} fill="currentColor" stroke="none">
      <path d="M9 2l1.2 4.3L14.5 7l-4.3 1.2L9 12.5 7.8 8.2 3.5 7l4.3-1.2z" opacity="0.9" />
      <path d="M17 12l.7 2.5L20 15.2l-2.3.7L17 18l-.7-2.1-2.3-.7 2.3-.7z" opacity="0.7" />
    </svg>
  );
}

export function BlockedIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className} fill="currentColor" stroke="none">
      <rect x="5" y="4" width="4" height="16" rx="1" />
      <rect x="15" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

export function VolumeIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none" />
      <path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function MutedIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </svg>
  );
}

export function FullscreenIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

export function ExitFullscreenIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  );
}

export function TheaterIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <rect x="3" y="7" width="18" height="10" rx="2" />
    </svg>
  );
}

export function PipIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="18" height="18" className={className}>
      <rect x="3" y="4" width="18" height="14" rx="1.5" />
      <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SkipBackIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className}>
      <path d="M4 12a8 8 0 1 1 2.2 5.5" />
      <path d="M4 7v5h5" />
    </svg>
  );
}

export function SkipForwardIcon({ className }: IconProps) {
  return (
    <svg {...baseProps} width="20" height="20" className={className}>
      <path d="M20 12a8 8 0 1 0-2.2 5.5" />
      <path d="M20 7v5h-5" />
    </svg>
  );
}
