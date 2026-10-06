import { useClientStore } from './store/react.js';
import { DmPanels } from './ui/DmPanels.js';
import './ui/shell.css';
import { BoardCanvas } from './render/BoardCanvas.js';

// Explicit opt-in until the 2D <-> 3D toggle lands (M2-05): `?camera=3d` mounts the orbit camera.
const MODE_3D = new URLSearchParams(window.location.search).get('camera') === '3d';

/** Skeleton shell: connection status only. Panels arrive with M1-11/M1-12, the board with M1-13. */
export function App() {
  const connection = useClientStore((s) => s.connection);
  const ready = useClientStore((s) => s.ready);
  const campaign = useClientStore((s) => s.campaign);
  const fatalError = useClientStore((s) => s.fatalError);
  const pending = useClientStore((s) => s.pendingIntents);

  return (
    <main>
      <h1>Mythic VTT</h1>
      <p role="status">
        {fatalError ??
          (ready ? `Connected to ${campaign?.name ?? 'table'}` : `Connection: ${connection}`)}
      </p>
      {pending > 0 && <p>{pending} action(s) waiting for the host</p>}
      <DmPanels />
      <BoardCanvas mode3d={MODE_3D} />
    </main>
  );
}
