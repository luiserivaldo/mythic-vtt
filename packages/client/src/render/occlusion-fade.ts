import { Raycaster, Vector3, type Intersection, type Material, type Mesh } from 'three';

export const OCCLUSION_OPACITY = 0.18;
interface OriginalMaterial {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

/** CAM-05: only the finite sightline to a token matters, never geometry behind it. */
export class OcclusionFadeController {
  private readonly ray = new Raycaster();
  private readonly direction = new Vector3();
  private readonly originals = new Map<Material, OriginalMaterial>();
  private readonly occluded = new Set<Material>();
  private readonly candidates: Mesh[] = [];
  private readonly hits: Intersection[] = [];

  update(camera: Vector3, targets: readonly Vector3[], meshes: readonly Mesh[]): void {
    const occluded = this.occluded;
    occluded.clear();
    this.candidates.length = 0;
    for (const mesh of meshes) this.candidates.push(mesh);
    for (const target of targets) {
      this.direction.subVectors(target, camera);
      const distance = this.direction.length();
      if (distance < 0.001) continue;
      this.ray.set(camera, this.direction.divideScalar(distance));
      this.ray.near = 0;
      this.ray.far = distance - 0.001;
      this.hits.length = 0;
      for (const hit of this.ray.intersectObjects(this.candidates, false, this.hits)) {
        const mesh = hit.object as Mesh;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          occluded.add(material);
        }
      }
    }
    for (const material of occluded) {
      if (!this.originals.has(material)) {
        this.originals.set(material, {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
        });
      }
      const original = this.originals.get(material);
      if (!original) continue;
      if (!material.transparent) {
        material.transparent = true;
        material.needsUpdate = true;
      }
      material.opacity = original.opacity * OCCLUSION_OPACITY;
      material.depthWrite = false;
    }
    for (const [material, original] of this.originals) {
      if (occluded.has(material)) continue;
      this.restore(material, original);
      this.originals.delete(material);
    }
  }

  reset(): void {
    for (const [material, original] of this.originals) this.restore(material, original);
    this.originals.clear();
    this.occluded.clear();
    this.candidates.length = 0;
    this.hits.length = 0;
  }

  private restore(material: Material, original: OriginalMaterial): void {
    if (material.transparent !== original.transparent) material.needsUpdate = true;
    material.opacity = original.opacity;
    material.transparent = original.transparent;
    material.depthWrite = original.depthWrite;
  }
}
