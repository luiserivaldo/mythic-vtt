import type { ReactNode } from 'react';
import './error-notice.css';

/**
 * A failure told in plain words, with the technical detail folded away under "Error details" for
 * whoever has to debug it. `children` is the slot for the screen's own actions (Reload, ...).
 */
export function ErrorNotice({
  message,
  details,
  children,
}: {
  message: string;
  details?: string | ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="error-notice">
      <p role="alert">{message}</p>
      {details !== undefined && (
        <details className="error-notice-details">
          <summary>Error details</summary>
          {typeof details === 'string' ? <pre>{details}</pre> : details}
        </details>
      )}
      {children}
    </div>
  );
}
