import { ZodError } from "zod";
import { HttpError } from "../utils/httpError.js";

export const notFound = (_req, _res, next) => next(new HttpError(404, "Not found"));

export const errorHandler = (err, _req, res, _next) => {
  if (err?.code === 11000) {
    return res.status(409).json({ error: "Conflict" });
  }

  if (err?.name === "CastError") {
    return res.status(400).json({ error: "Invalid id" });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "ValidationError",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    });
  }

  const status = err instanceof HttpError ? err.statusCode : 500;
  const message =
    err instanceof HttpError ? err.message : "Internal server error";

  if (status >= 500) {
    console.error(err);
  }

  return res.status(status).json({ error: message });
};
