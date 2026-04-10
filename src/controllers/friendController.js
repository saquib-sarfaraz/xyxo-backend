import FriendRequest from "../models/FriendRequest.js";
import User from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { createNotification } from "../services/notificationService.js";

export const sendRequest = asyncHandler(async (req, res) => {
  const senderId = req.user.id;
  const { receiverId } = req.body;

  if (senderId === receiverId) throw new HttpError(400, "Cannot friend yourself");

  const receiver = await User.findById(receiverId);
  if (!receiver) throw new HttpError(404, "Receiver not found");

  const sender = await User.findById(senderId);
  if (!sender) throw new HttpError(401, "Unauthorized");

  const alreadyFriends =
    receiver.friends.some((id) => id.toString() === senderId) ||
    sender.friends.some((id) => id.toString() === receiverId);
  if (alreadyFriends) throw new HttpError(409, "Already friends");

  const existingPending = await FriendRequest.findOne({
    status: "pending",
    $or: [
      { sender: senderId, receiver: receiverId },
      { sender: receiverId, receiver: senderId }
    ]
  });
  if (existingPending) throw new HttpError(409, "Request already pending");

  const request = await FriendRequest.create({ sender: senderId, receiver: receiverId });

  await createNotification(receiverId, {
    type: "friend_request",
    message: `Friend request from ${sender.username}`
  });

  res.status(201).json({ request });
});

export const acceptRequest = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { requestId } = req.params;

  const request = await FriendRequest.findById(requestId);
  if (!request || request.status !== "pending") throw new HttpError(404, "Request not found");
  if (request.receiver.toString() !== userId) throw new HttpError(403, "Forbidden");

  const [sender, receiver] = await Promise.all([
    User.findById(request.sender),
    User.findById(request.receiver)
  ]);
  if (!sender || !receiver) throw new HttpError(404, "User not found");

  await Promise.all([
    User.updateOne({ _id: sender._id }, { $addToSet: { friends: receiver._id } }),
    User.updateOne({ _id: receiver._id }, { $addToSet: { friends: sender._id } }),
    FriendRequest.deleteOne({ _id: request._id })
  ]);

  await createNotification(sender._id.toString(), {
    type: "friend_accepted",
    message: `${receiver.username} accepted your friend request`
  });

  res.json({ ok: true });
});

export const listFriends = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate("friends", "username name avatar");
  if (!user) throw new HttpError(404, "User not found");
  res.json({ friends: user.friends });
});

export const listIncomingRequests = asyncHandler(async (req, res) => {
  const requests = await FriendRequest.find({ receiver: req.user.id, status: "pending" })
    .populate("sender", "username name avatar")
    .sort({ createdAt: -1 });
  res.json({ requests });
});
