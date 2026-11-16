// Instructions per model: the extension's Instructions tab
// (vscode/webview/SettingsInstructions.tsx), shown as T3 Code shows its settings. A group's
// text joins the agent's system prompt when it runs on one of the group's models. A group
// shows only the models of connected providers; the others stay in the file and come back
// with their provider, and so does a group left with none.
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ModelChoice, ModelInstructions, Provider } from "@shared/protocol";
import { useStore } from "~/state";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Textarea } from "../ui/textarea";
import {
  DialogField,
  FieldError,
  ProviderIcon,
  isLocalProvider,
  modelKey,
  providerName,
  useModelChoices,
} from "./agentSettingsCommon";
import { useSettingsActions, useSettled, type SettingsActions } from "./settingsActions";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const KEY = "modelInstructions";

/** The models of the connected providers, by key: the only ones a group shows. */
function connectedModels(
  choices: ReadonlyArray<ModelChoice>,
  providers: ReadonlyArray<Provider>,
): Map<string, ModelChoice> {
  const connected = new Set(providers.filter((p) => p.connected).map((p) => p.id));
  return new Map(
    choices.filter((choice) => connected.has(choice.provider)).map((choice) => [modelKey(choice), choice]),
  );
}

export function InstructionsSettingsPanel() {
  const values = useStore((state) => state.settings.view?.values ?? null);
  const providers = useStore((state) => state.providers) ?? [];
  const choices = useModelChoices();
  const actions = useSettingsActions();
  // The group whose dialog is open, by its place in the file, or `+` for a new one.
  const [open, setOpen] = useState<number | "+" | null>(null);

  const groups = values === null ? null : Array.isArray(values[KEY]) ? (values[KEY] as ModelInstructions[]) : [];
  const connected = choices ? connectedModels(choices, providers) : new Map<string, ModelChoice>();
  const shown = (groups ?? [])
    .map((group, index) => ({
      index,
      text: group.text,
      models: group.models.flatMap((key) => connected.get(key) ?? []),
    }))
    .filter((group) => group.models.length > 0);
  const editing = typeof open === "number" ? shown.find((group) => group.index === open) : undefined;

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("model-instructions")}
        title="Instructions per model"
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={!actions.ready || groups === null || choices === null}
            onClick={() => setOpen("+")}
          >
            <PlusIcon />
            New group
          </Button>
        }
      >
        <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">
          A group's text joins the agent's instructions whenever it runs on one of the group's
          models. Changes apply from the next conversation.
        </p>
        {groups === null ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">Reading the settings…</p>
        ) : choices === null ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            The groups show once a session is open.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">No group yet.</p>
        ) : (
          shown.map((group) => (
            <SettingsRow
              key={group.index}
              title={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {group.models.map((choice) => (
                    <span key={modelKey(choice)} className="flex items-center gap-1.5">
                      <ProviderIcon
                        providerId={choice.provider}
                        name={providerName(providers, choice.provider)}
                        local={isLocalProvider(providers, choice.provider)}
                      />
                      {choice.name}
                    </span>
                  ))}
                </span>
              }
              description={<span className="line-clamp-2 whitespace-pre-wrap">{group.text}</span>}
              control={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!actions.ready}
                  onClick={() => setOpen(group.index)}
                >
                  Edit
                </Button>
              }
            />
          ))
        )}
        {open === null && actions.errors[KEY] ? (
          <div className="px-3 pb-3 sm:px-4">
            <FieldError>{actions.errors[KEY]}</FieldError>
          </div>
        ) : null}
      </SettingsSection>
      {open !== null && (open === "+" || editing) ? (
        <GroupDialog
          key={String(open)}
          index={open === "+" ? null : open}
          checked={editing ? editing.models.map(modelKey) : []}
          text={editing?.text ?? ""}
          choices={[...connected.values()]}
          providers={providers}
          actions={actions}
          onDone={() => setOpen(null)}
        />
      ) : null}
    </SettingsPageContainer>
  );
}

/**
 * A group's dialog: the models to check, among the connected providers' ones, and the
 * text. It saves with at least one model and some text; the group's hidden models stay
 * as they are (the main process keeps them).
 */
function GroupDialog({
  index,
  checked: initial,
  text: initialText,
  choices,
  providers,
  actions,
  onDone,
}: {
  /** `null`: a new group. */
  index: number | null;
  checked: ReadonlyArray<string>;
  text: string;
  choices: ReadonlyArray<ModelChoice>;
  providers: ReadonlyArray<Provider>;
  actions: SettingsActions;
  onDone: () => void;
}) {
  const [checked, setChecked] = useState<ReadonlyArray<string>>(initial);
  const [text, setText] = useState(initialText);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState(false);
  const sent = useSettled(KEY, actions, onDone);
  const busy = KEY in actions.drafts;
  const complete = checked.length > 0 && text.trim() !== "";
  const toggle = (key: string) =>
    setChecked((current) =>
      current.includes(key) ? current.filter((other) => other !== key) : [...current, key],
    );
  const send = (group: ModelInstructions | null) => {
    sent();
    actions.act(KEY, true, { type: "setInstructions", index, group });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (complete && !busy) send({ models: [...checked], text: text.trim() });
  };

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const byProvider = new Map<string, ModelChoice[]>();
  for (const choice of choices) {
    const haystack = `${choice.name} ${choice.id} ${providerName(providers, choice.provider)}`.toLowerCase();
    if (!words.every((word) => haystack.includes(word))) continue;
    byProvider.set(choice.provider, [...(byProvider.get(choice.provider) ?? []), choice]);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogPopup className="max-w-xl">
        {deleting ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete this group?</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <FieldError>{actions.errors[KEY]}</FieldError>
            </DialogPanel>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!actions.ready || busy} onClick={() => send(null)}>
                {busy ? "Deleting" : "Delete"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{index === null ? "New group" : "Group"}</DialogTitle>
            </DialogHeader>
            <DialogPanel className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">
                  Models{checked.length > 0 ? ` (${checked.length})` : ""}
                </span>
                <InputGroup data-size="sm">
                  <InputGroupAddon>
                    <SearchIcon className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    size="sm"
                    type="search"
                    placeholder="Search models"
                    aria-label="Search models"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </InputGroup>
                <div className="max-h-56 overflow-y-auto rounded-lg border p-1">
                  {[...byProvider.entries()].map(([provider, models]) => (
                    <div key={provider} className="py-1">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        {providerName(providers, provider)}
                      </div>
                      {models.map((choice) => (
                        <label
                          key={modelKey(choice)}
                          className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked.includes(modelKey(choice))}
                            onCheckedChange={() => toggle(modelKey(choice))}
                          />
                          <ProviderIcon
                            providerId={choice.provider}
                            name={providerName(providers, choice.provider)}
                            local={isLocalProvider(providers, choice.provider)}
                          />
                          <span className="truncate">{choice.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                  {byProvider.size === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">No model matches.</p>
                  ) : null}
                </div>
              </div>
              <DialogField label="Instructions">
                <Textarea
                  rows={5}
                  placeholder="e.g. Be concise. No summary at the end."
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </DialogField>
              <FieldError>{actions.errors[KEY]}</FieldError>
            </DialogPanel>
            <DialogFooter>
              {index !== null ? (
                <Button
                  type="button"
                  variant="destructive-outline"
                  className="sm:me-auto"
                  onClick={() => setDeleting(true)}
                >
                  Delete
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={!complete || busy || !actions.ready}>
                {busy ? "Saving" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  );
}
