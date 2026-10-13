import type { z } from "zod";
import type { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import type { meSchema, profileSchema } from "@/features/profiles/schemas/profiles";

export type ProfileKind = (typeof PROFILE_KINDS)[keyof typeof PROFILE_KINDS];

export type Profile = z.infer<typeof profileSchema>;

export type Me = z.infer<typeof meSchema>;
