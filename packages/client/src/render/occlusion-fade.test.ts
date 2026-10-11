import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BoxGeometry, DoubleSide, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { OCCLUSION_OPACITY, OcclusionFadeController } from './occlusion-fade.js';

const allocated: Mesh<BoxGeometry, MeshStandardMaterial>[] = [];
function wall(x = 0, y = 0, z = 5) {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ side: DoubleSide }));
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld();
  allocated.push(mesh);
  return mesh;
}
afterEach(() => {
  for (const mesh of allocated.splice(0)) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

describe('occlusion fading (CAM-05)', () => {
  it('fades only blocking geometry, and restores it when the camera moves clear', () => {
    const blocker = wall();
    const behind = wall(0, 0, -5);
    const beside = wall(5, 0, 5);
    const controller = new OcclusionFadeController();
    controller.update(new Vector3(0, 0, 10), [new Vector3()], [blocker, behind, beside]);
    expect(blocker.material.opacity).toBe(OCCLUSION_OPACITY);
    expect(blocker.material.transparent).toBe(true);
    expect(blocker.material.depthWrite).toBe(false);
    expect(behind.material.opacity).toBe(1);
    expect(beside.material.opacity).toBe(1);
    controller.update(new Vector3(10, 0, 0), [new Vector3()], [blocker, behind, beside]);
    expect(blocker.material.opacity).toBe(1);
    expect(blocker.material.transparent).toBe(false);
    expect(blocker.material.depthWrite).toBe(true);
  });

  it('restores original material settings on deselection, removal and reset', () => {
    const blocker = wall();
    blocker.material.opacity = 0.7;
    blocker.material.transparent = true;
    blocker.material.depthWrite = false;
    const controller = new OcclusionFadeController();
    for (const finish of ['deselect', 'remove', 'reset']) {
      controller.update(new Vector3(0, 0, 10), [new Vector3()], [blocker]);
      if (finish === 'reset') controller.reset();
      else
        controller.update(
          new Vector3(0, 0, 10),
          finish === 'deselect' ? [] : [new Vector3()],
          finish === 'remove' ? [] : [blocker],
        );
      expect(blocker.material.opacity).toBe(0.7);
      expect(blocker.material.transparent).toBe(true);
      expect(blocker.material.depthWrite).toBe(false);
    }
  });

  it('handles a camera inside geometry and several selected tokens', () => {
    const blocker = wall();
    const controller = new OcclusionFadeController();
    controller.update(new Vector3(0, 0, 5), [new Vector3(10, 0, 5), new Vector3()], [blocker]);
    expect(blocker.material.opacity).toBe(OCCLUSION_OPACITY);
    controller.reset();
  });

  it('uses actual rotated/scaled geometry and the target endpoint', () => {
    const blocker = wall(1.5, 0, 5);
    blocker.scale.set(4, 1, 0.1);
    blocker.rotation.y = Math.PI / 4;
    blocker.updateMatrixWorld();
    const controller = new OcclusionFadeController();
    controller.update(new Vector3(0, 0, 10), [new Vector3()], [blocker]);
    expect(blocker.material.opacity).toBe(OCCLUSION_OPACITY);
    controller.update(new Vector3(0, 0, 10), [new Vector3(0, 0, 9)], [blocker]);
    expect(blocker.material.opacity).toBe(1);
  });

  it('keeps sightline results invariant under world translation', () => {
    const coordinate = fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(fc.tuple(coordinate, coordinate, coordinate), ([x, y, z]) => {
        const blocker = wall(x, y, z + 5);
        const controller = new OcclusionFadeController();
        controller.update(new Vector3(x, y, z + 10), [new Vector3(x, y, z)], [blocker]);
        expect(blocker.material.opacity).toBe(OCCLUSION_OPACITY);
        controller.reset();
        expect(blocker.material.opacity).toBe(1);
      }),
    );
  });
});
