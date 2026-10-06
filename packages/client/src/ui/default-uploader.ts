import { createHttpUploader } from '../assets/image-upload.js';
import { loadOrCreateIdentity } from '../net/identity.js';

const randomByte = () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;

/** Same-origin uploader that sends this browser's identity credential (D36). */
export const defaultUploader = createHttpUploader('', undefined, () =>
  loadOrCreateIdentity(localStorage, Date.now(), randomByte),
);
