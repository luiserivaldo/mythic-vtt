import { isValidCells, type BoundsDraft } from './bounds-form.js';

/** D37: width and height of the scene canvas in whole grid cells (1..200). Controlled. */
export function BoundsFields({
  label,
  draft,
  onChange,
}: {
  label: string;
  draft: BoundsDraft;
  onChange: (draft: BoundsDraft) => void;
}) {
  const field = (name: 'width' | 'height', text: string) => (
    <label>
      {text}{' '}
      <input
        type="number"
        min={1}
        max={200}
        step={1}
        inputMode="numeric"
        style={{ width: '5em' }}
        aria-label={`${label} ${name}`}
        aria-invalid={!isValidCells(draft[name])}
        value={draft[name]}
        onChange={(e) => {
          onChange({ ...draft, [name]: e.target.value });
        }}
      />
    </label>
  );
  return (
    <>
      {field('width', 'Width (cells)')}
      {field('height', 'Height (cells)')}
    </>
  );
}
