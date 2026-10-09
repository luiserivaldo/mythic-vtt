import { useViewedCampaign } from '../store/viewed-campaign.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { IntentResult } from '../net/intents.js';
import { usePointerOwner } from '../render/pointer-claims.js';
import { useClientStore } from '../store/react.js';
import { useUiStore } from './ui-store.js';
import {
  appendDiagnostic,
  diagnosticOutcome,
  summarizePayload,
  type IntentDiagnostic,
} from './intent-diagnostics.js';
import { describeFailure, SubmitContext, type SubmitIntent } from './submit.js';

interface Toast {
  id: number;
  message: string;
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      dismiss(toast.id);
    }, 6000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dismiss, toast.id]);

  return (
    <div className="ui-toast" role="alert">
      <span>{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={() => {
          dismiss(toast.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

function useDevOverlayToggle(): [boolean, () => void] {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('dev') === '1');
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.code !== 'Backquote' ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))
      )
        return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener('keydown', toggle);
    return () => {
      window.removeEventListener('keydown', toggle);
    };
  }, []);
  return [
    open,
    () => {
      setOpen((value) => !value);
    },
  ];
}

function DevOverlay({
  diagnostics,
  submit,
}: {
  diagnostics: readonly IntentDiagnostic[];
  submit: SubmitIntent;
}) {
  const [open, toggle] = useDevOverlayToggle();
  const connection = useClientStore((state) => state.connection);
  const seq = useClientStore((state) => state.seq);
  const campaign = useViewedCampaign();
  const selectedId = useUiStore((state) => state.selectedEntityId);
  const pointerOwner = usePointerOwner();
  const scene = campaign?.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  const selected = selectedId ? scene?.entities[selectedId] : undefined;

  if (!open) return null;
  return (
    <aside className="ui-dev-overlay" aria-label="Developer diagnostics">
      <header>
        <strong>Developer diagnostics</strong>
        <button type="button" onClick={toggle} aria-label="Close developer diagnostics">
          Close
        </button>
      </header>
      <dl>
        <div>
          <dt>Connection</dt>
          <dd>{connection}</dd>
        </div>
        <div>
          <dt>Seq</dt>
          <dd>{seq ?? 'none'}</dd>
        </div>
        <div>
          <dt>Pointer owner</dt>
          <dd>{pointerOwner ?? 'none'}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>
            {selected
              ? `${selected.id} · ${selected.layer} · owners ${selected.owners.join(', ') || 'none'} · perms ${JSON.stringify(selected.perms ?? {})}`
              : 'none'}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        disabled={!scene}
        onClick={() => {
          if (scene) void submit('scene.rename', { sceneId: scene.id, name: scene.name }, scene.id);
        }}
      >
        Test rejection
      </button>
      <h2>Recent intents</h2>
      {diagnostics.length === 0 ? (
        <p>No intents yet.</p>
      ) : (
        <ol>
          {[...diagnostics].reverse().map((item) => (
            <li key={item.id}>
              <code>{item.type}</code> {item.payload} — {item.outcome}
              {item.reason ? ` (${item.reason})` : ''} · {String(item.latencyMs)} ms
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/** Central submission boundary: all callers get feedback and dev diagnostics consistently. */
export function SubmitProvider({
  submit,
  children,
}: {
  submit: SubmitIntent;
  children: ReactNode;
}) {
  const nextId = useRef(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [diagnostics, setDiagnostics] = useState<IntentDiagnostic[]>([]);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const wrapped = useCallback<SubmitIntent>(
    async (type, payload, sceneId) => {
      const started = performance.now();
      const id = ++nextId.current;
      let result: IntentResult;
      try {
        result = await submit(type, payload, sceneId);
      } catch {
        result = { ok: false as const, reason: 'connection-lost' as const };
      }
      setDiagnostics((current) =>
        appendDiagnostic(current, {
          id,
          type,
          payload: summarizePayload(payload),
          ...diagnosticOutcome(result),
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
        }),
      );
      if (!result.ok) {
        setToasts((current) => [...current, { id, message: describeFailure(result) }]);
      }
      return result;
    },
    [submit],
  );

  return (
    <SubmitContext.Provider value={wrapped}>
      {children}
      <section className="ui-toast-stack" aria-label="Action messages">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />
        ))}
      </section>
      {import.meta.env.DEV && <DevOverlay diagnostics={diagnostics} submit={wrapped} />}
    </SubmitContext.Provider>
  );
}
