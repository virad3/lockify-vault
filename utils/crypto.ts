/**
 * Sentinel Vault Crypto Utility
 * Uses Web Crypto API for secure, native, client-side encryption.
 * Algorithm: AES-GCM 256-bit
 * Key Derivation: PBKDF2 with SHA-256
 */

// Generate a derivation key from a raw password string
async function getPasswordKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
}

// Derive a strong AES-GCM key from the password key and a salt
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await getPasswordKey(password);
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt data object
export async function encryptData(data: any, masterKey: CryptoKey): Promise<{ cipherText: string; iv: string }> {
  const enc = new TextEncoder();
  const encodedData = enc.encode(JSON.stringify(data));
  
  // Random IV for every encryption
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptedContent = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    masterKey,
    encodedData
  );

  return {
    cipherText: bufferToBase64(encryptedContent),
    iv: bufferToBase64(iv.buffer as ArrayBuffer),
  };
}

// Decrypt data string
export async function decryptData(cipherText: string, ivStr: string, masterKey: CryptoKey): Promise<any> {
  try {
    const iv = base64ToBuffer(ivStr);
    const encryptedData = base64ToBuffer(cipherText);

    const decryptedContent = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      masterKey,
      encryptedData
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedContent));
  } catch (e) {
    console.error("Decryption failed", e);
    throw new Error("Failed to decrypt item. Wrong password?");
  }
}

// Helpers
export function generateSalt(): string {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  return bufferToBase64(salt.buffer as ArrayBuffer);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function stringToSalt(saltStr: string): Uint8Array {
    return new Uint8Array(base64ToBuffer(saltStr));
}
