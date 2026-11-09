/**
 * Connection-level notices (DESIGN.md error catalogue): the top banner for a lost connection on home,
 * lobby and result screens, and the full-screen plate for a session that cannot continue.
 */
import { COPY } from '../copy.ts';
import type { CloseAction } from '../errors.ts';
import { TEST_IDS } from '../testIds.ts';
import { ArenaPage, Button, Logo } from './common.tsx';

export function ConnectionBanner({
  failed,
  onRetry,
  onHome,
}: {
  /** false: still reconnecting. true: the retries ran out. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly onHome: () => void;
}) {
  return (
    <div
      className="conn-banner"
      role={failed ? 'alert' : 'status'}
      data-state={failed ? 'failed' : 'reconnecting'}
      data-testid={TEST_IDS.banner.connection}
    >
      <p className="conn-banner__text">
        {failed ? COPY.errors.cantReach : COPY.errors.connectionLost}
      </p>
      {failed ? (
        <div className="conn-banner__actions">
          <Button variant="hud" onClick={onRetry} data-testid={TEST_IDS.banner.tryAgain}>
            {COPY.errors.tryAgain}
          </Button>
          <Button variant="hud" onClick={onHome} data-testid={TEST_IDS.banner.backHome}>
            {COPY.errors.backToHome}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function FatalPlate({
  text,
  actions,
  onReload,
  onHome,
}: {
  readonly text: string;
  readonly actions: readonly CloseAction[];
  readonly onReload: () => void;
  readonly onHome: () => void;
}) {
  return (
    <ArenaPage testId={TEST_IDS.fatal.plate} className="fatal">
      <h1 className="lobby__brand">
        <Logo className="lobby__logo" />
      </h1>
      <section className="plate plate--home" role="alert">
        <p className="prose" data-testid={TEST_IDS.fatal.message}>
          {text}
        </p>
        <div className="plate__actions">
          {actions.includes('reload') ? (
            <Button variant="primary" onClick={onReload} data-testid={TEST_IDS.fatal.reload}>
              {COPY.errors.reload}
            </Button>
          ) : null}
          {actions.includes('home') ? (
            <Button
              variant={actions.includes('reload') ? 'secondary' : 'primary'}
              onClick={onHome}
              data-testid={TEST_IDS.fatal.backHome}
            >
              {COPY.errors.backToHome}
            </Button>
          ) : null}
        </div>
      </section>
    </ArenaPage>
  );
}
