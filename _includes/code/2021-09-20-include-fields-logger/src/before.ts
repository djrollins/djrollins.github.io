import pino from "pino";
import _ from "lodash";
import { UpdateProfileRequest } from "./types";
import { badResponse, ok } from "./http";
import { updateProfile } from "./service";

const logger = pino({
  redact: ["body.contact.phoneNumber"],
});

export const updateProfileHandler = (body: unknown) => {
  const updateRequest = UpdateProfileRequest.safeParse(body);

  if (!updateRequest.success) {
    const errors = updateRequest.error.flatten();
    logger.warn({ body, ...errors });
    return badResponse(JSON.stringify(errors));
  }

  updateProfile(updateRequest.data);
  return ok();
};

updateProfileHandler({
  id: "123456",
  username: "DanielJRollins",
  avatarUrl: "avatars.githubusercontent.com/u/7419862?v=4",
  contact: {
    phoneNumber: "07000000000"
  }
});
