import * as React from "react";

/** T3 Code's signature; `_target` names what is copied in T3 Code's errors. */
export async function writeTextToClipboard(value: string, _target = "text"): Promise<boolean> {
  if (!value) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

export function useCopyToClipboard<TContext = void>({
  timeout = 2000,
  onCopy,
  onError,
}: {
  timeout?: number;
  target?: string;
  onCopy?: (ctx: TContext) => void;
  onError?: (error: Error, ctx: TContext) => void;
} = {}): { copyToClipboard: (value: string, ctx: TContext) => void; isCopied: boolean } {
  const [isCopied, setIsCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToClipboard = (value: string, ctx: TContext): void => {
    void writeTextToClipboard(value).then(
      (didCopy) => {
        if (!didCopy) return;
        if (timer.current) clearTimeout(timer.current);
        setIsCopied(true);
        onCopy?.(ctx);
        if (timeout !== 0) {
          timer.current = setTimeout(() => {
            setIsCopied(false);
            timer.current = null;
          }, timeout);
        }
      },
      (error: Error) => onError?.(error, ctx),
    );
  };
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { copyToClipboard, isCopied };
}
