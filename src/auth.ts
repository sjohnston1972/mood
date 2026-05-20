import type { Env, Identity } from "./types";

export class AuthError extends Error {}

interface JwkRsa { kid: string; kty: "RSA"; alg?: string; n: string; e: string; use?: string; }

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function b64urlDecodeJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s))) as T;
}

async function loadJwks(env: Env): Promise<JwkRsa[]> {
  const cached = await env.KV.get("jwks", "json") as { keys: JwkRsa[]; fetched_at: number } | null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.fetched_at < 3600) return cached.keys;
  const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new AuthError(`JWKS fetch failed: ${res.status}`);
  const body = await res.json<{ keys: JwkRsa[] }>();
  await env.KV.put("jwks", JSON.stringify({ keys: body.keys, fetched_at: now }), { expirationTtl: 3600 });
  return body.keys;
}

interface JwtHeader { alg: string; kid: string; typ?: string; }
interface JwtClaims { iss: string; aud: string | string[]; email?: string; exp: number; iat?: number; }

export async function verifyAccessJwt(env: Env, token: string): Promise<Identity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = b64urlDecodeJson<JwtHeader>(headerB64);
    claims = b64urlDecodeJson<JwtClaims>(payloadB64);
  } catch {
    throw new AuthError("malformed token");
  }
  if (header.alg !== "RS256") throw new AuthError("unsupported alg");

  const keys = await loadJwks(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError("unknown signing key");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true } as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"],
  );
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, b64urlDecode(sigB64), signed);
  if (!ok) throw new AuthError("invalid signature");

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new AuthError("token expired");
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new AuthError("bad iss");
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(env.ACCESS_AUD)) throw new AuthError("bad aud");
  if (!claims.email) throw new AuthError("no email claim");

  return { email: claims.email };
}

export async function identify(req: Request, env: Env): Promise<Identity | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (token) {
    try { return await verifyAccessJwt(env, token); }
    catch { return null; }
  }
  if (env.DEV_FAKE_EMAIL) return { email: env.DEV_FAKE_EMAIL };
  return null;
}
