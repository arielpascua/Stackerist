/**
 * `drawBestMoment` (REQ-051, architecture §5.5): the server-recorded best moment on a mini board, with
 * the cleared rows outlined and the finishing piece outlined. The UI passes the cell size from
 * `computeBestMomentCell(vh)`.
 */
import type { DrawBestMoment } from '../game/contract.ts';
import { executeOps, prepareCanvas } from './canvas.ts';
import { bareBoardGeometry } from './geometry.ts';
import { bestMomentOps } from './renderList.ts';

export const drawBestMoment: DrawBestMoment = (canvas, moment, cellCssPx) => {
  const g = bareBoardGeometry(cellCssPx);
  const ctx = prepareCanvas(canvas, g.width, g.height, window.devicePixelRatio);
  if (ctx === null) return;
  ctx.clearRect(0, 0, g.width, g.height);
  executeOps(ctx, bestMomentOps(g, moment));
};
