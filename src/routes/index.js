import { Router } from "express";
import mongoose from "mongoose";
import authRoutes from "./authRoutes.js";
import userRoutes from "./userRoutes.js";
import friendRoutes from "./friendRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import gameRoutes from "./gameRoutes.js";
import leaderboardRoutes from "./leaderboardRoutes.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true }));
router.get("/health/db", (_req, res) =>
  res.json({ ok: true, dbConnected: mongoose.connection.readyState === 1 })
);

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/friends", friendRoutes);
router.use("/notifications", notificationRoutes);
router.use("/games", gameRoutes);
router.use("/leaderboard", leaderboardRoutes);

export default router;
