import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";
import { listMine, markRead } from "../controllers/notificationController.js";

const router = Router();
router.use(requireAuth);

router.get("/", listMine);
router.post(
  "/:notificationId/read",
  validate({ params: z.object({ notificationId: z.string().min(1) }) }),
  markRead
);

export default router;
