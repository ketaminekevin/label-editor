'use client';
import { DietaryTag, SafetyLevel, DIETARY_LABELS, DIETARY_ICONS, SAFETY_LABELS, SAFETY_COLORS } from '@/lib/types';
import clsx from 'clsx';

interface Props {
  tag: DietaryTag;
  safetyLevel: SafetyLevel;
  notes?: string | null;
  size?: 'sm' | 'md';
}

const SAFETY_BG: Record<SafetyLevel, string> = {
  dedicated: 'bg-green-50 border-green-200',
  careful:   'bg-blue-50 border-blue-200',
  has_options: 'bg-amber-50 border-amber-200',
  risky:     'bg-red-50 border-red-200',
};

const SAFETY_TEXT: Record<SafetyLevel, string> = {
  dedicated:   'text-green-800',
  careful:     'text-blue-800',
  has_options: 'text-amber-800',
  risky:       'text-red-800',
};

const SAFETY_DOT: Record<SafetyLevel, string> = {
  dedicated:   'bg-green-500',
  careful:     'bg-blue-500',
  has_options: 'bg-amber-500',
  risky:       'bg-red-500',
};

export function DietaryBadge({ tag, safetyLevel, notes, size = 'md' }: Props) {
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 border rounded-full font-medium',
        SAFETY_BG[safetyLevel],
        SAFETY_TEXT[safetyLevel],
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      )}
      title={notes ?? SAFETY_LABELS[safetyLevel]}
    >
      <span>{DIETARY_ICONS[tag]}</span>
      <span>{DIETARY_LABELS[tag]}</span>
      <span className={clsx('rounded-full', SAFETY_DOT[safetyLevel], size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2')} />
    </div>
  );
}

export function SafetyMeter({ level }: { level: SafetyLevel }) {
  const steps: SafetyLevel[] = ['dedicated', 'careful', 'has_options', 'risky'];
  const idx = steps.indexOf(level);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div
          key={s}
          className="h-1.5 flex-1 rounded-full transition-all"
          style={{ background: i <= idx ? SAFETY_COLORS[level] : '#e2e8f0' }}
        />
      ))}
      <span className="ml-2 text-xs font-semibold" style={{ color: SAFETY_COLORS[level] }}>
        {SAFETY_LABELS[level]}
      </span>
    </div>
  );
}
