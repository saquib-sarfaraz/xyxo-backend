import jwt from "jsonwebtoken";
import { env } from "./env.js";

const accessSecret = env.JWT_SECRET;
const refreshSecret = env.JWT_REFRESH_SECRET || env.JWT_SECRET;

export const signAccessToken = (payload) =>
  jwt.sign({ ...payload, type: "access" }, accessSecret, { expiresIn: env.JWT_EXPIRES_IN });

export const verifyAccessToken = (token) => jwt.verify(token, accessSecret);

export const signRefreshToken = ({ sub, jti }) =>
  jwt.sign({ sub, type: "refresh" }, refreshSecret, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    jwtid: jti
  });

export const verifyRefreshToken = (token) => jwt.verify(token, refreshSecret);

export const decodeJwt = (token) => jwt.decode(token);
