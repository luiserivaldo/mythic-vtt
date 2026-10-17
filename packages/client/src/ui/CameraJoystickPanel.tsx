import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  cameraJoystickStore,
  IDLE_INPUT,
  joystickDeflection,
  joystickKeyStep,
  ROTATE_STEP,
} from '../render/camera-joystick.js';
import { toolPanelLayoutStore } from './tool-panel-layout.js';
import './camera-joystick.css';

/**
 * UI-CAM-01..03 (CAM-02): the Pan tool's 3D camera controls. A joystick (push sideways to rotate,
 * forward or back to tilt) with rotate buttons beside it; there is deliberately no elevation and
 * no sideways pan. The panel only asks; the orbit camera applies and clamps (camera-joystick.ts).
 * The mouse stays the main way to move the camera, so a mouse move closes the panel back to its
 * bar (orbit or pan, not the wheel zoom), while its own controls leave it open.
 */
export function CameraJoystickPanel() {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  // UI-CAM-03: only moves made after the panel opened count.
  useEffect(() => {
    const opened = cameraJoystickStore.getState().mouseMoves;
    return cameraJoystickStore.subscribe((state) => {
      if (state.mouseMoves !== opened) toolPanelLayoutStore.getState().collapse('camera');
    });
  }, []);

  // A panel closed mid-push must not leave the camera turning.
  useEffect(
    () => () => {
      cameraJoystickStore.getState().setInput(IDLE_INPUT);
    },
    [],
  );

  const track = (e: ReactPointerEvent<HTMLDivElement>) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = e.clientX - (rect.left + radius);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    const scale = length > radius ? radius / length : 1;
    setKnob({ x: dx * scale, y: dy * scale });
    cameraJoystickStore.getState().setInput(joystickDeflection(dx, dy, radius));
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    cameraJoystickStore.getState().setInput(IDLE_INPUT);
  };

  return (
    <section className="ui-camera-joystick" aria-label="Camera controls">
      <button
        type="button"
        aria-label="Rotate anticlockwise"
        title="Rotate anticlockwise"
        onClick={() => {
          cameraJoystickStore.getState().step(-ROTATE_STEP, 0);
        }}
      >
        ⟲
      </button>
      <div
        ref={baseRef}
        className="ui-camera-joystick-base"
        role="group"
        aria-label="Camera joystick"
        title="Push sideways to rotate, forward or back to tilt. Arrow keys work too."
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0 || pointer.current !== null) return;
          e.preventDefault();
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          track(e);
        }}
        onPointerMove={(e) => {
          if (pointer.current === e.pointerId) track(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          const step = joystickKeyStep(e.key);
          if (!step) return;
          e.preventDefault();
          cameraJoystickStore.getState().step(step.rotate, step.tilt);
        }}
      >
        <span className="ui-camera-joystick-mark" data-dir="forward" aria-hidden="true">
          ▲
        </span>
        <span className="ui-camera-joystick-mark" data-dir="back" aria-hidden="true">
          ▼
        </span>
        <span
          className="ui-camera-joystick-knob"
          aria-hidden="true"
          style={{ transform: `translate(${String(knob.x)}px, ${String(knob.y)}px)` }}
        />
      </div>
      <button
        type="button"
        aria-label="Rotate clockwise"
        title="Rotate clockwise"
        onClick={() => {
          cameraJoystickStore.getState().step(ROTATE_STEP, 0);
        }}
      >
        ⟳
      </button>
    </section>
  );
}
