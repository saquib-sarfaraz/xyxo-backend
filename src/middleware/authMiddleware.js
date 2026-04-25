import { verifyAccessToken } from "../config/jwt.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

const AUTH_DEBUG = env.AUTH_DEBUG === "true";

const tokenMeta = (value) => {
  if (typeof value !== "string") return { present: false };
  const trimmed = value.trim();
  if (!trimmed) return { present: false };
  const looksLikeJwt = trimmed.split(".").length === 3;
  return {
    present: true,
    length: trimmed.length,
    startsWithBearer: /^Bearer\s+/i.test(trimmed),
    looksLikeJwt
  };
};

const normalizeToken = (value) => {
  if (typeof value !== "string") return null;
  let trimmed = value.trim();
  if (!trimmed) return null;

  // Allow "Bearer <token>" and also plain tokens (some clients forget the prefix).
  for (let i = 0; i < 2; i += 1) {
    const match = trimmed.match(/^Bearer\s+(.+)$/i);
    if (!match) break;
    trimmed = match[1].trim();
  }

  // Guard against accidental placeholder values from client state races.
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
  return trimmed;
};

const extractAccessToken = (authorizationHeader) => {
  if (Array.isArray(authorizationHeader)) return normalizeToken(authorizationHeader[0]);
  return normalizeToken(authorizationHeader);
};

export const requireAuth = (req, _res, next) => {
  const authorization = req.headers.authorization;
  const token = extractAccessToken(authorization);
  if (!token) {
    if (AUTH_DEBUG) {
      console.log("[AUTH] missing token", { authorization: tokenMeta(authorization) });
    }
    return next(new HttpError(401, "Missing bearer token"));
  }

  try {
    const decoded = verifyAccessToken(token);
    if (decoded?.type && decoded.type !== "access") {
      if (AUTH_DEBUG) console.log("[AUTH] wrong token type", { type: decoded?.type });
      return next(new HttpError(401, "Invalid token"));
    }
    const userId = decoded?.sub || decoded?.id;
    if (!userId) {
      if (AUTH_DEBUG) console.log("[AUTH] token missing subject", { decodedType: typeof decoded });
      return next(new HttpError(401, "Invalid token"));
    }
    req.user = { id: String(userId) };
    if (AUTH_DEBUG) console.log("[AUTH] ok", { userId: req.user.id });
    return next();
  } catch (err) {
    if (AUTH_DEBUG) {
      console.log("[AUTH] rejected token", {
        authorization: tokenMeta(authorization),
        token: tokenMeta(token),
        error: { name: err?.name, message: err?.message }
      });
    }

    if (err?.name === "TokenExpiredError") {
      return next(new HttpError(401, "Token expired"));
    }

    return next(new HttpError(401, "Invalid token"));
  }
};
