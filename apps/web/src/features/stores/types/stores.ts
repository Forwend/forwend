import type { z } from "zod";
import type { storeBodySchema, storeSchema } from "@/features/stores/schemas/stores";

export type Store = z.infer<typeof storeSchema>;

export type StoreBody = z.infer<typeof storeBodySchema>;

export type StoreField = keyof StoreBody;
