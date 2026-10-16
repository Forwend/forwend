import type { z } from "zod";
import type { clientBodySchema, clientSchema } from "@/features/clients/schemas/clients";

export type Client = z.infer<typeof clientSchema>;

export type ClientBody = z.infer<typeof clientBodySchema>;
