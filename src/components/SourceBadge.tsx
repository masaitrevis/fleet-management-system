// FBV FleetOS — telematics source chip (LIVE = real GPS via Traccar, SIM =
// built-in simulator). StatusPill-sized; shared.tsx is frozen so this lives
// in its own module.

import { cn } from '@/lib/utils';

export function SourceBadge({ source, className }: {
  source?: 'sim' | 'traccar';
  className?: string;
}) {
  const live = source === 'traccar';
  return (
    <span
      title={live ? 'Real GPS tracker (Traccar)' : 'Simulated position'}
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.06em]',
        live
          ? 'border-accent text-accent-strong'
          : 'border-inactive/50 text-inactive',
        className,
      )}
    >
      {live ? 'LIVE' : 'SIM'}
    </span>
  );
}
