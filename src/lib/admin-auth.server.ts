import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestIP,
  getRequestProtocol,
  setCookie,
} from "@tanstack/react-start/server";

const COOKIE_NAME = "mintfinder_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; expiresAt: number }>();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  if (!/^[\w-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function sessionSecret() {
  const secret = process.env["ADMIN_SESSION_SECRET"];
  if (!secret || secret.length < 32) {
    throw new Error("Set ADMIN_SESSION_SECRET to a random value at least 32 characters long.");
  }
  return secret;
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function attemptsForRequest() {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (value.expiresAt <= now) attempts.delete(key);
  }
  const key = getRequestIP() ?? "unknown";
  const current = attempts.get(key);
  if (current && current.count >= MAX_ATTEMPTS && current.expiresAt > now) {
    throw new Error("Too many attempts. Wait 15 minutes and try again.");
  }
  return {
    fail() {
      const state = attempts.get(key);
      if (!state || state.expiresAt <= now) {
        attempts.set(key, { count: 1, expiresAt: now + ATTEMPT_WINDOW_MS });
      } else {
        state.count += 1;
      }
    },
    reset() {
      attempts.delete(key);
    },
  };
}

export const verifyAdminPassword = createServerOnlyFn(async (password: string) => {
  const configured = process.env["ADMIN_PASSWORD"];
  if (!configured || configured.length < 16) {
    throw new Error("Set ADMIN_PASSWORD to a private password at least 16 characters long.");
  }
  const [submittedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(configured)),
  ]);
  const submitted = new Uint8Array(submittedHash);
  const expected = new Uint8Array(configuredHash);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (submitted[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
});

export const loginWithAdminPassword = createServerOnlyFn(async (password: string) => {
  const rateLimit = attemptsForRequest();
  if (!(await verifyAdminPassword(password))) {
    rateLimit.fail();
    throw new Error("Incorrect admin password. You remain a public user.");
  }
  rateLimit.reset();

  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ expiresAt: Date.now() + SESSION_SECONDS * 1000 })),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(payload)),
  );
  setCookie(COOKIE_NAME, `${payload}.${base64UrlEncode(signature)}`, {
    httpOnly: true,
    secure: getRequestProtocol() === "https",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
});

export const hasAdminSession = createServerOnlyFn(async () => {
  const token = getCookie(COOKIE_NAME);
  if (!token || token.length > 1024) return false;
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra !== undefined) return false;
  const signature = base64UrlDecode(encodedSignature);
  if (!signature) return false;

  const key = await signingKey();
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(payload),
  );
  if (!valid) return false;

  const payloadBytes = base64UrlDecode(payload);
  if (!payloadBytes) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("expiresAt" in parsed) ||
    typeof parsed.expiresAt !== "number"
  ) {
    return false;
  }
  return parsed.expiresAt > Date.now();
});

export const clearAdminSession = createServerOnlyFn(() => {
  deleteCookie(COOKIE_NAME, { path: "/" });
});

export const requireAdminSession = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    if (!(await hasAdminSession())) throw new Error("Admin session expired. Sign in again.");
    return next();
  },
);
