import { verifyAccessToken } from "../config/jwt.js";
import { HttpError } from "../utils/httpError.js";

const extractBearer = (authorizationHeader) => {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
};

export const requireAuth = (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) return next(new HttpError(401, "Missing bearer token"));

  try {
    const decoded = verifyAccessToken(token);
    const userId = decoded.sub || decoded.id;
    if (!userId) return next(new HttpError(401, "Invalid token"));
    req.user = { id: String(userId) };
    return next();
  } catch {
    return next(new HttpError(401, "Invalid token"));
  }
};
