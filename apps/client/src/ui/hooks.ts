/**
 * React bindings for the external stores the UI reads (decision 22: no state library). Every store
 * here follows the useSyncExternalStore contract: the snapshot is the same value until it changes.
 */
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ClientState, GameStore } from '../game/contract.ts';
import { fitScale } from './layout.ts';

export function useClientState(store: GameStore): ClientState {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getState = useCallback(() => store.getState(), [store]);
  return useSyncExternalStore(subscribe, getState);
}

function subscribeResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function readViewport(): string {
  return `${String(window.innerWidth)}x${String(window.innerHeight)}`;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The viewport in CSS px, re-read on resize. */
export function useViewport(): Viewport {
  const key = useSyncExternalStore(subscribeResize, readViewport);
  return useMemo(() => {
    const [w = '0', h = '0'] = key.split('x');
    return { width: Number(w), height: Number(h) };
  }, [key]);
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion);
}

/**
 * The uniform scale that fits `content` (laid out at its natural size) inside `frame`. A
 * ResizeObserver delivers the first measurement as soon as it observes, so the scale is set before
 * the first paint that matters and kept current on every resize.
 */
export function useFitScale(
  frame: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const outer = frame.current;
    const inner = content.current;
    if (outer === null || inner === null) return undefined;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(outer);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setScale(
        fitScale(
          { width: outer.clientWidth - padX, height: outer.clientHeight - padY },
          { width: inner.offsetWidth, height: inner.offsetHeight },
        ),
      );
    });
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [frame, content]);
  return scale;
}
