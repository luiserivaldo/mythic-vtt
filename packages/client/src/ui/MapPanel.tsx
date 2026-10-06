import type { Campaign } from '@mythic/shared';
import { useId, useMemo, useState, type ChangeEvent } from 'react';
import { useStore } from 'zustand';
import { UploadError, uploadFailureMessage, type ImageUploader } from '../assets/image-upload.js';
import { solveCalibration, type CalibrationUnit } from '../tools/battlemap-calibration.js';
import { calibrationStore } from '../tools/battlemap-store.js';
import { defaultUploader } from './default-uploader.js';
import { newId } from './ids.js';
import { fileLabel, mapCalibrateIntent, mapPlaceIntent, mapRows } from './map-panel.js';
import { useSubmit } from './submit.js';

const CALIBRATION_ERRORS = {
  'identical-points': 'The two points are the same spot. Click two different points.',
  'invalid-distance': 'Enter a distance greater than zero.',
  'invalid-grid': 'This scene grid is not valid for calibration.',
} as const;

/** ENV-01: upload a battlemap, then align it to the grid with a 2-point calibration. DM only. */
export function MapPanel({
  campaign,
  uploader = defaultUploader,
}: {
  campaign: Campaign;
  uploader?: ImageUploader;
}) {
  const { send, error } = useSubmit();
  const calibratingId = useStore(calibrationStore, (s) => s.entityId);
  const points = useStore(calibrationStore, (s) => s.points);
  const [distance, setDistance] = useState('');
  const [unit, setUnit] = useState<CalibrationUnit>('scene');
  const [snap, setSnap] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const imageInputId = useId();

  const scene = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  const rows = useMemo(() => (scene ? mapRows(scene) : []), [scene]);
  const target = scene && calibratingId ? scene.entities[calibratingId] : undefined;

  if (!scene) {
    return (
      <section aria-labelledby="ui-map-h" className="ui-panel">
        <h2 id="ui-map-h">Battlemap</h2>
        <p>No active scene.</p>
      </section>
    );
  }
  const { unitsPerCell, unitLabel } = scene.grid;

  const distanceValue = Number(distance);
  const [a, b] = points;
  const solved =
    target && a && b
      ? solveCalibration({
          a,
          b,
          distance: distanceValue,
          unit,
          unitsPerCell,
          current: { position: target.transform.position, scale: target.transform.scale.x },
          anchor: snap ? 'snap' : 'keep',
        })
      : null;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file || !scene) return;
    setBusy(true);
    setUploadError(null);
    try {
      const uploaded = await uploader(file);
      await send(
        mapPlaceIntent({
          sceneId: scene.id,
          entityId: newId(),
          name: fileLabel(file.name),
          hash: uploaded.hash,
          heightPx: uploaded.height,
        }),
      );
    } catch (e) {
      setUploadError(
        e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed unexpectedly.',
      );
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  function apply() {
    if (!scene || !target || !solved?.ok) return;
    const spec = mapCalibrateIntent({
      sceneId: scene.id,
      entity: target,
      scale: solved.scale,
      position: solved.position,
    });
    if (!spec) return;
    void send(spec).then((ok) => {
      if (ok) {
        calibrationStore.getState().cancel();
        setDistance('');
      }
    });
  }

  return (
    <section aria-labelledby="ui-map-h" className="ui-panel">
      <h2 id="ui-map-h">Battlemap</h2>
      <div className="ui-row ui-file-field" role="group" aria-labelledby={`${imageInputId}-title`}>
        <span id={`${imageInputId}-title`}>Upload image</span>
        <input
          id={imageInputId}
          className="ui-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          aria-labelledby={`${imageInputId}-title ${imageInputId}-button`}
          onChange={(e) => {
            void onFile(e);
          }}
        />
        <label id={`${imageInputId}-button`} className="ui-file-button" htmlFor={imageInputId}>
          Choose file
        </label>
      </div>
      {uploadError && <p role="alert">{uploadError}</p>}
      {rows.length === 0 && <p>No battlemap in this scene yet.</p>}
      <ul className="ui-list">
        {rows.map((row) => (
          <li key={row.id} className="ui-row">
            <strong>{row.name}</strong>
            <span className="ui-badge">{row.calibrated ? 'Calibrated' : 'Not calibrated'}</span>
            <button
              type="button"
              aria-pressed={calibratingId === row.id}
              onClick={() => {
                if (calibratingId === row.id) calibrationStore.getState().cancel();
                else calibrationStore.getState().start(row.id);
              }}
            >
              {calibratingId === row.id ? 'Stop calibrating' : 'Calibrate'}
            </button>
          </li>
        ))}
      </ul>
      {target && (
        <div role="group" aria-label="Calibration">
          <p>
            Click two points on the image whose real distance you know ({points.length} of 2
            picked).
          </p>
          <div className="ui-row">
            <label>
              Distance between the points{' '}
              <input
                type="number"
                min="0"
                step="any"
                value={distance}
                onChange={(e) => {
                  setDistance(e.target.value);
                }}
              />
            </label>
            <label>
              <span className="ui-visually-hidden">Distance unit</span>
              <select
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value === 'cells' ? 'cells' : 'scene');
                }}
              >
                <option value="scene">{unitLabel}</option>
                <option value="cells">grid cells</option>
              </select>
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => {
                setSnap(e.target.checked);
              }}
            />{' '}
            Snap the first point to the nearest grid intersection
          </label>
          {solved?.ok && (
            <p>
              Result: {solved.cells.toFixed(2)} cells apart; map height {solved.scale.toFixed(2)}{' '}
              cells ({(solved.scale * unitsPerCell).toFixed(1)} {unitLabel}).
            </p>
          )}
          {solved && !solved.ok && distance !== '' && (
            <p role="alert">{CALIBRATION_ERRORS[solved.error]}</p>
          )}
          <div className="ui-row">
            <button type="button" disabled={!solved?.ok} onClick={apply}>
              Apply calibration
            </button>
            <button
              type="button"
              onClick={() => {
                calibrationStore.getState().resetPoints();
              }}
            >
              Reset points
            </button>
            <button
              type="button"
              onClick={() => {
                calibrationStore.getState().cancel();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
