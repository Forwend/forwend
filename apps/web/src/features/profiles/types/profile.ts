import type { z } from "zod";
import type {
  FEES_PAID_BY,
  PERMISSIONS,
  PROFILE_KINDS,
  ROLES,
} from "@/features/profiles/constants/profile";
import type { meSchema, profileSchema } from "@/features/profiles/schemas/profiles";

export type ProfileKind = (typeof PROFILE_KINDS)[keyof typeof PROFILE_KINDS];

export type Role = (typeof ROLES)[keyof typeof ROLES];

export type FeesPaidBy = (typeof FEES_PAID_BY)[keyof typeof FEES_PAID_BY];

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type Profile = z.infer<typeof profileSchema>;

export type Me = z.infer<typeof meSchema>;
