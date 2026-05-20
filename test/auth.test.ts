import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { verifyAccessJwt, AuthError } from "../src/auth";

async function makeKey() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { publicKey, privateKey, jwk };
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

beforeEach(() => { globalThis.fetch = FETCH; env.KV.delete("jwks").catch(() => {}); });

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
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...other.jwk, kid: "other" }] }), { status: 200 }),
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
});
