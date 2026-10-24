import type { z } from "zod";
import type { profileTokensSchema, tokenRefSchema } from "@/features/profiles/schemas/profiles";

export type TokenRef = z.infer<typeof tokenRefSchema>;

export type TokenSwitch = z.infer<typeof profileTokensSchema>["tokens"][number];
