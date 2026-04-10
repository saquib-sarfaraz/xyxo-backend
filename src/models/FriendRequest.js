import mongoose from "mongoose";

const friendRequestSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    pairKey: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending"],
      default: "pending"
    }
  },
  { timestamps: true, versionKey: false }
);

friendRequestSchema.pre("validate", function setPairKey(next) {
  if (!this.sender || !this.receiver) return next();
  const a = this.sender.toString();
  const b = this.receiver.toString();
  this.pairKey = [a, b].sort().join(":");
  return next();
});

export default mongoose.model("FriendRequest", friendRequestSchema);
