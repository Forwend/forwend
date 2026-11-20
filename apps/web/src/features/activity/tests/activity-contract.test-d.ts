import type { activityPageSchema } from "@/features/activity/schemas/activity";
import type { Accepts, ApiAnswer, Check } from "@/shared/types/api-contract";

export type ActivitySchemasMatchTheSpec = [
  Check<Accepts<typeof activityPageSchema, ApiAnswer<"/v1/profiles/{profileId}/activity", "get">>>,
];
