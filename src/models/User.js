import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: String, default: "" },
    region: { type: String, default: "global", trim: true, index: true },
    stats: {
      wins: { type: Number, default: 0, min: 0 },
      losses: { type: Number, default: 0, min: 0 },
      draws: { type: Number, default: 0, min: 0 },
      xp: { type: Number, default: 0, min: 0 },
      currentStreak: { type: Number, default: 0, min: 0 },
      bestStreak: { type: Number, default: 0, min: 0 }
    },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    settings: {
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
      allowFriendRequests: { type: Boolean, default: true },
      notificationsEnabled: { type: Boolean, default: true },
      musicEnabled: { type: Boolean, default: true },
      musicVolume: { type: Number, min: 0, max: 1, default: 0.6 }
    }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        return ret;
      }
    }
  }
);

userSchema.virtual("winRate").get(function getWinRate() {
  const wins = Number(this?.stats?.wins || 0);
  const losses = Number(this?.stats?.losses || 0);
  const draws = Number(this?.stats?.draws || 0);
  const total = wins + losses + draws;
  if (total <= 0) return 0;
  return Math.round((wins / total) * 100);
});

userSchema.index({ "stats.xp": -1, region: 1, username: 1 });

export default mongoose.model("User", userSchema);
