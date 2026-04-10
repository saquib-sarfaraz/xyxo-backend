import User from "../models/User.js";
import Match from "../models/Match.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const toLeaderboardItem = (user, index) => {
  const wins = Number(user?.stats?.wins || 0);
  const losses = Number(user?.stats?.losses || 0);
  const draws = Number(user?.stats?.draws || 0);
  const total = wins + losses + draws;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  return {
    rank: index + 1,
    userId: String(user._id),
    name: user.name || "",
    username: user.username || "",
    avatar: user.avatar || "",
    region: user.region || "global",
    stats: {
      wins,
      losses,
      draws,
      xp: Number(user?.stats?.xp || 0),
      winRate
    }
  };
};

export const listLeaderboard = asyncHandler(async (req, res) => {
  const region = String(req.query?.region || "global").trim();
  const limitRaw = Number(req.query?.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 50;

  const filter = region.toLowerCase() === "global" ? {} : { region };

  const users = await User.find(filter)
    .select("name username avatar region stats")
    .sort({ "stats.xp": -1, "stats.wins": -1, username: 1 })
    .limit(limit)
    .lean();

  const leaderboard = users.map((user, index) => toLeaderboardItem(user, index));
  res.json({ region, count: leaderboard.length, leaderboard });
});

export const listRollingLeaderboard = asyncHandler(async (req, res) => {
  const region = String(req.query?.region || "global").trim();
  const limitRaw = Number(req.query?.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 50;
  const daysRaw = Number(req.query?.days || 7);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(7, Math.trunc(daysRaw))) : 7;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const regionFilter = region.toLowerCase() === "global" ? null : region;

  const rows = await Match.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $unwind: "$players" },
    {
      $group: {
        _id: "$players",
        games: { $sum: 1 },
        wins: { $sum: { $cond: [{ $eq: ["$winner", "$players"] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $eq: ["$loser", "$players"] }, 1, 0] } },
        draws: { $sum: { $cond: ["$isDraw", 1, 0] } },
        xp: { $sum: { $cond: [{ $eq: ["$winner", "$players"] }, "$xpAwarded", 0] } }
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user"
      }
    },
    { $unwind: "$user" },
    ...(regionFilter ? [{ $match: { "user.region": regionFilter } }] : []),
    { $sort: { xp: -1, wins: -1, games: -1, "user.username": 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        userId: { $toString: "$user._id" },
        name: "$user.name",
        username: "$user.username",
        avatar: "$user.avatar",
        region: "$user.region",
        games: 1,
        wins: 1,
        losses: 1,
        draws: 1,
        xp: 1
      }
    }
  ]);

  const leaderboard = rows.map((row, index) => {
    const wins = Number(row?.wins || 0);
    const losses = Number(row?.losses || 0);
    const draws = Number(row?.draws || 0);
    const games = Number(row?.games || wins + losses + draws || 0);
    const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;

    return {
      rank: index + 1,
      userId: row.userId,
      name: row.name || "",
      username: row.username || "",
      avatar: row.avatar || "",
      region: row.region || "global",
      stats: {
        games,
        wins,
        losses,
        draws,
        xp: Number(row?.xp || 0),
        winRate
      }
    };
  });

  res.json({
    region,
    windowDays: days,
    since,
    count: leaderboard.length,
    leaderboard
  });
});
