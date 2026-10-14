import { useEffect, useRef, useState } from 'react';
import { IDENTITY_STORAGE_KEY, type Identity } from '../net/identity.js';
import {
  IDENTITY_FILE_MAX_BYTES,
  installIdentityFile,
  parseIdentityFile,
  serializeIdentityFile,
} from '../net/identity-file.js';
import {
  IDENTITY_QR_ERROR,
  IDENTITY_QR_TOO_LARGE,
  encodeIdentityQr,
  parseIdentityQr,
} from '../net/identity-qr.js';
import type { QrCode } from '../net/qr.js';
import { useJoinEnv } from './join-context.js';
import { pollQrText } from './qr-scan.js';
import { qrSvg } from './qr-svg.js';

/** The browser's built-in QR reader; absent on most desktop browsers. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<readonly { rawValue: string }[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
}

function barcodeDetector(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

const SCAN_UNSUPPORTED = 'This browser cannot scan QR codes. Use the identity file instead.';
const SCAN_DENIED =
  'The camera could not be started. Allow camera access or use the identity file.';
const SCAN_TIMEOUT = 'No QR code was found. Hold the code steady and try again.';
const QR_FAILED = 'The identity QR code could not be created.';

export function IdentityTransfer() {
  const env = useJoinEnv();
  const [pending, setPending] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<QrCode | null>(null);
  const [scanning, setScanning] = useState(false);
  const camera = useRef<HTMLVideoElement | null>(null);
  const generation = useRef(0);

  // The camera only runs while the reader is open, and stops on success, failure, cancel or unmount.
  useEffect(() => {
    if (!scanning) return;
    const video = camera.current;
    const Detector = barcodeDetector();
    const media = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
    if (!video || !Detector || !media) {
      setError(SCAN_UNSUPPORTED);
      setScanning(false);
      return;
    }
    let stream: MediaStream | null = null;
    const controller = new AbortController();
    // A call, not the property itself: control-flow analysis would otherwise narrow it away.
    const aborted = (): boolean => controller.signal.aborted;
    const release = (): void => {
      controller.abort();
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
    void (async () => {
      try {
        stream = await media.getUserMedia({ video: true });
        if (aborted()) return;
        video.srcObject = stream;
        // Playback is not awaited: a preview that never starts must not block the reader.
        void video.play().catch(() => undefined);
        const detector = new Detector({ formats: ['qr_code'] });
        const scanned = await pollQrText(
          async () => {
            const codes = await detector.detect(video).catch(() => []);
            return codes.find((found) => found.rawValue !== '')?.rawValue ?? null;
          },
          { signal: controller.signal },
        );
        if (aborted()) return;
        if (!scanned.ok) {
          setError(SCAN_TIMEOUT);
          return;
        }
        setError(null);
        setPending(parseIdentityQr(scanned.text));
      } catch (failure) {
        if (aborted()) return;
        setError(
          failure instanceof Error && failure.message === IDENTITY_QR_ERROR
            ? IDENTITY_QR_ERROR
            : SCAN_DENIED,
        );
      } finally {
        for (const track of stream?.getTracks() ?? []) track.stop();
        if (!aborted()) setScanning(false);
      }
    })();
    return () => {
      release();
    };
  }, [scanning]);

  if (!env || env.readOnlyVisitor) return null;

  const download = () => {
    try {
      const identity = parseIdentityFile(env.storage.getItem(IDENTITY_STORAGE_KEY) ?? '');
      const blob = new Blob([serializeIdentityFile(identity)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mythic-identity.json';
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      setError(null);
    } catch {
      setError('The identity backup could not be downloaded.');
    }
  };

  const toggleQr = () => {
    if (qr) {
      setQr(null);
      return;
    }
    try {
      const identity = parseIdentityFile(env.storage.getItem(IDENTITY_STORAGE_KEY) ?? '');
      setQr(encodeIdentityQr(identity));
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === IDENTITY_QR_TOO_LARGE
          ? failure.message
          : QR_FAILED,
      );
    }
  };

  const code = qr === null ? null : qrSvg(qr);

  return (
    <details>
      <summary>Identity backup and transfer</summary>
      <p>
        This file contains your identity secret. Anyone with it can access your identity. Keep it
        private. Files and QR codes are handled in this browser and are never uploaded.
      </p>
      <button type="button" onClick={download}>
        Download identity backup
      </button>
      <label>
        Identity file
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const version = ++generation.current;
            setPending(null);
            setError(null);
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > IDENTITY_FILE_MAX_BYTES) {
              setError('This is not a valid Mythic identity file.');
              return;
            }
            void file
              .text()
              .then((text) => {
                if (generation.current !== version) return;
                setPending(parseIdentityFile(text));
              })
              .catch(() => {
                if (generation.current === version)
                  setError('This is not a valid Mythic identity file.');
              });
          }}
        />
      </label>
      <button type="button" onClick={toggleQr}>
        {qr ? 'Hide QR code' : 'Show QR code'}
      </button>
      {code !== null && (
        <div className="ui-identity-qr">
          <svg
            role="img"
            aria-label="Identity QR code"
            viewBox={code.viewBox}
            width={220}
            height={220}
            shapeRendering="crispEdges"
          >
            <rect x="0" y="0" width={code.extent} height={code.extent} fill="#ffffff" />
            <path d={code.path} fill="#000000" />
          </svg>
          <p>
            Scan this code with the other device. Anyone who scans it can use your identity, so keep
            it off shared screens.
          </p>
        </div>
      )}
      <button
        type="button"
        disabled={scanning}
        onClick={() => {
          setError(null);
          setScanning(true);
        }}
      >
        Scan an identity QR code
      </button>
      {scanning && (
        <>
          <video ref={camera} aria-label="Camera preview" muted playsInline width={220} />
          <p>Point the camera at the identity QR code.</p>
          <button
            type="button"
            onClick={() => {
              setScanning(false);
            }}
          >
            Cancel scanning
          </button>
        </>
      )}
      {pending && (
        <>
          <p>Identity: {pending.identityId}</p>
          <p>
            Import replaces this browser’s identity and reconnects. Campaign data stays on the game
            host.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                installIdentityFile(env.storage, pending);
                env.session.stop();
                window.location.reload();
              } catch {
                setError('The identity could not be saved. Check browser storage and try again.');
              }
            }}
          >
            Replace identity and reload
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
