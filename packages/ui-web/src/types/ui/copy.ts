import type { COPY_STATUS } from "../../constants/copy";

export type CopyStatus = (typeof COPY_STATUS)[keyof typeof COPY_STATUS];
