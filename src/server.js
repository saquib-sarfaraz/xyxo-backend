import cors from "cors";
import express from "express";
import helmet from "helmet";
import http from "http";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import apiRoutes from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import { initSocket } from "./sockets/index.js";
import { startGameCleanupJob } from "./jobs/cleanupGames.js";

const app = express();

const corsOrigin =
  env.CORS_ORIGIN === "*"
    ? "*"
    : env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
const corsCredentials = env.CORS_ORIGIN !== "*";

app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: corsCredentials
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);

const redactMongoUri = (uri) => {
  if (typeof uri !== "string") return "";
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^@/]+)@/i, "$1<redacted>@");
};

(async () => {
  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(`Port ${env.PORT} is already in use. Set a different PORT in .env.`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });

  try {
    await connectDB(env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("Failed to connect to MongoDB.");
    console.error(`MONGO_URI=${redactMongoUri(env.MONGO_URI)}`);
    console.error("Make sure MongoDB is running and the URI is correct.");
    console.error(err);
    process.exit(1);
  }

  startGameCleanupJob().catch((err) => {
    console.error("Cleanup job crashed.", err);
  });

  server.listen(env.PORT, () => {
    console.log(`Server listening on :${env.PORT}`);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
