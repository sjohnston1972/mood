import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { verifyAccessJwt, identify, AuthError } from "../src/auth";

async function makeKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey, jwk };
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid };
  const part = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(part));
  return `${part}.${b64url(sig)}`;
}

const FETCH = globalThis.fetch;

beforeEach(async () => { globalThis.fetch = FETCH; await env.KV.delete("jwks").catch(() => {}); });

describe("verifyAccessJwt", () => {
  it("accepts a valid token, returns email", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`,
      aud: env.ACCESS_AUD,
      email: "ok@example.com",
      exp: now + 60, iat: now,
    });
    const ident = await verifyAccessJwt(env, token);
    expect(ident.email).toBe("ok@example.com");
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now - 10, iat: now - 60,
    });
    await expect(verifyAccessJwt(env, token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a wrong audience", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: "wrong-aud",
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    await expect(verifyAccessJwt(env, token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token signed with an unknown key", async () => {
    const { privateKey } = await makeKey();
    const other = await makeKey();
    // Return a fresh Response per call: an unknown kid now forces one JWKS refetch,
    // so the mock is invoked twice and each call must have an unconsumed body.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ keys: [{ ...other.jwk, kid: "other" }] }), { status: 200 })),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, "missing-kid", {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    await expect(verifyAccessJwt(env, token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a tampered signature", async () => {
    const { privateKey, jwk } = await makeKey();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, "k1", {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    const tampered = token.slice(0, -4) + "AAAA";
    await expect(verifyAccessJwt(env, tampered)).rejects.toBeInstanceOf(AuthError);
  });

  it("forces a JWKS refetch when the kid is unknown, then succeeds", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "rotated";
    globalThis.fetch = vi.fn()
      // First fetch: JWKS WITHOUT the signing key (stale cache scenario).
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [] }), { status: 200 }))
      // Second (forced) fetch: JWKS WITH the rotated key.
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }));
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    const ident = await verifyAccessJwt(env, token);
    expect(ident.email).toBe("ok@example.com");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("enforces OWNER_EMAILS allowlist when set", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const mkToken = (email: string) => signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email, exp: now + 60, iat: now,
    });
    const prev = (env as any).OWNER_EMAILS;
    try {
      (env as any).OWNER_EMAILS = "owner@example.com, Second@Example.com";
      // Not listed -> rejected.
      await expect(verifyAccessJwt(env, await mkToken("intruder@example.com")))
        .rejects.toBeInstanceOf(AuthError);
      // Listed (case-insensitive) -> accepted.
      const ident = await verifyAccessJwt(env, await mkToken("OWNER@example.com"));
      expect(ident.email).toBe("OWNER@example.com");
    } finally {
      (env as any).OWNER_EMAILS = prev;
    }
  });
});

describe("identify", () => {
  it("dev fallback is fail-closed in production, active otherwise", async () => {
    const req = new Request("https://example.com/", { headers: {} });
    const prevEnvironment = (env as any).ENVIRONMENT;
    const prevFake = (env as any).DEV_FAKE_EMAIL;
    try {
      (env as any).DEV_FAKE_EMAIL = "dev@example.com";

      (env as any).ENVIRONMENT = "production";
      expect(await identify(req, env)).toBeNull();

      delete (env as any).ENVIRONMENT;
      expect(await identify(req, env)).toEqual({ email: "dev@example.com" });
    } finally {
      (env as any).ENVIRONMENT = prevEnvironment;
      (env as any).DEV_FAKE_EMAIL = prevFake;
    }
  });
});
