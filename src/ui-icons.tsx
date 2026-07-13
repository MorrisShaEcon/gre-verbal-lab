import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Icon width and height. Defaults to 24px. */
  size?: number | string;
  /** Stroke width used by the shared linear icon style. */
  strokeWidth?: number;
  /** Optional accessible name. Decorative icons are hidden by default. */
  title?: string;
};

type IconBaseProps = IconProps & {
  children: ReactNode;
};

function IconBase({
  children,
  size = 24,
  strokeWidth = 1.8,
  title,
  ...props
}: IconBaseProps) {
  const labelled = Boolean(title);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** A small moment of discovery; used for Today's study area. */
export function SparklesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 13.25 7A5.8 5.8 0 0 0 17 10.75L20.5 12 17 13.25A5.8 5.8 0 0 0 13.25 17L12 20.5 10.75 17A5.8 5.8 0 0 0 7 13.25L3.5 12 7 10.75A5.8 5.8 0 0 0 10.75 7L12 3.5Z" />
      <path d="m18.5 3 .45 1.05L20 4.5l-1.05.45L18.5 6l-.45-1.05L17 4.5l1.05-.45L18.5 3Z" />
    </IconBase>
  );
}

export const TodayIcon = SparklesIcon;

export function NetworkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="5" r="2.25" />
      <circle cx="5" cy="18.5" r="2.25" />
      <circle cx="19" cy="18.5" r="2.25" />
      <path d="m10.95 6.95-4.9 9.6M13.05 6.95l4.9 9.6M7.25 18.5h9.5" />
    </IconBase>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.75 11a8.25 8.25 0 1 1 2.42 6.58" />
      <path d="M3.75 5.75V11H9" />
      <path d="M12 7.75V12l2.75 1.75" />
    </IconBase>
  );
}

export const RefreshIcon = HistoryIcon;

export function ProgressIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 20V10.75h4V20M10 20V4h4v16M16 20v-6.25h4V20" />
      <path d="M3 20.25h18" />
    </IconBase>
  );
}

export const ChartIcon = ProgressIcon;

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.35 14.65a1.55 1.55 0 0 0 .31 1.71l.06.06-2.3 2.3-.06-.06a1.55 1.55 0 0 0-1.71-.31 1.55 1.55 0 0 0-.94 1.42V20h-3.25v-.23a1.55 1.55 0 0 0-1-1.42 1.55 1.55 0 0 0-1.71.31l-.06.06-2.3-2.3.06-.06a1.55 1.55 0 0 0 .31-1.71 1.55 1.55 0 0 0-1.42-.94H5.1v-3.25h.24a1.55 1.55 0 0 0 1.42-1 1.55 1.55 0 0 0-.31-1.71l-.06-.06 2.3-2.3.06.06a1.55 1.55 0 0 0 1.71.31 1.55 1.55 0 0 0 .94-1.42V4.1h3.25v.24a1.55 1.55 0 0 0 .94 1.42 1.55 1.55 0 0 0 1.71-.31l.06-.06 2.3 2.3-.06.06a1.55 1.55 0 0 0-.31 1.71 1.55 1.55 0 0 0 1.42.94h.24v3.25h-.24a1.55 1.55 0 0 0-1.36 1Z" />
    </IconBase>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="5.25" width="17" height="15" rx="2.5" />
      <path d="M7.5 3.5v3.25M16.5 3.5v3.25M3.5 9.25h17" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 16.75h.01M12 16.75h.01" strokeWidth="2.5" />
    </IconBase>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.25 2" />
    </IconBase>
  );
}

export function TargetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="13" r="8" />
      <circle cx="11" cy="13" r="3.5" />
      <path d="m13.5 10.5 6.75-6.75M16 3.75h4.25V8" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12.5 4.25 4.25L19.5 6.5" />
    </IconBase>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 5.25A3.75 3.75 0 0 1 7.25 4H12v15H7.25a3.75 3.75 0 0 0-3.75 1.25v-15Z" />
      <path d="M20.5 5.25A3.75 3.75 0 0 0 16.75 4H12v15h4.75a3.75 3.75 0 0 1 3.75 1.25v-15Z" />
    </IconBase>
  );
}

export const LibraryIcon = BookOpenIcon;

export function BrainIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9.5 4.25a3 3 0 0 0-5.05 2.18c0 .37.07.72.19 1.05A3.2 3.2 0 0 0 3 10.25c0 1.03.49 1.95 1.25 2.54a3.4 3.4 0 0 0-.25 1.28 3.43 3.43 0 0 0 3.43 3.43c.28 0 .55-.03.81-.1A3 3 0 0 0 12 19V5.75a2.5 2.5 0 0 0-2.5-2.5v1Z" />
      <path d="M14.5 4.25a3 3 0 0 1 5.05 2.18c0 .37-.07.72-.19 1.05A3.2 3.2 0 0 1 21 10.25c0 1.03-.49 1.95-1.25 2.54.16.4.25.83.25 1.28a3.43 3.43 0 0 1-3.43 3.43c-.28 0-.55-.03-.81-.1A3 3 0 0 1 12 19V5.75a2.5 2.5 0 0 1 2.5-2.5v1Z" />
      <path d="M7.25 8.25c.25 1 1 1.65 2 1.75M16.75 8.25c-.25 1-1 1.65-2 1.75M8.25 14.25c.85 0 1.45.4 1.75 1.25M15.75 14.25c-.85 0-1.45.4-1.75 1.25" />
    </IconBase>
  );
}

export const FeedbackIcon = BrainIcon;

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 5 7 7-7 7" />
    </IconBase>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 7 8 5-8 5V7Z" />
    </IconBase>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 10h3l4-3.5v11L8 14H5v-4Z" />
      <path d="M15 9.25a4 4 0 0 1 0 5.5M17.5 6.75a7.5 7.5 0 0 1 0 10.5" />
    </IconBase>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.5V16M12 7.5h.01" strokeWidth="2.25" />
    </IconBase>
  );
}
