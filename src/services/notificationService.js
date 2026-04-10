import Notification from "../models/Notification.js";

export const createNotification = async (userId, { type, message }) => {
  await Notification.create({ user: userId, type, message });
};
