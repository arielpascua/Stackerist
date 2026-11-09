/**
 * Routing without a router dependency (architecture §5.7, decision 22): `/`, `/g/:code` and
 * `/g/:code?watch=1`. A route is parsed from the location; navigation goes through the History API.
 */
import {
  GAME_PATH_PREFIX,
  gamePath,
  normalizeRoomCode,
  WATCH_QUERY_PARAM,
  type RoomCode,
} from '@stackerist/protocol';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'room'; readonly code: RoomCode; readonly watch: boolean }
  | { readonly name: 'notFound' };

const HOME: Route = { name: 'home' };
const NOT_FOUND: Route = { name: 'notFound' };

/** Parses a location. A malformed path (bad percent-encoding, bad code, extra segments) is notFound. */
export function parseRoute(pathname: string, search: string): Route {
  if (pathname === '/' || pathname === '' || pathname === '/index.html') return HOME;
  if (!pathname.startsWith(GAME_PATH_PREFIX)) return NOT_FOUND;
  let raw = pathname.slice(GAME_PATH_PREFIX.length);
  if (raw.endsWith('/')) raw = raw.slice(0, -1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return NOT_FOUND;
  }
  if (decoded.includes('/')) return NOT_FOUND;
  const code = normalizeRoomCode(decoded);
  if (code === null) return NOT_FOUND;
  const watch = new URLSearchParams(search).get(WATCH_QUERY_PARAM) === '1';
  return { name: 'room', code, watch };
}

/** `/g/<CODE>`, plus `?watch=1` for a watch link. */
export function roomPath(code: RoomCode, watch = false): string {
  return watch ? `${gamePath(code)}?${WATCH_QUERY_PARAM}=1` : gamePath(code);
}

/** Function properties (not methods), so they can be handed to useSyncExternalStore unbound. */
export interface Router {
  /** pathname + search; the same string until the location changes. */
  readonly getLocation: () => string;
  readonly subscribe: (listener: () => void) => () => void;
  readonly navigate: (path: string, options?: { readonly replace?: boolean }) => void;
}

/** Splits a `getLocation()` string back into pathname and search. */
export function splitLocation(location: string): { pathname: string; search: string } {
  const at = location.indexOf('?');
  return at === -1
    ? { pathname: location, search: '' }
    : { pathname: location.slice(0, at), search: location.slice(at) };
}

/** The History API router: popstate and our own navigations notify listeners. */
export function createBrowserRouter(win: Window): Router {
  const listeners = new Set<() => void>();
  const read = () => `${win.location.pathname}${win.location.search}`;
  let current = read();
  const notify = () => {
    const next = read();
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };
  win.addEventListener('popstate', notify);
  return {
    getLocation: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate: (path, options) => {
      if (options?.replace === true) win.history.replaceState(null, '', path);
      else win.history.pushState(null, '', path);
      notify();
    },
  };
}

/** An in-memory router for harnesses and tests. */
export function createMemoryRouter(initial: string): Router {
  const listeners = new Set<() => void>();
  let current = initial;
  return {
    getLocation: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate: (path) => {
      if (path === current) return;
      current = path;
      for (const listener of listeners) listener();
    },
  };
}
