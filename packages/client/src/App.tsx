import { useClientStore } from './store/react.js';
import { DmPanels } from './ui/DmPanels.js';
import { JoinScreen } from './ui/JoinScreen.js';
import './ui/shell.css';
import { BoardCanvas } from './render/BoardCanvas.js';
import { IdentityStatus } from './ui/IdentityStatus.js';

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
      <IdentityStatus />
      {pending > 0 && <p>{pending} action(s) waiting for the host</p>}
      <DmPanels />
      <BoardCanvas />
      <JoinScreen />
    </main>
  );
}
