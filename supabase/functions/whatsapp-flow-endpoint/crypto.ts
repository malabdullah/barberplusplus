// WhatsApp Flows Encryption/Decryption Handler
// Uses RSA-OAEP for key exchange + AES-256-GCM for payload

const AUTH_TAG_LENGTH = 16;

export interface DecryptedFlowRequest {
  version: string;
  action: 'ping' | 'INIT' | 'data_exchange' | 'BACK';
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
}

export interface DecryptResult {
  decryptedData: DecryptedFlowRequest;
  aesKey: Uint8Array;
  iv: Uint8Array;
}

/**
 * Decrypt incoming WhatsApp Flow request
 * WhatsApp uses RSA-OAEP to encrypt an AES key, then AES-GCM to encrypt the payload
 */
export async function decryptFlowRequest(
  encryptedFlowData: string,
  encryptedAesKey: string,
  initialVector: string
): Promise<DecryptResult> {
  const privateKeyPem = Deno.env.get('WHATSAPP_FLOW_PRIVATE_KEY');

  if (!privateKeyPem) {
    throw new Error('Missing WHATSAPP_FLOW_PRIVATE_KEY environment variable');
  }

  // Decode base64 inputs
  const encryptedAesKeyBuffer = base64ToUint8Array(encryptedAesKey);
  const iv = base64ToUint8Array(initialVector);
  const encryptedDataBuffer = base64ToUint8Array(encryptedFlowData);

  // Import the private key
  const privateKey = await importPrivateKey(privateKeyPem);

  // Decrypt the AES key using RSA-OAEP
  const aesKeyBuffer = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    toArrayBuffer(encryptedAesKeyBuffer)
  );

  const aesKey = new Uint8Array(aesKeyBuffer);

  // Import AES key for decryption
  const aesKeyObj = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(aesKey),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt the flow data using AES-GCM
  // The auth tag is appended to the ciphertext
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      tagLength: AUTH_TAG_LENGTH * 8,
    },
    aesKeyObj,
    toArrayBuffer(encryptedDataBuffer)
  );

  const decryptedText = new TextDecoder().decode(decryptedBuffer);
  const decryptedData = JSON.parse(decryptedText) as DecryptedFlowRequest;

  return { decryptedData, aesKey, iv };
}

/**
 * Encrypt response to send back to WhatsApp
 * Uses the same AES key but with a flipped IV
 */
export async function encryptFlowResponse(
  response: unknown,
  aesKey: Uint8Array,
  iv: Uint8Array
): Promise<string> {
  // Generate response IV by flipping the bits of the original IV
  const responseIv = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) {
    responseIv[i] = ~iv[i] & 0xff;
  }

  // Import AES key for encryption
  const aesKeyObj = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(aesKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Encrypt the response
  const responseData = JSON.stringify(response);
  const encodedData = new TextEncoder().encode(responseData);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(responseIv),
      tagLength: AUTH_TAG_LENGTH * 8,
    },
    aesKeyObj,
    encodedData
  );

  // Return as base64
  return uint8ArrayToBase64(new Uint8Array(encryptedBuffer));
}

/**
 * Import RSA private key from PEM format
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and whitespace
  const pkcs8Label = 'PRIVATE KEY';
  const pkcs1Label = 'RSA PRIVATE KEY';
  const pemContent = pem
    .replace(new RegExp(`-----BEGIN ${pkcs8Label}-----`), '')
    .replace(new RegExp(`-----END ${pkcs8Label}-----`), '')
    .replace(new RegExp(`-----BEGIN ${pkcs1Label}-----`), '')
    .replace(new RegExp(`-----END ${pkcs1Label}-----`), '')
    .replace(/\s/g, '');

  const keyData = base64ToUint8Array(pemContent);

  // Import as PKCS#8 format
  return await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(keyData),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['decrypt']
  );
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
