import mongoose from "mongoose";

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

const matchSchema = new mongoose.Schema(
  {
    game: { type: mongoose.Schema.Types.ObjectId, ref: "Game", required: true, index: true },
    players: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2 && v[0]?.toString() !== v[1]?.toString(),
        message: "Players must have exactly 2 unique users"
      },
      index: true
    },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    isDraw: { type: Boolean, default: false, index: true },
    xpAwarded: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, versionKey: false }
);

matchSchema.pre("validate", function normalizeResult(next) {
  if (this.isDraw) {
    this.winner = null;
    this.loser = null;
    this.xpAwarded = 0;
  }
  return next();
});

// Rolling 7-day leaderboard storage: automatically delete match docs older than 7 days.
matchSchema.index({ createdAt: 1 }, { expireAfterSeconds: SEVEN_DAYS_SECONDS });

export default mongoose.model("Match", matchSchema);

