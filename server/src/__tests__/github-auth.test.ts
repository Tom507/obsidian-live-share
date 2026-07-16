import type { IncomingMessage, Server, ServerResponse } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthRouter, verifyJWT } from "../github-auth.js";

// Matches the JWT_SECRET configured for the test environment (vitest.config.ts).
const TEST_SECRET = "test-secret-value";
const INSECURE_DEFAULT = "change-me-in-production";

describe("verifyJWT", () => {
  it("returns payload for a valid token", () => {
    const token = jwt.sign(
      {
        sub: "123456",
        username: "testuser",
        displayName: "Test User",
        avatar: "https://avatars.githubusercontent.com/u/123456",
      },
      TEST_SECRET,
      { expiresIn: "1h" },
    );

    const payload = verifyJWT(token);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("123456");
    expect(payload?.username).toBe("testuser");
    expect(payload?.displayName).toBe("Test User");
    expect(payload?.avatar).toBe("https://avatars.githubusercontent.com/u/123456");
    expect(payload?.iat).toBeTypeOf("number");
    expect(payload?.exp).toBeTypeOf("number");
  });

  it("returns null for an expired token", () => {
    const token = jwt.sign(
      {
        sub: "123456",
        username: "testuser",
        displayName: "Test User",
        avatar: null,
      },
      TEST_SECRET,
      { expiresIn: "-1s" },
    );

    expect(verifyJWT(token)).toBeNull();
  });

  it("returns null for a token signed with the wrong secret", () => {
    const token = jwt.sign(
      {
        sub: "123456",
        username: "testuser",
        displayName: "Test User",
        avatar: null,
      },
      "wrong-secret",
      { expiresIn: "1h" },
    );

    expect(verifyJWT(token)).toBeNull();
  });

  it("returns null for a garbage string", () => {
    expect(verifyJWT("not.a.valid.jwt.at.all")).toBeNull();
  });

  it("rejects a token forged with the insecure default secret", () => {
    // Attacker knows the well-known default; a properly configured server must
    // never accept it (would otherwise allow host takeover via a forged sub).
    const forged = jwt.sign(
      { sub: "123456", username: "victim", displayName: "Victim", avatar: null },
      INSECURE_DEFAULT,
      { expiresIn: "1h" },
    );
    expect(verifyJWT(forged)).toBeNull();
  });
});

describe("verifyJWT without a configured secret", () => {
  const ORIGINAL = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.JWT_SECRET = ORIGINAL;
    vi.resetModules();
  });

  it("never trusts a token when JWT_SECRET is unset (default secret disabled)", async () => {
    process.env.JWT_SECRET = undefined;
    vi.resetModules();
    const { verifyJWT: freshVerify } = await import("../github-auth.js");

    const token = jwt.sign(
      { sub: "123456", username: "attacker", displayName: "Attacker", avatar: null },
      INSECURE_DEFAULT,
      { expiresIn: "1h" },
    );
    expect(freshVerify(token)).toBeNull();
  });
});

describe("createAuthRouter", () => {
  let server: Server<typeof IncomingMessage, typeof ServerResponse>;
  let port: number;

  beforeEach(async () => {
    const app = express();
    app.use("/auth", createAuthRouter());
    server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.on("listening", resolve);
    });
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(() => {
    server.close();
  });

  it("GET /github redirects to GitHub OAuth2", async () => {
    const res = await fetch(`http://localhost:${port}/auth/github`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("github.com/login/oauth/authorize");
  });

  it("GET /github/callback without code returns 400", async () => {
    const res = await fetch(`http://localhost:${port}/auth/github/callback`);

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe("Missing code");
  });
});
