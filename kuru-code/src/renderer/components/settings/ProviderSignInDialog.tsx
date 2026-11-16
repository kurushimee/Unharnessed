// A browser sign-in, from the providers or the MCP servers: the extension's sign-in screen
// (vscode/webview/SignIn.tsx) as a T3 Code dialog. One action: open the page; the dialog
// moves on by itself once the provider has answered. A paste that races the browser (a
// redirect URL, a Prime API key) stays behind a link: it is only needed when the browser
// cannot reach the agent (callback port taken).
import { CheckIcon, CopyIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { LoginState } from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { FieldError } from "./agentSettingsCommon";

/** The device flows (xAI, GitHub Copilot) give their code this way. */
const DEVICE_CODE = /^Enter code:\s*(\S+)$/;

type PromptUpdate = NonNullable<LoginState["prompt"]>;

export function ProviderSignInDialog() {
  const login = useStore((state) => state.login);
  if (!login) return null;
  const failed = login.error !== undefined;
  const cancel = () => post({ type: failed ? "loginClose" : "loginCancel" });
  const optional = login.url && login.prompt?.optional ? login.prompt : undefined;
  const required = optional ? undefined : login.prompt;
  const code = login.url?.instructions?.match(DEVICE_CODE)?.[1];

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{login.name}</DialogTitle>
          {!failed && login.url ? (
            <DialogDescription>
              {code
                ? "Enter this code on the sign-in page."
                : "Sign in with your browser. This moves on by itself once you are signed in."}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          {failed ? (
            <FieldError>{login.error}</FieldError>
          ) : (
            <>
              {code ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-md border bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
                    {code}
                  </span>
                  <CopyCode code={code} />
                </div>
              ) : null}
              {login.url ? (
                <Button
                  className="self-start"
                  onClick={() => {
                    if (code) post({ type: "copy", text: code });
                    post({ type: "loginOpen" });
                  }}
                >
                  <ExternalLinkIcon />
                  {code ? "Copy code and open the page" : "Open the sign-in page"}
                </Button>
              ) : null}
              {required ? <Prompt key={required.promptId} prompt={required} label={required.message} /> : null}
              {login.team ? <TeamPicker key={login.team.promptId} team={login.team} /> : null}
              {!required && !login.team ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {login.status?.message ?? (login.url ? "Waiting for you to sign in" : "Starting sign-in")}
                </p>
              ) : null}
              {optional ? (
                <Fallback key={optional.promptId} prompt={optional} providerId={login.providerId} />
              ) : null}
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          {failed ? (
            <>
              <Button variant="ghost" onClick={cancel}>
                Close
              </Button>
              <Button onClick={() => post({ type: "login", providerId: login.providerId })}>
                <RotateCcwIcon />
                Try again
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** The paste racing the browser, folded until asked for. */
function Fallback({ prompt, providerId }: { prompt: PromptUpdate; providerId: string }) {
  const [open, setOpen] = useState(false);
  // Prime's alternative is a key, the others' a redirect the browser could not deliver.
  const apiKey = providerId === "prime-inference";
  if (!open) {
    return (
      <Button variant="link" size="xs" className="self-start p-0" onClick={() => setOpen(true)}>
        {apiKey ? "Use an API key instead" : "Signed in, but nothing happens?"}
      </Button>
    );
  }
  return (
    <Prompt
      prompt={prompt}
      label={
        apiKey
          ? "Prime API key"
          : "Copy the address of the page your browser ended on (it may not load) and paste it here."
      }
      secret={apiKey}
    />
  );
}

function Prompt({
  prompt,
  label,
  secret = prompt.secret,
}: {
  prompt: PromptUpdate;
  label: string;
  secret?: boolean | undefined;
}) {
  const [value, setValue] = useState("");
  const ready = prompt.allowEmpty || value.trim() !== "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) post({ type: "loginAnswer", promptId: prompt.promptId, answer: { kind: "text", value } });
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <label className="text-sm text-muted-foreground" htmlFor="sign-in-answer">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="sign-in-answer"
          type={secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={!ready}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function TeamPicker({ team }: { team: NonNullable<LoginState["team"]> }) {
  const answer = (teamId: string | null) =>
    post({ type: "loginAnswer", promptId: team.promptId, answer: { kind: "team", teamId } });
  const options = [{ id: null, name: "Personal account", role: null }, ...team.teams];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Choose a team</span>
      <div className="flex flex-col rounded-lg border p-1">
        {options.map((option) => (
          <button
            key={option.id ?? ""}
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={() => answer(option.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.name}</span>
              {option.role ? <span className="block text-xs text-muted-foreground">{option.role}</span> : null}
            </span>
            {option.id === team.current ? <CheckIcon className="size-4" /> : null}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="xs"
        className="self-start"
        onClick={() => post({ type: "loginAnswer", promptId: team.promptId, answer: { kind: "dismiss" } })}
      >
        Keep the current choice
      </Button>
    </div>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="icon-xs"
      variant="ghost-muted"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={() => {
        post({ type: "copy", text: code });
        setCopied(true);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
