import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validateMiddleware.js";
import { acceptRequest, listFriends, listIncomingRequests, sendRequest } from "../controllers/friendController.js";

const router = Router();

router.use(requireAuth);

router.get("/", listFriends);
router.get("/requests", listIncomingRequests);

router.post(
  "/requests",
  validate({
    body: z.object({
      receiverId: z.string().min(1)
    })
  }),
  sendRequest
);

router.post(
  "/requests/:requestId/accept",
  validate({
    params: z.object({ requestId: z.string().min(1) })
  }),
  acceptRequest
);

export default router;
