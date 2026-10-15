import type { z } from "zod";
import type { notificationsSchema } from "@/features/profiles/schemas/profiles";

export type Notifications = z.infer<typeof notificationsSchema>;
