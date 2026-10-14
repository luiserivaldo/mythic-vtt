import { useState } from 'react';
import type { Scene } from '@mythic/shared';
import { PropForm } from './EntityPanel.js';
import { useSubmit } from './submit.js';
import { useUiStore } from './ui-store.js';

/**
 * UI-TOOL-04: Create Prop opens the existing prop form (primitive, size, colour, layer). It sits
 * in the tool-panel area beside the rail; heavy editing stays in the Entities tab. The layer
 * defaults to the viewer's active layer (the Layers tab), falling back to Props where the viewer
 * may not create on that layer.
 */
export function CreatePropPanel({ scene, isHost }: { scene: Scene; isHost: boolean }) {
  const activeLayer = useUiStore((s) => s.activeLayer);
  const { send, error } = useSubmit();
  const [formError, setFormError] = useState<string | null>(null);
  const shown = formError ?? error;
  return (
    <>
      <PropForm
        scene={scene}
        isHost={isHost}
        activeLayer={activeLayer}
        send={send}
        onError={setFormError}
      />
      {shown && <p role="alert">{shown}</p>}
    </>
  );
}

/**
 * UI-TOOL-05: the mock panel behind the greyed Initiative rail entry. Initiative tracking is not
 * built yet, so this is a label and one honest line — no field, no data, nothing sent to the host.
 * The rail entry opens it; the panel itself has no behaviour.
 */
export function InitiativePanel() {
  return (
    <section className="ui-panel ui-dock-placeholder" aria-label="Initiative">
      <h2>Initiative</h2>
      <p>
        <strong>WIP.</strong> Initiative order, rounds and turns are coming soon.
      </p>
    </section>
  );
}
