import { ENGINE_VERSION } from '@stackerist/engine';
import { PROTOCOL_VERSION } from '@stackerist/protocol';

/** Milestone 1 placeholder: proves the client bundles the workspace packages. */
export function App() {
  return (
    <main>
      <h1>Stackerist</h1>
      <p>
        Scaffold placeholder · engine {ENGINE_VERSION} · protocol v{PROTOCOL_VERSION}
      </p>
    </main>
  );
}
