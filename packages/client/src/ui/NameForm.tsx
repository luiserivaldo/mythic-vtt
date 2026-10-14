import { useState, type SyntheticEvent } from 'react';

interface Props {
  label: string;
  submitLabel: string;
  initial?: string;
  validate: (text: string) => boolean;
  /** Resolves true when the host accepted it; the field then clears. */
  onSubmit: (text: string) => Promise<boolean>;
}

export function NameForm({ label, submitLabel, initial = '', validate, onSubmit }: Props) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    setBusy(true);
    void onSubmit(text)
      .then((ok) => {
        if (ok && initial === '') setText('');
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <form className="ui-row" onSubmit={submit}>
      <label>
        <span className="ui-visually-hidden">{label}</span>
        <input
          type="text"
          value={text}
          placeholder={label}
          maxLength={120}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={busy || !validate(text)}>
        {submitLabel}
      </button>
    </form>
  );
}
