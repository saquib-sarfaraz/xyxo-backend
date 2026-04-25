import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jti: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenJti: { type: String, default: "" },
    createdByIp: { type: String, default: "" },
    userAgent: { type: String, default: "" }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

refreshTokenSchema.index({ user: 1, jti: 1 }, { unique: true });
// Automatically delete documents once the refresh token has expired.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("RefreshToken", refreshTokenSchema);
