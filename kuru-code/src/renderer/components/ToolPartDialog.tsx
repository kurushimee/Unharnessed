import { CopyIcon } from "lucide-react";
import { useStore, set } from "~/state";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";

/** A cell's code or output, whole: what the VS Code extension opens in an editor tab. */
export function ToolPartDialog() {
  const part = useStore((state) => state.toolPart);
  return (
    <Dialog open={part !== null} onOpenChange={(open) => !open && set({ toolPart: null })}>
      <DialogPopup className="h-[80vh] max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {part?.part === "input" ? (part.python ? "Python" : "Command") : "Output"}
            <Button size="icon-xs" variant="ghost" aria-label="Copy" onClick={() => part && void navigator.clipboard.writeText(part.text)}>
              <CopyIcon />
            </Button>
          </DialogTitle>
        </DialogHeader>
        <pre className="min-h-0 flex-1 overflow-auto border-t bg-code px-5 py-4 font-mono text-xs leading-5 whitespace-pre">{part?.text}</pre>
      </DialogPopup>
    </Dialog>
  );
}
