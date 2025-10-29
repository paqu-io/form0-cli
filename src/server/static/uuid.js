/**
 * Browser-friendly UUID v7 generator used by form0-cli UI.
 * Mirrors the implementation in form0-core but avoids cross-package imports.
 */

function getRandomBytes(length) {
  const array = new Uint8Array(length);
  const cryptoObj =
    (typeof globalThis !== 'undefined' && (globalThis.crypto || globalThis.msCrypto)) || null;

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(array);
    return array;
  }

  for (let i = 0; i < length; i += 1) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return array;
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateUuidV7(date = Date.now()) {
  const timestamp = BigInt(date);
  const bytes = new Uint8Array(16);

  for (let i = 0; i < 6; i += 1) {
    const shift = BigInt(8 * (5 - i));
    bytes[i] = Number((timestamp >> shift) & 0xffn);
  }

  const random = getRandomBytes(10);
  bytes.set(random, 6);

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // Version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC 4122

  return bytesToUuid(bytes);
}

export default generateUuidV7;
