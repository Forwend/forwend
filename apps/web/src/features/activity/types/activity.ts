import type { z } from "zod";
import type { activityItemSchema, activityPageSchema } from "@/features/activity/schemas/activity";

export type ActivityItem = z.infer<typeof activityItemSchema>;

export type ActivityPage = z.infer<typeof activityPageSchema>;
