import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

type PendingConfirm = { message: string; resolve: (v: boolean) => void };

const ConfirmContext = createContext<((message: string) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Ref mirror so the dialog's own buttons always resolve the *current*
  // pending confirm even if a re-render happened between open and click.
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirmAsync = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      const next = { message, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  function settle(result: boolean) {
    pendingRef.current?.resolve(result);
    pendingRef.current = null;
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirmAsync}>
      {children}
      {pending && (
        <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && settle(false)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true">
            <p className="confirm-message">{pending.message}</p>
            <div className="confirm-actions">
              <Button variant="secondary" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => settle(true)}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Async drop-in for window.confirm: `if (!(await confirm("..."))) return;`
 * Styled to match the rest of the app instead of a native browser dialog.
 */
export function useConfirm(): (message: string) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
