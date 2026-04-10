import dotenv from "dotenv";
import { ZodError, z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default("7d"),
  CORS_ORIGIN: z.string().min(1).default("*"),
  SOCKET_DEBUG: z.string().optional().default("false"),
  SOCKET_AUTH_BYPASS: z.string().optional().default("false")
});

export const env = (() => {
  try {
    return envSchema.parse(process.env);
  } catch (err) {
    if (err instanceof ZodError) {
      console.error("Invalid environment configuration.");
      console.error("Create `.env` from `.env.example` (or set env vars in your shell).");
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "(root)";
        console.error(`- ${key}: ${issue.message}`);
      }
      process.exit(1);
    }
    throw err;
  }
})();
