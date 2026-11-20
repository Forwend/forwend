import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";

export interface SaveStatusProps {
  saving: boolean;
  saved: boolean;
  failed: boolean;
}

export function SaveStatus({ saving, saved, failed }: SaveStatusProps) {
  return (
    <>
      <p role="status" className="min-h-5 text-sm text-muted">
        {saving ? COPY.saving : saved ? COPY.savedAll : null}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {COPY.saveFailed}
        </p>
      ) : null}
    </>
  );
}
