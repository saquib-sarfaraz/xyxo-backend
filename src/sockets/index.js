import { Server } from "socket.io";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { verifyAccessToken } from "../config/jwt.js";
import FriendRequest from "../models/FriendRequest.js";
import User from "../models/User.js";
import {
  getGame,
  joinGame,
  leaveGame,
  makeMove,
  restartGame,
  voteRematch
} from "../services/gameService.js";
import { createNotification } from "../services/notificationService.js";
import { HttpError } from "../utils/httpError.js";

let ioRef = null;

const RESTART_DELAY_MS = 3_000;
const DISCONNECT_GRACE_MS = 10_000;
const SOCKET_DEBUG = ["1", "true", "yes"].includes(String(env.SOCKET_DEBUG || "").toLowerCase());
const SOCKET_AUTH_BYPASS = ["1", "true", "yes"].includes(
  String(env.SOCKET_AUTH_BYPASS || "").toLowerCase()
);

const debug = (...args) => {
  if (!SOCKET_DEBUG) return;
  console.log("[socket]", ...args);
};

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
    stats: {
      wins,
      losses,
      draws,
      xp: Number(user?.stats?.xp || 0),
      winRate
    }
  };
};

const fetchLeaderboardData = async (limit = 50) => {
  const users = await User.find({})
    .select("name username avatar stats")
    .sort({ "stats.xp": -1, "stats.wins": -1, username: 1 })
    .limit(limit)
    .lean();
  return users.map((user, index) => toLeaderboardItem(user, index));
};

const restartTimers = new Map(); // gameId -> Timeout
const presence = new Map(); // gameId -> Map(userId -> Set(socketId))
const leaveGraceTimers = new Map(); // `${gameId}:${userId}` -> Timeout

const graceKey = (gameId, userId) => `${gameId}:${userId}`;

const clearLeaveGrace = (gameId, userId) => {
  const key = graceKey(gameId, userId);
  const timer = leaveGraceTimers.get(key);
  if (timer) clearTimeout(timer);
  leaveGraceTimers.delete(key);
};

const scheduleLeaveGrace = (io, gameId, userId) => {
  clearLeaveGrace(gameId, userId);

  const key = graceKey(gameId, userId);
  const timer = setTimeout(async () => {
    const gamePresence = presence.get(gameId);
    const sockets = gamePresence?.get(userId);
    if (sockets && sockets.size) return;

    try {
      const updated = await leaveGame(gameId, userId);
      if (updated) {
        emitGameUpdate(io, gameId, updated);
        debug("grace leave applied", { gameId, userId });
      }
    } catch (err) {
      debug("grace leave failed", { gameId, userId, error: err?.message });
    } finally {
      leaveGraceTimers.delete(key);
    }
  }, DISCONNECT_GRACE_MS);

  leaveGraceTimers.set(key, timer);
};

const toGameUpdatePayload = (game) => {
  if (!game || typeof game !== "object") return { game: null };
  return { ...game, game };
};

const emitGameUpdate = (io, gameId, game, moveId = null) => {
  const payload = toGameUpdatePayload(game);
  if (moveId) payload.moveId = moveId;
  io.to(gameId).emit("game:update", payload);

  const roomSize = io.sockets.adapter.rooms.get(gameId)?.size || 0;
  debug("emit game:update", {
    gameId,
    roomSize,
    status: payload.status,
    players: Array.isArray(payload.players) ? payload.players.length : 0,
    turn: payload.turn,
    winner: payload.winner
  });

  return payload;
};

const getPresenceForGame = (gameId) => {
  const existing = presence.get(gameId);
  if (existing) return existing;
  const created = new Map();
  presence.set(gameId, created);
  return created;
};

const addPresence = (gameId, userId, socketId) => {
  const gamePresence = getPresenceForGame(gameId);
  const sockets = gamePresence.get(userId) ?? new Set();
  sockets.add(socketId);
  gamePresence.set(userId, sockets);
};

// Returns true if the user has no sockets left in this game.
const removePresence = (gameId, userId, socketId) => {
  const gamePresence = presence.get(gameId);
  if (!gamePresence) return true;

  const sockets = gamePresence.get(userId);
  if (!sockets) return true;

  sockets.delete(socketId);
  if (sockets.size) return false;

  gamePresence.delete(userId);
  if (gamePresence.size === 0) presence.delete(gameId);
  return true;
};

const clearRestartTimer = (gameId) => {
  const timer = restartTimers.get(gameId);
  if (timer) clearTimeout(timer);
  restartTimers.delete(gameId);
};

const scheduleAutoRestart = (io, game) => {
  const gameId = String(game?._id || "");
  if (!gameId) return;

  const isFinished = game?.status === "finished" && !!game?.winner;
  if (!isFinished) return;

  if (restartTimers.has(gameId)) return;

  io.to(gameId).emit("game:restart_timer", {
    seconds: Math.ceil(RESTART_DELAY_MS / 1000),
    endsAt: Date.now() + RESTART_DELAY_MS
  });
  debug("auto restart scheduled", { gameId, delayMs: RESTART_DELAY_MS, winner: game?.winner });

  const timer = setTimeout(async () => {
    restartTimers.delete(gameId);

    try {
      const updated = await restartGame(gameId);
      if (!updated) {
        debug("auto restart skipped (no update)", { gameId });
        return;
      }

      emitGameUpdate(io, gameId, updated);
      debug("auto restart applied", { gameId });
    } catch (err) {
      debug("auto restart failed", { gameId, error: err?.message });
    }
  }, RESTART_DELAY_MS);

  restartTimers.set(gameId, timer);
};

const userRoom = (userId) => `user:${userId}`;

const emitToUser = (io, userId, eventName, payload) => {
  if (!userId) return;
  const id = String(userId);
  // Emit to canonical per-user room and legacy raw-id room for compatibility.
  io.to(userRoom(id)).emit(eventName, payload);
  io.to(id).emit(eventName, payload);
};

const compactUser = (u) => ({
  _id: String(u?._id || ""),
  username: u?.username || "",
  name: u?.name || "",
  avatar: u?.avatar || ""
});

const normalizeSearchQuery = (value) => String(value || "").trim();
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractSocketToken = (socket) => {
  const authToken = socket.handshake.auth?.token ?? socket.handshake.auth?.accessToken;
  if (typeof authToken === "string") {
    const trimmed = authToken.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^Bearer\s+(.+)$/i);
    const extracted = (match?.[1] || trimmed).trim();

    // Guard against accidental placeholder values from client state races.
    if (!extracted || extracted === "undefined" || extracted === "null") return null;
    return extracted;
  }

  const header = socket.handshake.headers?.authorization;
  if (typeof header === "string") {
    const trimmed = header.trim();
    const match = trimmed.match(/^Bearer\s+(.+)$/i);
    const extracted = match?.[1]?.trim();
    if (extracted && extracted !== "undefined" && extracted !== "null") return extracted;
  }

  return null;
};

const tokenMeta = (token) => {
  if (!token || typeof token !== "string") return { present: false };
  const trimmed = token.trim();
  return {
    present: true,
    length: trimmed.length,
    startsWithBearer: /^Bearer\s+/i.test(trimmed)
  };
};

const socketAuthError = (message, code) => {
  const err = new Error(message);
  err.data = { code, message };
  return err;
};

export const initSocket = (httpServer) => {
  const corsOrigin =
    env.CORS_ORIGIN === "*"
      ? "*"
      : env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
  const corsCredentials = env.CORS_ORIGIN !== "*";

  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: corsCredentials },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"]
  });
  ioRef = io;

  io.engine.on("connection_error", (err) => {
    debug("engine connection_error", { code: err.code, message: err.message });
  });

  io.use((socket, next) => {
    if (SOCKET_AUTH_BYPASS) {
      socket.data.userId = "test-user";
      debug("auth bypass enabled", { socketId: socket.id, userId: socket.data.userId });
      return next();
    }

    try {
      debug("auth handshake", {
        socketId: socket.id,
        authKeys: Object.keys(socket.handshake.auth || {}),
        hasAuthorizationHeader: Boolean(socket.handshake.headers?.authorization)
      });
      const token = extractSocketToken(socket);
      debug("auth token received", { socketId: socket.id, ...tokenMeta(token) });
      if (!token) return next(socketAuthError("Missing token", "MISSING_TOKEN"));
      const decoded = verifyAccessToken(token);
      if (decoded?.type && decoded.type !== "access") {
        return next(socketAuthError("Invalid token", "INVALID_TOKEN"));
      }
      const userId = decoded.sub || decoded.id;
      if (!userId) return next(socketAuthError("Invalid token", "INVALID_TOKEN"));
      debug("auth token decoded", {
        socketId: socket.id,
        userId: String(userId),
        hasSub: Boolean(decoded?.sub),
        hasId: Boolean(decoded?.id),
        exp: decoded?.exp
      });
      socket.data.userId = String(userId);
      return next();
    } catch (err) {
      debug("auth token rejected", { socketId: socket.id, error: err?.message });
      return next(socketAuthError("Invalid token", "INVALID_TOKEN"));
    }
  });

  io.on("connect_error", (err) => {
    debug("socket connect_error", { message: err?.message, data: err?.data });
  });

  io.on("connection", (socket) => {
    debug("connected", { socketId: socket.id, userId: socket.data.userId });
    socket.data.joinedGameIds = new Set();
    socket.join(userRoom(socket.data.userId));
    debug("joined user room", { userId: socket.data.userId, room: userRoom(socket.data.userId) });

    socket.onAny((eventName, ...args) => {
      if (!SOCKET_DEBUG) return;
      const trackedPrefixes = ["game:", "friend:", "user:"];
      if (!trackedPrefixes.some((prefix) => String(eventName).startsWith(prefix))) return;
      const first = args?.[0];
      const safe = first && typeof first === "object" ? { ...first } : first;
      if (safe && typeof safe === "object" && "token" in safe) safe.token = "<redacted>";
      debug("recv", eventName, safe);
    });

    socket.on("disconnect", (reason) => {
      debug("disconnected", { socketId: socket.id, userId: socket.data.userId, reason });
    });

    socket.on("leaderboard:request", async (_data, ack) => {
      try {
        const leaderboard = await fetchLeaderboardData();
        socket.emit("leaderboard:update", { at: Date.now(), leaderboard });
        if (typeof ack === "function") ack({ ok: true, leaderboard });
      } catch (err) {
        const error = err instanceof HttpError ? err.message : "Failed to fetch leaderboard";
        if (typeof ack === "function") ack({ ok: false, error });
      }
    });

    socket.on("user:search", async (data, ack) => {
      try {
        const q = normalizeSearchQuery(data?.q);
        const safeQ = q ? escapeRegex(q) : "";

        const me = await User.findById(socket.data.userId).select("friends");
        const friendIds = new Set((me?.friends || []).map((id) => String(id)));
        const query = {
          _id: { $ne: socket.data.userId }
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

        const payloadUsers = users.map((u) => ({
          ...compactUser(u),
          isFriend: friendIds.has(String(u._id))
        }));

        const payload = { users: payloadUsers };
        socket.emit("user:search:result", payload);
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const error = err instanceof HttpError ? err.message : "Search failed";
        if (typeof ack === "function") ack({ ok: false, error });
      }
    });

    socket.on("friend:request", async (data, ack) => {
      try {
        const toUserId = String(data?.toUserId || "");
        debug("friend request received", { fromUserId: socket.data.userId, toUserId, socketId: socket.id });
        if (!mongoose.isValidObjectId(toUserId)) throw new HttpError(400, "Invalid target user");
        if (toUserId === socket.data.userId) throw new HttpError(400, "Cannot friend yourself");

        const [sender, receiver] = await Promise.all([
          User.findById(socket.data.userId).select("username name avatar friends"),
          User.findById(toUserId).select("username name avatar friends settings")
        ]);
        if (!sender) throw new HttpError(401, "Unauthorized");
        if (!receiver) throw new HttpError(404, "User not found");
        if (receiver.settings?.allowFriendRequests === false) {
          throw new HttpError(403, "User is not accepting friend requests");
        }

        const alreadyFriends =
          (sender.friends || []).some((id) => String(id) === toUserId) ||
          (receiver.friends || []).some((id) => String(id) === socket.data.userId);
        if (alreadyFriends) throw new HttpError(409, "Already friends");

        const existingPending = await FriendRequest.findOne({
          status: "pending",
          $or: [
            { sender: socket.data.userId, receiver: toUserId },
            { sender: toUserId, receiver: socket.data.userId }
          ]
        }).lean();
        if (existingPending) throw new HttpError(409, "Request already pending");

        const request = await FriendRequest.create({
          sender: socket.data.userId,
          receiver: toUserId
        });
        debug("friend request saved", {
          requestId: String(request._id),
          fromUserId: socket.data.userId,
          toUserId
        });
        await createNotification(toUserId, {
          type: "friend_request",
          message: `Friend request from ${sender.username}`
        });

        emitToUser(io, toUserId, "friend:request:received", {
          fromUser: compactUser(sender),
          request: {
            _id: String(request._id),
            from: compactUser(sender),
            status: "pending",
            createdAt: request.createdAt
          }
        });
        debug("friend request emitted", {
          toUserId,
          targetRooms: [userRoom(toUserId), toUserId]
        });

        if (typeof ack === "function") ack({ ok: true, requestId: String(request._id) });
      } catch (err) {
        const error = err instanceof HttpError ? err.message : "Friend request failed";
        debug("friend request failed", { fromUserId: socket.data.userId, error });
        if (typeof ack === "function") ack({ ok: false, error });
      }
    });

    socket.on("friend:accept", async (data, ack) => {
      try {
        const requestId = String(data?.requestId || "");
        if (!mongoose.isValidObjectId(requestId)) throw new HttpError(400, "Invalid request id");

        const request = await FriendRequest.findById(requestId);
        if (!request || request.status !== "pending") throw new HttpError(404, "Request not found");
        if (String(request.receiver) !== socket.data.userId) throw new HttpError(403, "Forbidden");

        const [sender, receiver] = await Promise.all([
          User.findById(request.sender).select("username name avatar"),
          User.findById(request.receiver).select("username name avatar")
        ]);
        if (!sender || !receiver) throw new HttpError(404, "User not found");

        await Promise.all([
          User.updateOne({ _id: sender._id }, { $addToSet: { friends: receiver._id } }),
          User.updateOne({ _id: receiver._id }, { $addToSet: { friends: sender._id } }),
          FriendRequest.deleteOne({ _id: request._id }),
          createNotification(sender._id.toString(), {
            type: "friend_accepted",
            message: `${receiver.username} accepted your friend request`
          })
        ]);

        emitToUser(io, sender._id.toString(), "friend:added", {
          friend: compactUser(receiver),
          acceptedBy: compactUser(receiver)
        });
        emitToUser(io, receiver._id.toString(), "friend:added", {
          friend: compactUser(sender),
          acceptedBy: compactUser(receiver)
        });

        if (typeof ack === "function") {
          ack({
            ok: true,
            friend: compactUser(sender),
            acceptedBy: compactUser(receiver)
          });
        }
      } catch (err) {
        const error = err instanceof HttpError ? err.message : "Accept friend failed";
        if (typeof ack === "function") ack({ ok: false, error });
      }
    });

    socket.on("game:invite", async (data, ack) => {
      try {
        const toUserId = String(data?.toUserId || "");
        const gameId = String(data?.gameId || "");
        if (!mongoose.isValidObjectId(toUserId)) throw new HttpError(400, "Invalid target user");
        if (!gameId) throw new HttpError(400, "Missing game id");

        const [fromUser, toUser, game] = await Promise.all([
          User.findById(socket.data.userId).select("username name avatar"),
          User.findById(toUserId).select("username name avatar"),
          getGame(gameId, socket.data.userId)
        ]);
        if (!fromUser || !toUser) throw new HttpError(404, "User not found");

        await createNotification(toUserId, {
          type: "game_invite",
          message: `${fromUser.username} invited you to a game`
        });

        const payload = {
          fromUser: compactUser(fromUser),
          gameId,
          gameStatus: game?.status || "waiting"
        };
        emitToUser(io, toUserId, "game:invite:received", payload);
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const error = err instanceof HttpError ? err.message : "Invite failed";
        if (typeof ack === "function") ack({ ok: false, error });
      }
    });

    socket.on("game:invite:accept", async (data, ack) => {
      try {
        const gameId = String(data?.gameId || "");
        if (!gameId) throw new HttpError(400, "Missing game id");

        clearLeaveGrace(gameId, socket.data.userId);
        const game = await joinGame(gameId, socket.data.userId);
        socket.data.joinedGameIds.add(gameId);
        addPresence(gameId, socket.data.userId, socket.id);
        socket.join(gameId);

        const payload = emitGameUpdate(io, gameId, game);
        if (game?.status === "playing" && Array.isArray(game?.players) && game.players.length === 2) {
          io.to(gameId).emit("game:start", payload);
        }

        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const error = err instanceof HttpError ? err.message : "Invite accept failed";
        if (typeof ack === "function") ack({ ok: false, error });
      }
    });

    socket.on("game:join", async (data, ack) => {
      try {
        const gameId = data?.gameId;
        if (!gameId) throw new HttpError(400, "Missing gameId");
        clearLeaveGrace(gameId, socket.data.userId);
        const isAlreadyJoined = socket.data.joinedGameIds.has(gameId);
        debug("join requested", { gameId, userId: socket.data.userId, isAlreadyJoined });

        // Make join idempotent for the same socket session.
        let game;
        if (isAlreadyJoined) {
          try {
            game = await getGame(gameId, socket.data.userId);
          } catch (err) {
            // Membership can change asynchronously (leave/disconnect cleanup).
            // If this socket cache is stale, retry through the join path.
            if (err instanceof HttpError && err.statusCode === 403) {
              socket.data.joinedGameIds.delete(gameId);
              game = await joinGame(gameId, socket.data.userId);
            } else {
              throw err;
            }
          }
        } else {
          game = await joinGame(gameId, socket.data.userId);
        }

        socket.data.joinedGameIds.add(gameId);
        addPresence(gameId, socket.data.userId, socket.id);
        socket.join(gameId);
        const room = io.sockets.adapter.rooms.get(gameId);
        const roomSocketIds = room ? [...room] : [];
        const players = Array.isArray(game?.players) ? game.players : [];
        const playerIds = players.map((p) => String(p?._id || p));
        debug("join diagnostics", {
          gameId,
          userId: socket.data.userId,
          roomSize: room?.size || 0,
          roomSocketIds,
          playerCount: playerIds.length,
          playerIds,
          socketId: socket.id
        });

        const payload = emitGameUpdate(io, gameId, game);
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : "Join failed";
        debug("join failed", { gameId: data?.gameId, userId: socket.data.userId, error: msg });
        socket.emit("game:error", { error: msg });
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    const leaveAndBroadcast = async (gameId, { immediate } = { immediate: true }) => {
      try {
        if (!gameId) return;
        socket.data.joinedGameIds?.delete(gameId);

        socket.leave(gameId);

        const userFullyLeft = removePresence(gameId, socket.data.userId, socket.id);
        if (!userFullyLeft) return;

        if (!immediate) {
          scheduleLeaveGrace(io, gameId, socket.data.userId);
          return;
        }

        clearRestartTimer(gameId);
        clearLeaveGrace(gameId, socket.data.userId);
        const updated = await leaveGame(gameId, socket.data.userId);
        if (updated) emitGameUpdate(io, gameId, updated);
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : "Leave failed";
        socket.emit("game:error", { error: msg });
      }
    };

    socket.on("game:leave", async (data, ack) => {
      await leaveAndBroadcast(data?.gameId, { immediate: true });
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("game:move", async (data, ack) => {
      try {
        const gameId = data?.gameId;
        const index = data?.index;
        const moveId = data?.moveId || null;
        const powerUp = data?.powerUp || null;
        const powerUpTarget = data?.powerUpTarget ?? null;
        debug("MOVE request", { gameId, userId: socket.data.userId, index, moveId, powerUp, powerUpTarget });
        if (!Number.isInteger(index) || index < 0 || index > 8) {
          throw new HttpError(400, "Invalid move index");
        }
        const game = await makeMove(gameId, socket.data.userId, index, powerUp, powerUpTarget);
        debug("MOVE applied", { gameId, turn: game?.turn, winner: game?.winner, board: game?.board });
        const payload = broadcastGameUpdate(gameId, game, moveId);
        debug("MOVE emitted", { gameId, moveId });
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : "Move failed";
        debug("MOVE failed", { gameId: data?.gameId, userId: socket.data.userId, error: msg });
        socket.emit("game:error", { error: msg });
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("game:freeze", async (data, ack) => {
      try {
        const gameId = data?.gameId;
        if (!gameId) throw new HttpError(400, "Missing gameId");
        debug("FREEZE request", { gameId, userId: socket.data.userId });
        const game = await makeMove(gameId, socket.data.userId, -1, "freeze", null);
        debug("FREEZE applied", { gameId, frozenPlayer: game?.frozenPlayer });
        const payload = broadcastGameUpdate(gameId, game);
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : "Freeze failed";
        debug("FREEZE failed", { gameId: data?.gameId, userId: socket.data.userId, error: msg });
        socket.emit("game:error", { error: msg });
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("game:remove", async (data, ack) => {
      try {
        const gameId = data?.gameId;
        const targetIndex = data?.targetIndex;
        if (!gameId) throw new HttpError(400, "Missing gameId");
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 8) {
          throw new HttpError(400, "Invalid target index");
        }
        debug("REMOVE request", { gameId, userId: socket.data.userId, targetIndex });
        const game = await makeMove(gameId, socket.data.userId, -1, "remove", targetIndex);
        debug("REMOVE applied", { gameId, targetIndex, board: game?.board });
        const payload = broadcastGameUpdate(gameId, game);
        if (typeof ack === "function") ack({ ok: true, ...payload });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : "Remove failed";
        debug("REMOVE failed", { gameId: data?.gameId, userId: socket.data.userId, error: msg });
        socket.emit("game:error", { error: msg });
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("game:rematch", async (data, ack) => {
      try {
        const gameId = data?.gameId;
        if (!gameId) throw new HttpError(400, "Missing gameId");
        debug("REMATCH request", { gameId, userId: socket.data.userId });
        const { game, reset } = await voteRematch(gameId, socket.data.userId);
        debug("REMATCH response", { gameId, reset, status: game?.status, rematchVotes: game?.rematchVotes });
        
        if (reset) {
          const payload = emitGameUpdate(io, gameId, game);
          debug("REMATCH reset complete", { gameId, turn: game?.turn, board: game?.board });
          io.to(gameId).emit("game:start", payload);
          if (typeof ack === "function") ack({ ok: true, reset: true, ...payload });
        } else {
          const payload = emitGameUpdate(io, gameId, game);
          socket.to(gameId).emit("game:rematch-request", { from: socket.data.userId });
          debug("REMATCH waiting for opponent", { gameId, rematchVotes: game?.rematchVotes });
          if (typeof ack === "function") ack({ ok: true, reset: false, ...payload });
        }
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : "Rematch failed";
        debug("REMATCH failed", { gameId: data?.gameId, userId: socket.data.userId, error: msg });
        socket.emit("game:error", { error: msg });
        if (typeof ack === "function") ack({ ok: false, error: msg });
      }
    });

    socket.on("disconnecting", () => {
      const rooms = [...socket.rooms].filter((r) => r !== socket.id);
      for (const room of rooms) {
        // Fire and forget; don't block disconnect.
        leaveAndBroadcast(room, { immediate: false });
      }
    });
  });

  return io;
};

export const getIO = () => ioRef;

export const broadcastGameUpdate = async (gameId, game, moveId = null) => {
  if (!ioRef) return null;
  const id = gameId || String(game?._id || "");
  if (!id) return null;
  const payload = emitGameUpdate(ioRef, id, game, moveId);
  scheduleAutoRestart(ioRef, game);
  if (game?.status === "finished" && (game?.winner === "X" || game?.winner === "O" || game?.winner === "DRAW")) {
    try {
      const leaderboard = await fetchLeaderboardData();
      ioRef.emit("leaderboard:update", { at: Date.now(), leaderboard, gameId: id, winner: game?.winner });
    } catch (err) {
      debug("leaderboard emit failed", { error: err?.message });
      ioRef.emit("leaderboard:update", { at: Date.now(), gameId: id, winner: game?.winner });
    }
  }
  return payload;
};
