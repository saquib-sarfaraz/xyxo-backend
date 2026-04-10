import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false }
  },
  { timestamps: true, versionKey: false }
);

export default mongoose.model("Notification", notificationSchema);
