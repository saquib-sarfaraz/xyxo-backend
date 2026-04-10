import { asyncHandler } from "../utils/asyncHandler.js";
import { createGame, getGame, joinGame, listMyGames, makeMove } from "../services/gameService.js";
import { broadcastGameUpdate } from "../sockets/index.js";

export const create = asyncHandler(async (req, res) => {
  const game = await createGame(req.user.id);
  res.status(201).json({ game });
});

export const join = asyncHandler(async (req, res) => {
  const game = await joinGame(req.params.gameId, req.user.id);
  res.json({ game });
});

export const get = asyncHandler(async (req, res) => {
  const game = await getGame(req.params.gameId, req.user.id);
  res.json({ game });
});

export const listMine = asyncHandler(async (req, res) => {
  const games = await listMyGames(req.user.id);
  res.json({ games });
});

export const move = asyncHandler(async (req, res) => {
  const game = await makeMove(req.params.gameId, req.user.id, req.body.index);
  broadcastGameUpdate(req.params.gameId, game);
  res.json({ game });
});
