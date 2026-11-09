/**
 * Small shared pieces: the logo, a button whose label can swap to a loading label without changing
 * width, and the home/lobby page frame with the arena art behind a plate.
 */
import type { ComponentPropsWithRef, ReactNode } from 'react';
import logoUrl from '../../../../../design/assets/logo.webp';
import { COPY } from '../copy.ts';

/** Intrinsic size of design/assets/logo.webp, so the browser reserves its box before it loads. */
const LOGO_WIDTH = 1469;
const LOGO_HEIGHT = 301;

export function Logo({ className }: { readonly className: string }) {
  return (
    <img
      className={className}
      src={logoUrl}
      alt={COPY.logoAlt}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      decoding="async"
    />
  );
}

type Variant = 'primary' | 'secondary' | 'hud' | 'destructive';

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant: Variant;
  /** Shown instead of the label while loading; the button keeps the wider of the two widths. */
  readonly loadingLabel?: string;
  readonly loading?: boolean;
  readonly children: ReactNode;
}

export function Button({
  variant,
  loadingLabel,
  loading = false,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, className].filter(Boolean).join(' ');
  if (loadingLabel === undefined) {
    return (
      <button type={type} className={classes} {...rest}>
        {children}
      </button>
    );
  }
  const { 'aria-disabled': ariaDisabled, ...buttonProps } = rest;
  return (
    <button
      type={type}
      className={classes}
      {...buttonProps}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : ariaDisabled}
    >
      <span className="btn__labels">
        <span className="btn__label btn__label--idle" aria-hidden={loading ? true : undefined}>
          {children}
        </span>
        <span className="btn__label btn__label--busy" aria-hidden={loading ? undefined : true}>
          {loadingLabel}
        </span>
      </span>
    </button>
  );
}

/** Home and lobby: arena art behind the home scrim; content centred, never scrolling sideways. */
export function ArenaPage({
  children,
  testId,
  className,
}: {
  readonly children: ReactNode;
  readonly testId: string;
  readonly className?: string;
}) {
  return (
    <main className={['arena-page', className].filter(Boolean).join(' ')} data-testid={testId}>
      {children}
    </main>
  );
}
