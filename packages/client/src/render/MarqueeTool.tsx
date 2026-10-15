import { useThree } from '@react-three/fiber';
import type { Scene } from '@mythic/shared';
import { useEffect, useRef } from 'react';
import { Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import {
  idsInRect,
  marqueeRect,
  marqueeSelection,
  marqueeStore,
  type ScreenPoint,
} from '../tools/marquee.js';
import { canSelect, pickEntity, selectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { useUiStore } from '../ui/ui-store.js';
import { emptyBoardLeftDrag, isDrag, MOUSE_LEFT, type Px } from './board-input.js';
import { focusedLayer, visibleEntities } from './layer-visibility.js';
import { pointerClaims } from './pointer-claims.js';
import type { RenderScene } from './scene-model.js';

const NO_SEATS = {};

function sceneEntityIdAt(object: Object3D | null, scene: Scene): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.name && scene.entities[o.name]) return o.name;
  }
  return null;
}

/**
 * UI-TOOL-01 / UI-INPUT-01 / C13 (MV-242): with the Select tool, a left drag that starts on empty
 * board draws a selection marquee instead of moving the camera. It listens on the canvas in the
 * bubble phase, so every control that claims a press first (gizmo handles, token drag, ruler,
 * draw, AoE, ping) keeps it; a press on a selectable entity stays a click for picking.
 */
export function MarqueeTool({
  rendered,
  scene,
  tool,
}: {
  rendered: RenderScene | null;
  scene: Scene | null;
  /** The rail tool in effect; the marquee belongs to Select only. */
  tool: string;
}) {
  const gl = useThree((s) => s.gl);
  const getState = useThree((s) => s.get);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const seats = useClientStore((s) => s.campaign?.seats ?? NO_SEATS);
  const hiddenLayers = useUiStore((s) => s.hiddenLayers);
  const activeLayer = useUiStore((s) => s.activeLayer);
  const latest = useRef({
    rendered,
    scene,
    tool,
    isHost,
    seatId,
    seats,
    hiddenLayers,
    activeLayer,
  });
  latest.current = { rendered, scene, tool, isHost, seatId, seats, hiddenLayers, activeLayer };

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    let press: { pointerId: number; start: Px; dragging: boolean } | null = null;
    let swallowClick = false;

    const actor = () => {
      const l = latest.current;
      return selectionActor(l.isHost, l.seatId, l.seats);
    };
    /** MV-258: objects off the active layer are not pickable, so the marquee skips them too. */
    const focus = () => focusedLayer(actor(), latest.current.activeLayer);

    /** A press on something the viewer may select is a click for picking, not a marquee. */
    const onSelectable = (e: PointerEvent, sc: Scene): boolean => {
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(
        new Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -(((e.clientY - r.top) / r.height) * 2 - 1),
        ),
        getState().camera,
      );
      const hits = raycaster
        .intersectObjects(getState().scene.children, true)
        .flatMap(({ object, distance }) => {
          const id = sceneEntityIdAt(object, sc);
          return id ? [{ id, distance }] : [];
        });
      return pickEntity(hits, sc, actor(), focus()) !== null;
    };

    /** Screen centres (client px) of every visible token and prop the viewer may select. */
    const candidates = (sc: Scene): ScreenPoint[] => {
      const { rendered: shown, hiddenLayers: hidden } = latest.current;
      const r = el.getBoundingClientRect();
      const camera = getState().camera;
      const who = actor();
      const v = new Vector3();
      return visibleEntities(shown, sc, hidden, focus()).flatMap((entity) => {
        const source = sc.entities[entity.id];
        // MV-258: `dimmed` marks an object off the active layer, which is not selectable.
        if (entity.dimmed || !(entity.token ?? entity.shape)) return [];
        if (!source || !canSelect(source, sc, who)) return [];
        v.set(entity.position[0], entity.position[1], entity.position[2]).project(camera);
        return [
          {
            id: entity.id,
            x: r.left + ((v.x + 1) / 2) * r.width,
            y: r.top + ((1 - v.y) / 2) * r.height,
          },
        ];
      });
    };

    const finish = (cancel: boolean, e?: PointerEvent) => {
      const done = press;
      press = null;
      marqueeStore.getState().set(null);
      if (!done) return;
      if (el.hasPointerCapture(done.pointerId)) el.releasePointerCapture(done.pointerId);
      const sc = latest.current.scene;
      if (cancel || !done.dragging || !e || !sc) return;
      // The release must not also click: R3F would read it as a miss and clear the selection.
      swallowClick = true;
      const rect = marqueeRect(done.start, { x: e.clientX, y: e.clientY });
      const inside = idsInRect(candidates(sc), rect);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const state = selectionStore.getState();
      const current = state.sceneId === sc.id ? state.ids : [];
      state.replace(sc.id, marqueeSelection(current, inside, additive));
    };

    const onDown = (e: PointerEvent) => {
      swallowClick = false;
      if (press || e.pointerType !== 'mouse' || e.button !== MOUSE_LEFT || e.altKey) return;
      if (pointerClaims.isClaimed(e.pointerId)) return;
      const { scene: sc, tool } = latest.current;
      if (!sc || emptyBoardLeftDrag(tool) !== 'marquee' || onSelectable(e, sc)) return;
      press = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, dragging: false };
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.pointerId) return;
      const now = { x: e.clientX, y: e.clientY };
      if (!press.dragging && !isDrag(press.start, now)) return;
      press.dragging = true;
      marqueeStore.getState().set(marqueeRect(press.start, now));
    };

    const onUp = (e: PointerEvent) => {
      if (press && e.pointerId === press.pointerId) finish(false, e);
    };
    const onCancel = (e: PointerEvent) => {
      if (press && e.pointerId === press.pointerId) finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press) finish(true);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.stopPropagation();
      swallowClick = false;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (press && el.hasPointerCapture(press.pointerId)) el.releasePointerCapture(press.pointerId);
      marqueeStore.getState().set(null);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, getState]);

  return null;
}

/** The marquee rectangle itself, drawn as a DOM overlay above the board (2D and 3D alike). */
export function MarqueeOverlay() {
  const rect = useStore(marqueeStore, (s) => s.rect);
  if (!rect) return null;
  return (
    <div
      data-testid="selection-marquee"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        border: '1px dashed var(--ui-accent)',
        background: 'color-mix(in srgb, var(--ui-accent) 15%, transparent)',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    />
  );
}
