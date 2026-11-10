import { createHash, createPublicKey, verify as cryptoVerify, randomBytes } from 'crypto';
import { env } from './env';

/**
 * WebAuthn helpers wire-compatible with the PHP `lbuchs/webauthn` flow used by login.min.js:
 *  - binary values are sent as "=?BINARY?B?<base64>?="
 *  - public keys are stored as PEM in user_devices.credential_public_key
 *  - credential ids are stored as standard base64 of the raw id
 */
export const rpId = () => new URL(env.SITE_URL).hostname;
export const rpName = () => env.SITE_NAME;

const bin = (b: Buffer | Uint8Array) => `=?BINARY?B?${Buffer.from(b).toString('base64')}?=`;
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function newChallenge() { return randomBytes(32); }

export function getGetArgs(credentialIds: Buffer[], challenge: Buffer, external: boolean) {
  const transports: string[] = ['internal'];
  if (external) transports.push('usb', 'nfc', 'ble', 'hybrid');
  const publicKey: any = {
    rpId: rpId(),
    challenge: bin(challenge),
    timeout: 20000,
    userVerification: 'preferred',
  };
  if (credentialIds.length) publicKey.allowCredentials = credentialIds.map((id) => ({ id: bin(id), type: 'public-key', transports }));
  return { publicKey };
}

export function getCreateArgs(userId: string, userName: string, displayName: string, challenge: Buffer) {
  return {
    publicKey: {
      rp: { name: rpName(), id: rpId() },
      authenticatorSelection: { userVerification: 'required' },
      user: { id: bin(Buffer.from(userId)), name: userName, displayName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      attestation: 'none',
      timeout: 20000,
      challenge: bin(challenge),
    },
  };
}

function checkClientData(clientDataJSON: Buffer, type: string, challenge: Buffer) {
  const cd = JSON.parse(clientDataJSON.toString('utf8'));
  if (cd.type !== type) throw new Error('invalid type in client data');
  if (!cd.challenge || !fromB64(cd.challenge).equals(challenge)) throw new Error('invalid challenge');
  let host = '';
  try { host = new URL(cd.origin).hostname; } catch { /* */ }
  if (host !== rpId()) throw new Error('invalid origin');
}

/** Verify an assertion against a stored PEM public key. Throws on failure. */
export function processGet(clientDataJSON: Buffer, authenticatorData: Buffer, signature: Buffer, publicKeyPem: string, challenge: Buffer) {
  checkClientData(clientDataJSON, 'webauthn.get', challenge);
  if (authenticatorData.length < 37) throw new Error('invalid authenticatorData');
  if (!authenticatorData.subarray(0, 32).equals(createHash('sha256').update(rpId()).digest())) throw new Error('invalid rpId hash');
  const flags = authenticatorData[32];
  if (!(flags & 0x01)) throw new Error('user not present');
  if (!(flags & 0x04)) throw new Error('user verification required');
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  const ok = cryptoVerify('sha256', signed, createPublicKey(publicKeyPem), signature);
  if (!ok) throw new Error('invalid signature');
  return true;
}

/** Verify attestation and return credential id (raw) + PEM public key */
export async function processCreate(clientDataJSON: Buffer, attestationObject: Buffer, challenge: Buffer) {
  const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
  const { decodeCredentialPublicKey, isoBase64URL } = await import('@simplewebauthn/server/helpers');
  const cd = JSON.parse(clientDataJSON.toString('utf8'));
  const result = await verifyRegistrationResponse({
    response: {
      id: 'x', rawId: 'x', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject) },
    } as any,
    expectedChallenge: b64url(challenge),
    expectedOrigin: cd.origin,
    expectedRPID: rpId(),
    requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) throw new Error('registration could not be verified');
  const info: any = result.registrationInfo;
  const cred = info.credential ?? { id: info.credentialID, publicKey: info.credentialPublicKey };
  const credentialId = typeof cred.id === 'string' ? Buffer.from(isoBase64URL.toBuffer(cred.id)) : Buffer.from(cred.id);
  const cose: Map<number, any> = decodeCredentialPublicKey(cred.publicKey) as any;
  const kty = cose.get(1);
  let jwk: any;
  if (kty === 2) jwk = { kty: 'EC', crv: 'P-256', x: b64url(Buffer.from(cose.get(-2))), y: b64url(Buffer.from(cose.get(-3))) };
  else if (kty === 3) jwk = { kty: 'RSA', n: b64url(Buffer.from(cose.get(-1))), e: b64url(Buffer.from(cose.get(-2))) };
  else throw new Error('unsupported key type');
  const pem = createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' }) as string;
  return { credentialId, credentialPublicKey: pem };
}
