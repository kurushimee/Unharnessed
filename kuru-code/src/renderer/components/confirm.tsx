import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";

type Ask = { title: string; description?: string; confirm: string; destructive?: boolean; resolve: (ok: boolean) => void };

let show: ((ask: Ask) => void) | null = null;

/** Asks once in a dialog; `true` when confirmed. */
export function confirmAction(options: Omit<Ask, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(options.title));
    show({ ...options, resolve });
  });
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    show = (next) => {
      setAsk(next);
      setOpen(true);
    };
    return () => {
      show = null;
    };
  }, []);
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setOpen(false);
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && answer(false)}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          {ask?.description ? <AlertDialogDescription>{ask.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button variant={ask?.destructive ? "destructive" : "default"} onClick={() => answer(true)} autoFocus>
            {ask?.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
