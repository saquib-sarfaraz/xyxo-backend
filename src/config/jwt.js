import jwt from "jsonwebtoken";
import { env } from "./env.js";

export const signAccessToken = (payload) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_SECRET);
