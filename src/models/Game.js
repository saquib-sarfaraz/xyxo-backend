import mongoose from "mongoose";

const gameSchema = new mongoose.Schema(
  {
    players: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: () => [],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 2,
        message: "Players must have 1-2 users"
      },
      index: true
    },
    board: {
      type: [String],
      default: () => Array(9).fill(""),
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 9,
        message: "Board must have 9 cells"
      }
    },
    turn: { type: String, enum: ["X", "O"], default: "X" },
    turnStartedAt: { type: Date, default: Date.now },
    winner: { type: String, enum: ["X", "O", "DRAW", ""], default: "" },
    result: { type: String, enum: ["X", "O", "draw", ""], default: "" },
    finishedAt: { type: Date },
    status: { type: String, enum: ["waiting", "playing", "finished"], default: "waiting" },
    rematchVotes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: () => []
    },
    isProcessing: { type: Boolean, default: false },
    frozenPlayer: { type: String, enum: ["X", "O", ""], default: "" },
    powerUpUsed: { type: String, enum: ["freeze", "remove", ""], default: "" },
    powerUpTarget: { type: Number, min: 0, max: 8 }
  },
  { timestamps: true, versionKey: false }
);

gameSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model("Game", gameSchema);
