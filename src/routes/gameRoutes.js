import { Router } from "express";
import { z } from "zod";
import { create, get, join, listMine, move } from "../controllers/gameController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";

const router = Router();
router.use(requireAuth);

router.get("/", listMine);
router.post("/", create);
router.get(
  "/:gameId",
  validate({ params: z.object({ gameId: z.string().min(1) }) }),
  get
);
router.post(
  "/:gameId/join",
  validate({ params: z.object({ gameId: z.string().min(1) }) }),
  join
);
router.post(
  "/:gameId/move",
  validate({
    params: z.object({ gameId: z.string().min(1) }),
    body: z.object({ index: z.coerce.number().int().min(0).max(8) })
  }),
  move
);

export default router;
