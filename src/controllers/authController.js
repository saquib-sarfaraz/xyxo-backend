import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import User from "../models/User.js";
import RefreshToken from "../models/RefreshToken.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../config/jwt.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";

const AUTH_DEBUG = env.AUTH_DEBUG === "true";

const cookieOptions = ({ expiresAt } = {}) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: env.REFRESH_TOKEN_COOKIE_PATH,
  ...(expiresAt ? { expires: expiresAt } : {})
});

const extractCookie = (cookieHeader, name) => {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    const rawValue = part.slice(idx + 1).trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
};

const normalizeToken = (value) => {
  if (typeof value !== "string") return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  if (match) trimmed = match[1].trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
  return trimmed;
};

const extractRefreshToken = (req) => {
  const cookieToken = extractCookie(req.headers.cookie, env.REFRESH_TOKEN_COOKIE_NAME);
  if (cookieToken) return normalizeToken(cookieToken);
  if (req.body?.refreshToken) return normalizeToken(req.body.refreshToken);
  if (typeof req.headers.authorization === "string") {
    return normalizeToken(req.headers.authorization);
  }
  return null;
};

const issueTokens = async ({ user, req, res }) => {
  const userId = user._id.toString();

  const accessToken = signAccessToken({ sub: userId });

  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken({ sub: userId, jti });
  const decoded = verifyRefreshToken(refreshToken);
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : null;
  if (!expiresAt) throw new HttpError(500, "Failed to issue refresh token");

  await RefreshToken.create({
    user: user._id,
    jti,
    expiresAt,
    createdByIp: String(req.ip || ""),
    userAgent: String(req.get("user-agent") || "")
  });

  res.cookie(env.REFRESH_TOKEN_COOKIE_NAME, refreshToken, cookieOptions({ expiresAt }));

  return { accessToken };
};

const USERNAME_MIN = 3;
const USERNAME_MAX = 24;

const usernameBaseFromEmail = (email) => {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const clipped = cleaned.slice(0, USERNAME_MAX);
  if (clipped.length >= USERNAME_MIN) return clipped;
  return "user";
};

const withSuffix = (base, suffix) => {
  const safeBase = String(base || "").slice(0, USERNAME_MAX);
  const safeSuffix = String(suffix || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const sep = "_";
  const maxBaseLen = USERNAME_MAX - (sep.length + safeSuffix.length);
  const truncatedBase = safeBase.slice(0, Math.max(0, maxBaseLen));
  return `${truncatedBase}${sep}${safeSuffix}`.slice(0, USERNAME_MAX);
};

const ensureUniqueUsername = async (base) => {
  const root = String(base || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USERNAME_MAX);

  const first = root.length >= USERNAME_MIN ? root : "user";
  const exists = await User.exists({ username: first });
  if (!exists) return first;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(2).toString("hex");
    const candidate = withSuffix(first, suffix);
    const taken = await User.exists({ username: candidate });
    if (!taken) return candidate;
  }

  return withSuffix("user", crypto.randomBytes(3).toString("hex"));
};

export const signup = asyncHandler(async (req, res) => {
  const { name, username, email, password } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const providedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";

  if (AUTH_DEBUG) {
    console.log("[AUTH] signup", {
      hasName: Boolean(name),
      hasUsername: Boolean(providedUsername),
      hasEmail: Boolean(normalizedEmail),
      passwordLength: typeof password === "string" ? password.length : 0
    });
  }

  if (!providedUsername && !normalizedEmail) {
    throw new HttpError(400, "username or email is required");
  }

  if (normalizedEmail) {
    const existingByEmail = await User.exists({ email: normalizedEmail });
    if (existingByEmail) throw new HttpError(409, "Email already in use");
  }

  const normalizedUsername = providedUsername
    ? providedUsername
    : await ensureUniqueUsername(usernameBaseFromEmail(normalizedEmail));

  if (providedUsername) {
    const existing = await User.exists({ username: normalizedUsername });
    if (existing) throw new HttpError(409, "Username already taken");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    username: normalizedUsername,
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    passwordHash
  });

  const { accessToken } = await issueTokens({ user, req, res });
  res.status(201).json({ token: accessToken, accessToken, user });
});

export const login = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";

  if (AUTH_DEBUG) {
    console.log("[AUTH] login", {
      loginBy: normalizedEmail ? "email" : "username",
      hasEmail: Boolean(normalizedEmail),
      hasUsername: Boolean(normalizedUsername),
      passwordLength: typeof password === "string" ? password.length : 0
    });
  }

  const query = normalizedEmail ? { email: normalizedEmail } : { username: normalizedUsername };
  const user = await User.findOne(query).select("+passwordHash");
  if (!user) throw new HttpError(404, "User not found");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(400, "Invalid credentials");

  const { accessToken } = await issueTokens({ user, req, res });
  user.passwordHash = undefined;

  res.json({ token: accessToken, accessToken, user });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = extractRefreshToken(req);
  if (!token) throw new HttpError(401, "Missing refresh token");

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (err) {
    res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, cookieOptions());
    if (err?.name === "TokenExpiredError") throw new HttpError(401, "Refresh token expired");
    throw new HttpError(401, "Invalid refresh token");
  }

  if (decoded?.type && decoded.type !== "refresh") throw new HttpError(401, "Invalid refresh token");

  const userId = decoded?.sub;
  const jti = decoded?.jti;
  if (!userId || !jti) throw new HttpError(401, "Invalid refresh token");

  const stored = await RefreshToken.findOne({ user: userId, jti, revokedAt: null });
  if (!stored) {
    res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, cookieOptions());
    throw new HttpError(401, "Invalid refresh token");
  }

  if (stored.expiresAt && stored.expiresAt.getTime() <= Date.now()) {
    await RefreshToken.updateOne({ _id: stored._id }, { $set: { revokedAt: new Date() } });
    res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, cookieOptions());
    throw new HttpError(401, "Refresh token expired");
  }

  const user = await User.findById(userId).select("_id");
  if (!user) {
    await RefreshToken.updateOne({ _id: stored._id }, { $set: { revokedAt: new Date() } });
    res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, cookieOptions());
    throw new HttpError(401, "Unauthorized");
  }

  // Rotate refresh token on every use.
  const newJti = crypto.randomUUID();
  const newRefreshToken = signRefreshToken({ sub: String(userId), jti: newJti });
  const newDecoded = verifyRefreshToken(newRefreshToken);
  const newExpiresAt = newDecoded?.exp ? new Date(newDecoded.exp * 1000) : null;
  if (!newExpiresAt) throw new HttpError(500, "Failed to issue refresh token");

  await Promise.all([
    RefreshToken.updateOne(
      { _id: stored._id },
      { $set: { revokedAt: new Date(), replacedByTokenJti: newJti } }
    ),
    RefreshToken.create({
      user: user._id,
      jti: newJti,
      expiresAt: newExpiresAt,
      createdByIp: String(req.ip || ""),
      userAgent: String(req.get("user-agent") || "")
    })
  ]);

  res.cookie(env.REFRESH_TOKEN_COOKIE_NAME, newRefreshToken, cookieOptions({ expiresAt: newExpiresAt }));

  const accessToken = signAccessToken({ sub: String(userId) });
  res.json({ token: accessToken, accessToken });
});

export const logout = asyncHandler(async (req, res) => {
  const token = extractRefreshToken(req);

  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      const userId = decoded?.sub;
      const jti = decoded?.jti;
      if (userId && jti) {
        await RefreshToken.updateOne(
          { user: userId, jti, revokedAt: null },
          { $set: { revokedAt: new Date() } }
        );
      }
    } catch {
      // ignore invalid refresh tokens on logout
    }
  }

  res.clearCookie(env.REFRESH_TOKEN_COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});
