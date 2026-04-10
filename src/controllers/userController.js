import mongoose from "mongoose";
import User from "../models/User.js";
import Match from "../models/Match.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const calcWinRate = (wins, losses, draws) => {
  const total = wins + losses + draws;
  return total > 0 ? Math.round((wins / total) * 100) : 0;
};

export const getUserStats = asyncHandler(async (req, res) => {
  const userId = String(req.params?.id || "");
  if (!mongoose.isValidObjectId(userId)) throw new HttpError(400, "Invalid user id");

  const user = await User.findById(userId)
    .select("name username avatar region stats")
    .lean();
  if (!user) throw new HttpError(404, "User not found");

  const wins = Number(user?.stats?.wins || 0);
  const losses = Number(user?.stats?.losses || 0);
  const draws = Number(user?.stats?.draws || 0);
  const totalGames = wins + losses + draws;
  const winRate = calcWinRate(wins, losses, draws);

  const recentMatches = await Match.find({ players: userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("players", "username name avatar")
    .populate("winner", "username")
    .populate("loser", "username")
    .lean();

  const enrichedMatches = recentMatches.map((m) => {
    const isDraw = Boolean(m.isDraw);
    const playerIds = (m.players || []).map((p) => String(p._id));
    const userIndex = playerIds.indexOf(userId);
    let result = "loss";
    if (isDraw) result = "draw";
    else if (m.winner && String(m.winner._id) === userId) result = "win";
    else if (m.loser && String(m.loser._id) === userId) result = "loss";

    return {
      _id: m._id,
      date: m.createdAt,
      result,
      isDraw,
      opponent: userIndex >= 0 ? m.players[userIndex === 0 ? 1 : 0] : null
    };
  });

  const stats = {
    wins,
    losses,
    draws,
    totalGames,
    xp: Number(user?.stats?.xp || 0),
    winRate,
    currentStreak: Number(user?.stats?.currentStreak || 0),
    bestStreak: Number(user?.stats?.bestStreak || 0)
  };

  res.json({
    user: {
      _id: user._id,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
      region: user.region,
      stats,
      recentMatches: enrichedMatches
    }
  });
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate("friends", "username name avatar");
  if (!user) throw new HttpError(404, "User not found");
  res.json({ user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const updates = {};

  if (typeof req.body.name === "string") updates.name = req.body.name;
  if (typeof req.body.avatar === "string") updates.avatar = req.body.avatar;

  if (req.body.settings && typeof req.body.settings === "object") {
    for (const [key, value] of Object.entries(req.body.settings)) {
      updates[`settings.${key}`] = value;
    }
  }

  const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true });
  if (!user) throw new HttpError(404, "User not found");
  res.json({ user });
});

export const search = asyncHandler(async (req, res) => {
  const q = String(req.query?.q || "").trim();
  const safeQ = q ? escapeRegex(q) : "";

  const me = await User.findById(req.user.id).select("friends");
  const friendIds = new Set((me?.friends || []).map((id) => String(id)));

  const query = {
    _id: { $ne: req.user.id }
  };
  if (safeQ) {
    query.$or = [
      { username: { $regex: safeQ, $options: "i" } },
      { name: { $regex: safeQ, $options: "i" } }
    ];
  }

  const users = await User.find(query)
    .select("username name avatar")
    .sort({ username: 1 })
    .limit(20)
    .lean();

  const enriched = users.map((u) => ({
    ...u,
    isFriend: friendIds.has(String(u._id))
  }));
  res.json({ users: enriched });
});
