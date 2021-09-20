import { z } from "zod";

export const UpdateProfileRequest = z.object({
  id: z.string(),
  username: z.string(),
  avatarUrl: z.string().url("not a valid URL"),
  contact: z.object({
    phoneNumber: z.string(),
  }),
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
