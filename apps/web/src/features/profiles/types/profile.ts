import type { z } from "zod";
import type { PERMISSIONS, PROFILE_KINDS, ROLES } from "@/features/profiles/constants/profile";
import type { meSchema, profileSchema } from "@/features/profiles/schemas/profiles";

export type ProfileKind = (typeof PROFILE_KINDS)[keyof typeof PROFILE_KINDS];

export type Role = (typeof ROLES)[keyof typeof ROLES];

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type Profile = z.infer<typeof profileSchema>;

export type Me = z.infer<typeof meSchema>;
