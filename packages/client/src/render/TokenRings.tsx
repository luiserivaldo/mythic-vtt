import { DoubleSide } from 'three';
import type { RenderEntity } from './scene-model.js';

/** MEAS-07: faint, non-pickable rings at the token's feet in both views. */
export function TokenRings({ entity }: { entity: RenderEntity }) {
  return (
    <group position={[...entity.position]}>
      {entity.rings?.map((ring, index) => (
        <mesh
          key={index}
          name={`token-ring-${entity.id}-${String(index)}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.04, 0]}
          raycast={() => null}
        >
          <ringGeometry args={[Math.max(0, ring.radius - 0.025), ring.radius + 0.025, 96]} />
          <meshBasicMaterial
            color={ring.color}
            transparent
            opacity={0.8}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
