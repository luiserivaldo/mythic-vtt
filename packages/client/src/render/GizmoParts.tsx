import { GIZMO_EDGE_COLOR, GIZMO_NEUTRAL_COLOR, GIZMO_RENDER_ORDER } from './canvas-style.js';

// UI-TOKEN-07: the shared look of the transform handles in 2D and 3D. Sizes are in screen pixels
// times `px` (world units per pixel), so the handles stay a constant size at any zoom. Nothing
// here is pickable; hit-testing is done in screen/world maths (tools/transform-gizmo*.ts).

export type Axis = 'x' | 'y' | 'z';

const noRaycast = () => null;
const ARROW_HEAD_PX = 13;
const ARROW_HEAD_RADIUS_PX = 5.5;
const SHAFT_RADIUS_PX = 1.6;
const RING_TUBE_PX = 1.8;
/** three.js cones and cylinders point along +Y; these turn +Y onto each axis. */
const POINT_ALONG: Record<Axis, [number, number, number]> = {
  x: [0, 0, -Math.PI / 2],
  y: [0, 0, 0],
  z: [Math.PI / 2, 0, 0],
};
/** three.js tori lie in the XY plane (normal +Z); these turn the normal onto each axis. */
const RING_NORMAL: Record<Axis, [number, number, number]> = {
  x: [0, Math.PI / 2, 0],
  y: [Math.PI / 2, 0, 0],
  z: [0, 0, 0],
};

/** Transparent, so the handle sorts with the (transparent) grid by render order (F08). */
function HandleMaterial({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthTest={false}
      depthWrite={false}
    />
  );
}

/** Arrow along `axis` from `start` to `end` (distances from the gizmo centre, world units). */
export function AxisArrow({
  axis,
  start,
  end,
  px,
  color,
}: {
  axis: Axis;
  start: number;
  end: number;
  px: number;
  color: string;
}) {
  const head = ARROW_HEAD_PX * px;
  const shaft = Math.max(end - start - head, 0);
  const along = (d: number): [number, number, number] =>
    axis === 'x' ? [d, 0, 0] : axis === 'y' ? [0, d, 0] : [0, 0, d];
  return (
    <group name={`gizmo-arrow-${axis}`}>
      <mesh
        position={along(start + shaft / 2)}
        rotation={POINT_ALONG[axis]}
        renderOrder={GIZMO_RENDER_ORDER}
        raycast={noRaycast}
      >
        <cylinderGeometry args={[SHAFT_RADIUS_PX * px, SHAFT_RADIUS_PX * px, shaft, 6]} />
        <HandleMaterial color={color} />
      </mesh>
      <mesh
        position={along(end - head / 2)}
        rotation={POINT_ALONG[axis]}
        renderOrder={GIZMO_RENDER_ORDER}
        raycast={noRaycast}
      >
        <coneGeometry args={[ARROW_HEAD_RADIUS_PX * px, head, 12]} />
        <HandleMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Rotation ring around `axis`. */
export function AxisRing({
  axis,
  radius,
  px,
  color,
}: {
  axis: Axis;
  radius: number;
  px: number;
  color: string;
}) {
  return (
    <mesh
      name={`gizmo-ring-${axis}`}
      rotation={RING_NORMAL[axis]}
      renderOrder={GIZMO_RENDER_ORDER}
      raycast={noRaycast}
    >
      <torusGeometry args={[radius, RING_TUBE_PX * px, 6, 72]} />
      <HandleMaterial color={color} opacity={0.9} />
    </mesh>
  );
}

/** Uniform-scale square: a light square with a dark edge so it reads on any board. */
export function ScaleSquare({
  position,
  yaw,
  sizePx,
  px,
}: {
  position: [number, number, number];
  yaw: number;
  sizePx: number;
  px: number;
}) {
  const s = sizePx * px;
  const edge = (sizePx + 3) * px;
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={GIZMO_RENDER_ORDER} raycast={noRaycast}>
        <planeGeometry args={[edge, edge]} />
        <HandleMaterial color={GIZMO_EDGE_COLOR} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={GIZMO_RENDER_ORDER + 1}
        raycast={noRaycast}
      >
        <planeGeometry args={[s, s]} />
        <HandleMaterial color={GIZMO_NEUTRAL_COLOR} />
      </mesh>
    </group>
  );
}

/** Free XZ move pad (non-token entities): a light disc with a four-way arrow mark. */
export function MovePad({ radiusPx, px }: { radiusPx: number; px: number }) {
  const r = radiusPx * px;
  const tip = r * 0.62;
  const head = r * 0.42;
  const marks: { position: [number, number, number]; rotation: [number, number, number] }[] = [
    { position: [tip, 0, 0], rotation: [0, 0, -Math.PI / 2] },
    { position: [-tip, 0, 0], rotation: [0, 0, Math.PI / 2] },
    { position: [0, 0, tip], rotation: [Math.PI / 2, 0, 0] },
    { position: [0, 0, -tip], rotation: [-Math.PI / 2, 0, 0] },
  ];
  return (
    <group name="gizmo-move-pad">
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={GIZMO_RENDER_ORDER} raycast={noRaycast}>
        <circleGeometry args={[r + 1.5 * px, 24]} />
        <HandleMaterial color={GIZMO_EDGE_COLOR} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={GIZMO_RENDER_ORDER + 1}
        raycast={noRaycast}
      >
        <circleGeometry args={[r, 24]} />
        <HandleMaterial color={GIZMO_NEUTRAL_COLOR} />
      </mesh>
      {marks.map((m, i) => (
        <mesh
          key={i}
          position={m.position}
          rotation={m.rotation}
          renderOrder={GIZMO_RENDER_ORDER + 2}
          raycast={noRaycast}
        >
          <coneGeometry args={[head / 2, head, 3]} />
          <HandleMaterial color={GIZMO_EDGE_COLOR} />
        </mesh>
      ))}
    </group>
  );
}
