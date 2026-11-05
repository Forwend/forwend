import { useEffect, useRef, useState } from "react";
import { CODE_LENGTH } from "@/features/auth/constants/sign-in";

/** A full code is tried once however it arrived (typed, pasted or autofilled). The returned retry tries the same
 * code again, as a Sign in or Confirm button does. */
export function useFullCode(
  code: string,
  enabled: boolean,
  tryCode: (code: string) => void,
): () => void {
  const tried = useRef("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const key = `${attempt}:${code}`;
    // A code cleared or edited is new again once full, even with the same digits.
    if (code.length !== CODE_LENGTH) tried.current = "";
    if (!enabled || code.length !== CODE_LENGTH || tried.current === key) return;
    tried.current = key;
    tryCode(code);
  }, [code, enabled, attempt, tryCode]);
  return () => setAttempt((n) => n + 1);
}
