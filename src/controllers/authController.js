import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { signAccessToken } from "../config/jwt.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";

export const signup = asyncHandler(async (req, res) => {
  const { name, username, password } = req.body;
  const normalizedUsername = username.toLowerCase();

  const existing = await User.findOne({ username: normalizedUsername });
  if (existing) throw new HttpError(409, "Username already taken");

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, username: normalizedUsername, passwordHash });

  const token = signAccessToken({ sub: user._id.toString() });
  res.status(201).json({ token, user });
});

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const normalizedUsername = username.toLowerCase();

  const user = await User.findOne({ username: normalizedUsername }).select("+passwordHash");
  if (!user) throw new HttpError(404, "User not found");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(400, "Invalid credentials");

  const token = signAccessToken({ sub: user._id.toString() });
  user.passwordHash = undefined;

  res.json({ token, user });
});
