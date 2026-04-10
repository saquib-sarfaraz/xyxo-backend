import { Router } from "express";
import { z } from "zod";
import { login, signup } from "../controllers/authController.js";
import { validate } from "../middleware/validateMiddleware.js";

const router = Router();

router.post(
  "/signup",
  validate({
    body: z.object({
      name: z.string().min(1).max(80),
      username: z
        .string()
        .min(3)
        .max(24)
        .regex(/^[a-zA-Z0-9_]+$/)
        .transform((s) => s.toLowerCase()),
      password: z.string().min(8).max(72)
    })
  }),
  signup
);

router.post(
  "/login",
  validate({
    body: z.object({
      username: z.string().min(1).transform((s) => s.toLowerCase()),
      password: z.string().min(1)
    })
  }),
  login
);

export default router;
