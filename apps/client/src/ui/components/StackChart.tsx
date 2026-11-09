/**
 * The report chart (REQ-091; DESIGN.md "Report chart"): both players' stack height over the round as
 * hand-rolled SVG, no chart library. Colours come from the `--chart-*` tokens through CSS classes.
 * Accessible as an image with a title and a description, followed by a visually hidden table of the
 * same data, and the legend names each line so colour is never the only cue. All geometry and text
 * is computed in `chart.ts`; this component only draws it.
 */
import { useId } from 'react';
import {
  type ChartLine,
  type ChartModel,
  END_MARK,
  MARGIN,
  PLOT_HEIGHT,
  PLOT_WIDTH,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from '../chart.ts';
import { COPY } from '../copy.ts';
import { TEST_IDS } from '../testIds.ts';

const PLOT_RIGHT = MARGIN.left + PLOT_WIDTH;
/** The y labels hang left of the plot, right-aligned just inside the margin. */
const Y_LABEL_X = MARGIN.left - 4;
const X_LABEL_Y = VIEW_HEIGHT - 4;

function lineTestId(line: ChartLine): string {
  return line.key === 'you' ? TEST_IDS.result.chartLineYou : TEST_IDS.result.chartLineOpp;
}

function Legend({ model }: { readonly model: ChartModel }) {
  return (
    <ul className="chart__legend" data-testid={TEST_IDS.result.chartLegend}>
      {model.summary.map((line) => (
        <li key={line.key} className="chart__legend-item">
          <span className={`chart__swatch chart__swatch--${line.key}`} aria-hidden="true" />
          <span className="chart__legend-name" title={line.name}>
            {line.name}
          </span>
        </li>
      ))}
      <li className="chart__legend-item">
        <span className="chart__swatch chart__swatch--danger" aria-hidden="true" />
        <span className="chart__legend-name">{COPY.result.chart.danger}</span>
      </li>
    </ul>
  );
}

function DataTable({ model }: { readonly model: ChartModel }) {
  const text = COPY.result.chart;
  return (
    <table className="sr-only" data-testid={TEST_IDS.result.chartTable}>
      <caption>{text.tableCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{text.colPlayer}</th>
          <th scope="col">{text.colPeak}</th>
          <th scope="col">{text.colAt}</th>
          <th scope="col">{text.colAverage}</th>
        </tr>
      </thead>
      <tbody>
        {model.summary.map((line) => (
          <tr key={line.key}>
            <th scope="row">{line.name}</th>
            {line.sampleCount === 0 ? (
              <td colSpan={3}>{text.noData(line.name)}</td>
            ) : (
              <>
                <td>{text.rows(line.peak)}</td>
                <td>{line.peakAt}</td>
                <td>{text.rows(line.average)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StackChart({ model }: { readonly model: ChartModel }) {
  const titleId = useId();
  const descId = useId();
  return (
    <figure className="chart" data-testid={TEST_IDS.result.chart} data-empty={model.empty}>
      <figcaption className="chart__head">
        <span className="label">{COPY.result.chart.heading}</span>
        <Legend model={model} />
      </figcaption>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <title id={titleId}>{model.title}</title>
        <desc id={descId}>{model.description}</desc>
        <g className="chart__grid">
          {model.gridYs.map((y) => (
            <line key={y} x1={MARGIN.left} x2={PLOT_RIGHT} y1={y} y2={y} />
          ))}
        </g>
        <line
          className="chart__baseline"
          x1={MARGIN.left}
          x2={PLOT_RIGHT}
          y1={model.baselineY}
          y2={model.baselineY}
        />
        <line
          className="chart__danger"
          x1={MARGIN.left}
          x2={PLOT_RIGHT}
          y1={model.dangerY}
          y2={model.dangerY}
        />
        <g className="chart__axis" aria-hidden="true">
          {model.yLabels.map((tick) => (
            <text key={tick.label} x={Y_LABEL_X} y={tick.y} textAnchor="end" dy="0.35em">
              {tick.label}
            </text>
          ))}
          <text
            className="chart__axis-danger"
            x={Y_LABEL_X}
            y={model.dangerY}
            textAnchor="end"
            dy="0.35em"
          >
            {model.dangerLabel}
          </text>
          {model.xTicks.map((tick) => (
            <text key={tick.x} x={tick.x} y={X_LABEL_Y} textAnchor={tick.anchor}>
              {tick.label}
            </text>
          ))}
        </g>
        {model.empty ? (
          <text
            className="chart__empty"
            x={MARGIN.left + PLOT_WIDTH / 2}
            y={MARGIN.top + PLOT_HEIGHT / 2}
            textAnchor="middle"
            dy="0.35em"
            data-testid={TEST_IDS.result.chartEmpty}
          >
            {COPY.result.chart.empty}
          </text>
        ) : (
          model.lines.map((line) => (
            <g
              key={line.key}
              className={`chart__line chart__line--${line.key}`}
              data-testid={lineTestId(line)}
              data-samples={line.sampleCount}
            >
              {line.sampleCount >= 2 ? <polyline points={line.points} fill="none" /> : null}
              {line.end === null ? null : (
                <rect
                  x={line.end.x - END_MARK / 2}
                  y={line.end.y - END_MARK / 2}
                  width={END_MARK}
                  height={END_MARK}
                />
              )}
            </g>
          ))
        )}
      </svg>
      <DataTable model={model} />
    </figure>
  );
}
