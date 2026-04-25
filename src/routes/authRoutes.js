import { Router } from "express";
import { z } from "zod";
import { login, logout, refresh, signup } from "../controllers/authController.js";
import { validate } from "../middleware/validateMiddleware.js";

const router = Router();

router.post(
  "/signup",
  validate({
    body: z
      .object({
        name: z.string().trim().min(1).max(80),
        username: z
          .string()
          .trim()
          .min(3)
          .max(24)
          .regex(/^[a-zA-Z0-9_]+$/)
          .transform((s) => s.toLowerCase())
          .optional(),
        email: z
          .string()
          .trim()
          .email()
          .transform((s) => s.toLowerCase())
          .optional(),
        password: z.string().min(8).max(72)
      })
      .superRefine((data, ctx) => {
        if (!data.username && !data.email) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["username"],
            message: "username or email is required"
          });
        }
      })
  }),
  signup
);

router.post(
  "/login",
  validate({
    body: z
      .object({
        username: z
          .string()
          .trim()
          .min(1)
          .transform((s) => s.toLowerCase())
          .optional(),
        email: z
          .string()
          .trim()
          .email()
          .transform((s) => s.toLowerCase())
          .optional(),
        password: z.string().min(1)
      })
      .superRefine((data, ctx) => {
        if (!data.username && !data.email) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["username"],
            message: "username or email is required"
          });
        }
      })
  }),
  login
);

router.post("/refresh", refresh);
router.post("/logout", logout);

export default router;
