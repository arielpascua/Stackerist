/**
 * The round result card and the series winner screen (REQ-050, REQ-051, REQ-084, REQ-091; DESIGN.md
 * "Result: round card", "Result: series card"): one card, no tabs, three panels side by side (the
 * report table, the stack-height chart, the best moment). Focus moves to the heading after the entrance, never to a button, and the buttons ignore
 * activation for the first 500 ms so a hard drop hammered at top-out cannot press Next round.
 */
import { type CSSProperties, useEffect, useId, useRef } from 'react';
import { computeBestMomentCell, motion } from '../../../../../design/tokens/tokens.ts';
import type { DrawBestMoment } from '../../game/contract.ts';
import { Bdi, withNames } from '../components/Bdi.tsx';
import { Button } from '../components/common.tsx';
import { StackChart } from '../components/StackChart.tsx';
import { COPY } from '../copy.ts';
import { useFitScale } from '../hooks.ts';
import { scaledHitMinPx } from '../layout.ts';
import type { BestMomentView, ResultView } from '../result.ts';
import { TEST_IDS } from '../testIds.ts';

/** Buttons ignore activation for this long after the card has entered (DESIGN.md). */
export const ACTIVATION_GUARD_MS = 500;

/** When the card starts entering: after the losing board dims, plus 120 ms after the art. */
export function entranceDelayMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : motion.resultDelayMs + 120;
}

function BestMoment({
  view,
  drawBestMoment,
  viewportHeight,
  seatNames,
}: {
  readonly view: BestMomentView;
  readonly drawBestMoment: DrawBestMoment;
  readonly viewportHeight: number;
  readonly seatNames: readonly string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current === null) return;
    drawBestMoment(canvasRef.current, view.moment, computeBestMomentCell(viewportHeight));
  }, [drawBestMoment, view.moment, viewportHeight]);
  return (
    <figure className="best-moment" data-testid={TEST_IDS.result.bestMoment} data-seat={view.seat}>
      <p className="label">{withNames(view.label, seatNames)}</p>
      <p className="best-moment__title">
        <span className="onair-skew">{view.title}</span>
      </p>
      <canvas
        ref={canvasRef}
        className="best-moment__board"
        role="img"
        aria-label={COPY.result.bestMomentBoard(view.title)}
        data-testid={TEST_IDS.result.bestMomentCanvas}
      />
      <figcaption className="best-moment__caption">{view.caption}</figcaption>
    </figure>
  );
}

export interface ResultCardProps {
  readonly view: ResultView;
  readonly reducedMotion: boolean;
  readonly viewportHeight: number;
  readonly drawBestMoment: DrawBestMoment;
  readonly onPrimary: () => void;
  readonly onBack: () => void;
}

export function ResultCard(props: ResultCardProps) {
  const { view, reducedMotion } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const armedAtRef = useRef(Number.POSITIVE_INFINITY);
  const scale = useFitScale(frameRef, cardRef);
  const summary = view.summary;
  const seatNames = [view.series.A.name, view.series.B.name];
  const headingId = useId();

  useEffect(() => {
    const delay = entranceDelayMs(reducedMotion);
    armedAtRef.current = performance.now() + delay + ACTIVATION_GUARD_MS;
    const timer = window.setTimeout(() => {
      headingRef.current?.focus({ preventScroll: true });
      if (summaryRef.current !== null) summaryRef.current.textContent = summary;
    }, delay);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, summary]);

  const guarded = (action: () => void) => () => {
    if (performance.now() < armedAtRef.current) return;
    action();
  };

  return (
    <div className="result" data-art={view.art} data-outcome={view.outcome} data-kind={view.kind}>
      <div className="result__art" aria-hidden="true" />
      <div ref={frameRef} className="result__frame">
        <section
          ref={cardRef}
          className="result-card"
          data-kind={view.kind}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          style={
            {
              '--result-scale': scale,
              '--result-hit-min': `${String(scaledHitMinPx(scale))}px`,
            } as CSSProperties
          }
          data-testid={TEST_IDS.result.card}
        >
          <header className="result-card__head">
            <div className="result-card__verdict">
              <p className="label label--final" data-testid={TEST_IDS.result.finalLabel}>
                {view.finalLabel}
              </p>
              <h2
                ref={headingRef}
                id={headingId}
                className={view.kind === 'series' ? 'headline headline--series' : 'headline'}
                tabIndex={-1}
                data-testid={TEST_IDS.result.headline}
              >
                <span className="onair-skew">{withNames(view.headline, seatNames)}</span>
              </h2>
              <p className="result-card__reason" data-testid={TEST_IDS.result.reason}>
                {withNames(view.reason, seatNames)}
              </p>
            </div>
            <div className="series-bug" data-kind={view.kind}>
              <div data-testid={TEST_IDS.result.seriesScore} className="series-bug__group">
                <p className="label">{COPY.result.seriesLabel}</p>
                <p className="series-bug__score">
                  <span className="series-bug__name" title={view.series.A.name}>
                    <Bdi>{view.series.A.name}</Bdi>
                  </span>
                  <span className="series-bug__digits">
                    {view.series.A.score} – {view.series.B.score}
                  </span>
                  <span className="series-bug__name" title={view.series.B.name}>
                    <Bdi>{view.series.B.name}</Bdi>
                  </span>
                </p>
              </div>
              {view.chips.length > 0 ? (
                <ul className="round-chips" data-testid={TEST_IDS.result.chips}>
                  {view.chips.map((chip, index) => (
                    <li
                      key={index}
                      className="round-chip"
                      data-draw={chip.draw ? 'true' : undefined}
                      data-testid={TEST_IDS.result.chip}
                    >
                      <span aria-hidden="true" className="round-chip__text">
                        <span className="label">{chip.label}</span>
                        {chip.draw ? null : (
                          <span className="round-chip__winner" title={chip.winner}>
                            <Bdi>{chip.winner}</Bdi>
                          </span>
                        )}
                      </span>
                      <span className="sr-only">{withNames(chip.name, seatNames)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </header>
          {view.rows.length > 0 ? (
            <div
              className="result-card__body"
              data-panels={1 + (view.chart === null ? 0 : 1) + view.bestMoments.length}
            >
              <table className="report" data-testid={TEST_IDS.result.statsTable}>
                <caption className="sr-only">{COPY.result.statsCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">{COPY.result.statLabel}</span>
                    </th>
                    <th scope="col" className="report__head" title={view.columns[0]}>
                      {withNames(view.columns[0], seatNames)}
                    </th>
                    <th scope="col" className="report__head" title={view.columns[1]}>
                      {withNames(view.columns[1], seatNames)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="report__label">
                        {row.label}
                      </th>
                      <td className="report__value">{row.values[0]}</td>
                      <td className="report__value">{row.values[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {view.chart === null ? null : <StackChart model={view.chart} />}
              {view.bestMoments.map((moment) => (
                <BestMoment
                  key={moment.seat}
                  view={moment}
                  drawBestMoment={props.drawBestMoment}
                  viewportHeight={props.viewportHeight}
                  seatNames={seatNames}
                />
              ))}
            </div>
          ) : null}
          <footer className="result-card__actions">
            <p className="result-card__status" role="status" data-testid={TEST_IDS.result.status}>
              {withNames(view.status, seatNames)}
            </p>
            {view.primary !== null ? (
              <Button
                variant="primary"
                onClick={guarded(props.onPrimary)}
                disabled={view.primary.disabled}
                data-testid={TEST_IDS.result.primaryButton}
              >
                {view.primary.label}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={guarded(props.onBack)}
              data-testid={TEST_IDS.result.backButton}
            >
              {COPY.result.backToHome}
            </Button>
          </footer>
        </section>
      </div>
      <p ref={summaryRef} className="sr-only" aria-live="assertive" />
    </div>
  );
}
