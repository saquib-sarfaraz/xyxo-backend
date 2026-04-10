import { Router } from "express";
import { z } from "zod";
import { me, search, updateMe, getUserStats } from "../controllers/userController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";

const router = Router();

router.use(requireAuth);

router.get("/search", validate({ query: z.object({ q: z.string().min(1).optional() }) }), search);
router.get("/me", me);
router.get("/:id/stats", getUserStats);
router.patch(
  "/me",
  validate({
    body: z
      .object({
        name: z.string().min(1).max(80).optional(),
        avatar: z.string().max(2048).optional(),
        settings: z
          .object({
            theme: z.enum(["light", "dark", "system"]).optional(),
            allowFriendRequests: z.boolean().optional(),
            notificationsEnabled: z.boolean().optional(),
            musicEnabled: z.boolean().optional(),
            musicVolume: z
              .union([
                z.coerce.number().min(0).max(1),
                z.coerce
                  .number()
                  .int()
                  .min(0)
                  .max(100)
                  .transform((n) => n / 100)
              ])
              .optional()
          })
          .optional()
      })
      .strict()
  }),
  updateMe
);

export default router;
