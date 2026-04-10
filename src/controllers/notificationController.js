import Notification from "../models/Notification.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";

export const listMine = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ notifications });
});

export const markRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  const n = await Notification.findOneAndUpdate(
    { _id: notificationId, user: req.user.id },
    { $set: { read: true } },
    { new: true }
  );
  if (!n) throw new HttpError(404, "Notification not found");
  res.json({ notification: n });
});
