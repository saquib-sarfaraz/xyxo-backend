import mongoose from "mongoose";
import Game from "../models/Game.js";
import Match from "../models/Match.js";
import User from "../models/User.js";
import { computeWinner } from "../utils/ticTacToe.js";
import { HttpError } from "../utils/httpError.js";

const populateGame = (q) => q.populate("players", "username name avatar");
const fetchGame = async (gameId) => await populateGame(Game.findById(gameId)).lean();
const randomTurn = () => (Math.random() > 0.5 ? "X" : "O");

export const createGame = async (userId) => {
  const game = await Game.create({
    players: [userId],
    status: "waiting",
    turn: "X",
    turnStartedAt: new Date()
  });
  return await fetchGame(game._id);
};

export const joinGame = async (gameId, userId) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");

  const existing = await Game.findById(gameId);
  if (!existing) throw new HttpError(404, "Game not found");

  const isAlreadyPlayer = (existing.players || []).some((p) => p.toString() === userId);
  if (isAlreadyPlayer) return await fetchGame(existing._id);

  const creatorId = existing.players?.[0]?.toString();
  if (!creatorId) throw new HttpError(409, "Game is invalid");

  // Randomize X/O assignment by choosing the order of the players array.
  const players = Math.random() > 0.5 ? [creatorId, userId] : [userId, creatorId];
  const startingTurn = randomTurn();
  const now = new Date();

  const updated = await Game.findOneAndUpdate(
    {
      _id: existing._id,
      status: "waiting",
      "players.0": existing.players[0],
      "players.1": { $exists: false },
      players: { $ne: userId }
    },
    {
      $set: {
        players,
        status: "playing",
        turn: startingTurn,
        turnStartedAt: now,
        board: Array(9).fill(""),
        winner: "",
        rematchVotes: []
      }
    },
    { new: true }
  );

  if (updated) return await fetchGame(updated._id);

  const latest = await Game.findById(existing._id);
  if (!latest) throw new HttpError(404, "Game not found");

  const isPlayerNow = (latest.players || []).some((p) => p.toString() === userId);
  if (isPlayerNow) return await fetchGame(latest._id);

  if ((latest.players || []).length >= 2) throw new HttpError(409, "Game full");
  if (latest.status !== "waiting") throw new HttpError(409, "Game is not joinable");

  throw new HttpError(409, "Unable to join game");
};

export const getGame = async (gameId, userId) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");
  const game = await populateGame(Game.findById(gameId)).lean();
  if (!game) throw new HttpError(404, "Game not found");
  const isPlayer = (game.players || []).some((p) => String(p?._id || p) === userId);
  if (!isPlayer) throw new HttpError(403, "Forbidden");
  return game;
};

export const listMyGames = async (userId) => {
  const games = await populateGame(
    Game.find({ players: userId }).sort({ updatedAt: -1 }).limit(50)
  ).lean();
  return games;
};

const userMark = (game, userId) => {
  if (game.players?.[0]?.toString() === userId) return "X";
  if (game.players?.[1]?.toString() === userId) return "O";
  return null;
};

const XP_WIN = 50;
const XP_LOSS = 10;
const XP_DRAW = 25;

const DEBUG = true;
const log = (...args) => DEBUG && console.log("[GAME]", ...args);

const updateFinishedMatchStats = async (game, winnerMark) => {
  if (!Array.isArray(game.players) || game.players.length < 2) return;

  const xPlayerId = String(game.players[0]);
  const oPlayerId = String(game.players[1]);
  if (!xPlayerId || !oPlayerId || xPlayerId === oPlayerId) return;

  const updateStreak = async (userId, isWin) => {
    const user = await User.findById(userId).select("stats").lean();
    if (!user) return;

    const currentStreak = isWin ? Number(user?.stats?.currentStreak || 0) + 1 : 0;
    const bestStreak = Math.max(currentStreak, Number(user?.stats?.bestStreak || 0));

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          "stats.currentStreak": currentStreak,
          "stats.bestStreak": bestStreak
        }
      }
    );
  };

  if (winnerMark === "DRAW") {
    await Promise.all([
      User.updateOne(
        { _id: xPlayerId },
        {
          $inc: {
            "stats.draws": 1,
            "stats.xp": XP_DRAW
          },
          $set: {
            "stats.currentStreak": 0
          }
        }
      ),
      User.updateOne(
        { _id: oPlayerId },
        {
          $inc: {
            "stats.draws": 1,
            "stats.xp": XP_DRAW
          },
          $set: {
            "stats.currentStreak": 0
          }
        }
      )
    ]);
    return;
  }

  if (winnerMark !== "X" && winnerMark !== "O") return;

  const winnerId = winnerMark === "X" ? xPlayerId : oPlayerId;
  const loserId = winnerMark === "X" ? oPlayerId : xPlayerId;

  await Promise.all([
    User.updateOne(
      { _id: winnerId },
      {
        $inc: {
          "stats.wins": 1,
          "stats.xp": XP_WIN
        }
      }
    ),
    User.updateOne(
      { _id: loserId },
      {
        $inc: {
          "stats.losses": 1,
          "stats.xp": XP_LOSS
        },
        $set: {
          "stats.currentStreak": 0
        }
      }
    )
  ]);

  await updateStreak(winnerId, true);
  await updateStreak(loserId, false);
};

const recordMatchResult = async (game, winnerMark) => {
  if (!game?._id) return;
  if (!Array.isArray(game.players) || game.players.length < 2) return;

  const xPlayerId = game.players[0];
  const oPlayerId = game.players[1];
  if (!xPlayerId || !oPlayerId || xPlayerId.toString() === oPlayerId.toString()) return;

  if (winnerMark === "DRAW") {
    await Match.create({
      game: game._id,
      players: [xPlayerId, oPlayerId],
      isDraw: true
    });
    return;
  }

  if (winnerMark !== "X" && winnerMark !== "O") return;

  const winnerId = winnerMark === "X" ? xPlayerId : oPlayerId;
  const loserId = winnerMark === "X" ? oPlayerId : xPlayerId;

  await Match.create({
    game: game._id,
    players: [xPlayerId, oPlayerId],
    winner: winnerId,
    loser: loserId,
    isDraw: false,
    xpAwarded: XP_WIN
  });
};

export const makeMove = async (gameId, userId, index, powerUp = null, powerUpTarget = null) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new HttpError(400, "Invalid move index");

  log("MOVE request", { gameId, userId, index, powerUp, powerUpTarget });

  const game = await Game.findById(gameId);
  if (!game) throw new HttpError(404, "Game not found");

  if (game.isProcessing) {
    log("MOVE rejected - already processing", { gameId, userId });
    throw new HttpError(409, "Game is processing another move");
  }

  if (game.status !== "playing") {
    log("MOVE rejected - not playing", { gameId, userId, status: game.status });
    throw new HttpError(409, "Game is not active");
  }
  if (!Array.isArray(game.players) || game.players.length < 2) {
    log("MOVE rejected - waiting for opponent", { gameId, userId });
    throw new HttpError(409, "Waiting for opponent");
  }
  if (game.winner) {
    log("MOVE rejected - game has winner", { gameId, userId, winner: game.winner });
    throw new HttpError(409, "Game already has a winner");
  }

  const mark = userMark(game, userId);
  if (!mark) {
    log("MOVE rejected - not a player", { gameId, userId });
    throw new HttpError(403, "Forbidden");
  }
  if (game.turn !== mark) {
    log("MOVE rejected - not turn", { gameId, userId, mark, turn: game.turn });
    throw new HttpError(409, "Not your turn");
  }
  if (game.board[index]) {
    log("MOVE rejected - cell taken", { gameId, userId, index, board: game.board });
    throw new HttpError(409, "Cell already taken");
  }

  const frozenMark = game.frozenPlayer;
  if (frozenMark === mark) {
    log("MOVE rejected - player frozen", { gameId, userId, frozenMark });
    throw new HttpError(409, "You are frozen");
  }

  const isProcessingUpdate = { $set: { isProcessing: true } };
  const lockAcquired = await Game.findOneAndUpdate(
    { _id: gameId, isProcessing: false },
    isProcessingUpdate,
    { new: false }
  );

  if (!lockAcquired) {
    log("MOVE rejected - could not acquire lock", { gameId, userId });
    throw new HttpError(409, "Game is processing another move");
  }

  try {
    const freshGame = await Game.findById(gameId);

    if (freshGame.board[index]) {
      log("MOVE rejected - cell taken (race)", { gameId, userId, index });
      throw new HttpError(409, "Cell already taken");
    }

    freshGame.board[index] = mark;
    freshGame.turnStartedAt = new Date();
    log("BOARD after move", { gameId, board: freshGame.board });

    let nextTurn = mark === "X" ? "O" : "X";
    let nextFrozen = "";

    if (powerUp === "freeze" && freshGame.status === "playing") {
      freshGame.powerUpUsed = "freeze";
      freshGame.frozenPlayer = nextTurn;
      log("POWERUP freeze applied", { gameId, frozenPlayer: nextTurn });
    } else if (powerUp === "remove" && powerUpTarget !== null && freshGame.status === "playing") {
      if (powerUpTarget < 0 || powerUpTarget > 8) {
        throw new HttpError(400, "Invalid power-up target");
      }
      const opponentMark = mark === "X" ? "O" : "X";
      if (freshGame.board[powerUpTarget] !== opponentMark) {
        throw new HttpError(400, "Can only remove opponent's mark");
      }
      freshGame.powerUpUsed = "remove";
      freshGame.powerUpTarget = powerUpTarget;
      freshGame.board[powerUpTarget] = "";
      log("POWERUP remove applied", { gameId, target: powerUpTarget, board: freshGame.board });
    }

    const winner = computeWinner(freshGame.board);
    if (winner) {
      freshGame.status = "finished";
      freshGame.winner = winner;
      freshGame.result = winner === "DRAW" ? "draw" : winner;
      freshGame.finishedAt = new Date();
      log("GAME finished", { gameId, winner });
    } else {
      freshGame.turn = nextTurn;
      freshGame.frozenPlayer = nextFrozen;
      log("TURN switched", { gameId, turn: freshGame.turn, frozen: freshGame.frozenPlayer });
    }

    freshGame.isProcessing = false;
    await freshGame.save();

    if (winner) {
      try {
        await Promise.all([updateFinishedMatchStats(freshGame, winner), recordMatchResult(freshGame, winner)]);
      } catch (err) {
        console.error("Failed to record match result.", err);
      }
    }

    log("MOVE completed", { gameId, winner, turn: freshGame.turn });
    return await fetchGame(freshGame._id);
  } catch (err) {
    await Game.updateOne({ _id: gameId }, { $set: { isProcessing: false } });
    throw err;
  }
};

export const leaveGame = async (gameId, userId) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");

  const game = await Game.findById(gameId);
  if (!game) return null;

  const isPlayer = (game.players || []).some((p) => p.toString() === userId);
  if (!isPlayer) return await fetchGame(game._id);

  const remaining = (game.players || []).filter((p) => p.toString() !== userId);
  if (remaining.length === 0) {
    await Game.deleteOne({ _id: game._id });
    return null;
  }

  game.players = remaining;
  game.status = "waiting";
  game.winner = "";
  game.board = Array(9).fill("");
  game.turn = "X";
  game.turnStartedAt = new Date();
  game.rematchVotes = [];
  game.isProcessing = false;
  game.frozenPlayer = "";
  game.powerUpUsed = "";
  game.powerUpTarget = null;

  await game.save();
  return await fetchGame(game._id);
};

export const voteRematch = async (gameId, userId) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");

  const game = await Game.findById(gameId);
  if (!game) throw new HttpError(404, "Game not found");

  const isPlayer = (game.players || []).some((p) => p.toString() === userId);
  if (!isPlayer) throw new HttpError(403, "Forbidden");

  if (!Array.isArray(game.players) || game.players.length < 2) throw new HttpError(409, "Waiting for opponent");
  if (game.status !== "finished") throw new HttpError(409, "Game is not finished");

  const afterVote = await Game.findOneAndUpdate(
    { _id: game._id, players: userId },
    { $addToSet: { rematchVotes: userId } },
    { new: true }
  );
  if (!afterVote) throw new HttpError(404, "Game not found");

  let reset = false;
  if ((afterVote.rematchVotes || []).length >= 2) {
    const now = new Date();
    const turn = randomTurn();
    const resetDoc = await Game.findOneAndUpdate(
      { _id: afterVote._id, status: "finished", "rematchVotes.1": { $exists: true } },
      {
        $set: {
          board: Array(9).fill(""),
          status: "playing",
          winner: "",
          turn,
          turnStartedAt: now,
          rematchVotes: []
        }
      },
      { new: true }
    );

    if (resetDoc) reset = true;
  }

  const updated = await fetchGame(game._id);
  const didReset = reset || updated?.status === "playing";
  return { game: updated, reset: didReset };
};

export const autoMove = async (gameId) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");

  const game = await Game.findById(gameId);
  if (!game) throw new HttpError(404, "Game not found");

  if (game.status !== "playing") return null;
  if (!Array.isArray(game.players) || game.players.length < 2) return null;
  if (game.winner) return null;

  const emptyIndexes = [];
  for (let i = 0; i < game.board.length; i += 1) {
    if (!game.board[i]) emptyIndexes.push(i);
  }
  if (!emptyIndexes.length) return null;

  const index = emptyIndexes[Math.floor(Math.random() * emptyIndexes.length)];
  const symbol = game.turn;
  const userIdForSymbol =
    symbol === "X" ? game.players[0].toString() : game.players[1].toString();

  try {
    const updatedGame = await makeMove(game._id.toString(), userIdForSymbol, index);
    return { game: updatedGame, index, symbol };
  } catch {
    return null;
  }
};

export const restartGame = async (gameId) => {
  if (!mongoose.isValidObjectId(gameId)) throw new HttpError(400, "Invalid game id");

  const now = new Date();
  const turn = randomTurn();

  const updated = await Game.findOneAndUpdate(
    {
      _id: gameId,
      status: "finished",
      winner: { $ne: "" },
      "players.1": { $exists: true }
    },
    {
      $set: {
        board: Array(9).fill(""),
        status: "playing",
        winner: "",
        turn,
        turnStartedAt: now,
        rematchVotes: []
      }
    },
    { new: true }
  );

  if (!updated) return null;
  return await fetchGame(updated._id);
};
