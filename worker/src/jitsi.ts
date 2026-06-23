export function generateUid(): string {
  return `booking-${crypto.randomUUID()}`;
}

export async function generateJitsiUrl(
  uid: string,
  start: Date,
  end: Date,
  appId: string,
  keyId: string,
  privateKeyPem: string
): Promise<string> {
  const token = await signJaasJwt(uid, start, end, appId, keyId, privateKeyPem);
  return `https://8x8.vc/${appId}/${uid}?jwt=${token}`;
}

async function signJaasJwt(
  room: string,
  start: Date,
  end: Date,
  appId: string,
  keyId: string,
  privateKeyPem: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nbf = Math.floor(start.getTime() / 1000) - 15 * 60;
  const exp = Math.floor(end.getTime() / 1000) + 30 * 60;

  const header = { alg: "RS256", typ: "JWT", kid: `${appId}/${keyId}` };
  const payload = {
    iss: "chat",
    iat: now,
    exp,
    nbf,
    room,
    sub: appId,
    context: {
      user: {
        id: "guest",
        name: "Guest",
        email: "",
        moderator: false,
      },
      features: {
        recording: false,
        livestreaming: false,
        "outbound-call": false,
      },
    },
  };

  const signingInput =
    b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;
}

function b64url(str: string): string {
  return b64urlBytes(new TextEncoder().encode(str));
}

function b64urlBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0)
  );
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
