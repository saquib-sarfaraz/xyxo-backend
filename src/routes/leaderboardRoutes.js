import { Router } from "express";
import { z } from "zod";
import { listLeaderboard, listRollingLeaderboard } from "../controllers/leaderboardController.js";
import { validate } from "../middleware/validateMiddleware.js";

const router = Router();

router.get(
  "/rolling",
  validate({
    query: z.object({
      region: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      days: z.coerce.number().int().min(1).max(7).optional()
    })
  }),
  listRollingLeaderboard
);

router.get(
  "/",
  validate({
    query: z.object({
      region: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional()
    })
  }),
  listLeaderboard
);

export default router;
