// The skills: the extension's Skills tab (vscode/webview/SettingsSkills.tsx), shown as
// T3 Code shows its settings. The skills the agent finds, on or off; a new one; the
// folders it reads them from. It loads them when it starts.
import { ExternalLinkIcon, FolderIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Skill } from "@shared/protocol";
import { post } from "~/bridge";
import { useStore } from "~/state";
import { Badge } from "../ui/badge";
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentRestartNotice, DialogField, FieldError } from "./agentSettingsCommon";
import { useSettingsActions, useSettled, type SettingsActions } from "./settingsActions";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** From this many skills on, a search field filters them. */
const SEARCH_FROM = 9;

/** A skill's name: lowercase letters, digits and single hyphens. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const GROUPS: [string, string, (skill: Skill) => boolean][] = [
  ["skills-yours", "Yours", (skill) => skill.source === "user" || skill.source === "folder"],
  ["skills-workspace", "This workspace", (skill) => skill.source === "project"],
  ["skills-builtin", "Built in", (skill) => skill.source === "builtin"],
];

export function SkillsSettingsPanel() {
  const skills = useStore((state) => state.settings.skills);
  const actions = useSettingsActions();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  if (!skills) {
    return (
      <SettingsPageContainer>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">Reading the skills…</p>
      </SettingsPageContainer>
    );
  }
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = skills.skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const groups = GROUPS.map(([id, label, belongs]) => [id, label, shown.filter(belongs)] as const);
  return (
    <SettingsPageContainer>
      <AgentRestartNotice />
      <section {...searchableSetting("skills")} className="flex flex-col gap-3 px-3 sm:px-4">
        <p className="text-xs text-muted-foreground">
          Instructions the agent follows when a task calls for them: it sees each skill's name and
          description, and reads the rest when needed. Changes apply when it restarts.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!actions.ready} onClick={() => setCreating(true)}>
            <PlusIcon />
            New skill
          </Button>
          {skills.skills.length >= SEARCH_FROM ? (
            <InputGroup className="ms-auto w-56" data-size="sm">
              <InputGroupAddon>
                <SearchIcon className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                size="sm"
                type="search"
                placeholder="Search skills"
                aria-label="Search skills"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
          ) : null}
        </div>
      </section>
      {groups.map(([id, label, rows]) =>
        rows.length > 0 ? (
          <SettingsSection key={id} id={id} title={label}>
            {rows.map((skill) => (
              <SkillRow key={skill.path} skill={skill} actions={actions} />
            ))}
          </SettingsSection>
        ) : null,
      )}
      {shown.length === 0 ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">No skill matches “{query.trim()}”.</p>
      ) : null}
      {skills.problems.length > 0 ? (
        <SettingsSection id="skills-problems" title="Not loaded">
          {skills.problems.map((problem, at) => (
            <SettingsRow
              key={at}
              title={problem.message}
              {...(problem.path ? { description: <span className="font-mono">{problem.path}</span> } : {})}
            />
          ))}
        </SettingsSection>
      ) : null}
      <Folders folders={skills.folders} actions={actions} />
      {creating ? <NewSkillDialog actions={actions} onDone={() => setCreating(false)} /> : null}
    </SettingsPageContainer>
  );
}

function SkillRow({ skill, actions }: { skill: Skill; actions: SettingsActions }) {
  const key = `skill:${skill.path}`;
  const on = key in actions.drafts ? actions.drafts[key] === true : skill.enabled;
  const builtin = skill.source === "builtin";
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-1.5">
          {skill.name}
          {on !== skill.active ? (
            <Tooltip>
              <TooltipTrigger render={<Badge variant="outline" size="sm" />}>restart</TooltipTrigger>
              <TooltipPopup side="top">Applies when the agent restarts</TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
      }
      description={skill.description}
      status={
        <span className="flex flex-col gap-1">
          {!builtin ? (
            <span className="flex items-center gap-1 font-mono">
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate">{skill.location}</span>
            </span>
          ) : !on ? (
            "Off in settings.json"
          ) : null}
          <FieldError>{actions.errors[key]}</FieldError>
        </span>
      }
      control={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Open ${skill.name}'s SKILL.md`}
                  onClick={() => post({ type: "openFile", path: skill.path })}
                />
              }
            >
              <ExternalLinkIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Open SKILL.md</TooltipPopup>
          </Tooltip>
          {!builtin ? (
            <Switch
              checked={on}
              disabled={!actions.ready}
              onCheckedChange={(checked) =>
                actions.act(key, Boolean(checked), {
                  type: "setSkill",
                  path: skill.path,
                  enabled: Boolean(checked),
                })
              }
              aria-label={`Use ${skill.name}`}
            />
          ) : null}
        </>
      }
    />
  );
}

/** A new skill in the agent's skills folder; its file opens once written. */
function NewSkillDialog({ actions, onDone }: { actions: SettingsActions; onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const key = "skills/create";
  const busy = key in actions.drafts;
  const sent = useSettled(key, actions, onDone);
  const trimmed = name.trim();
  const problem =
    trimmed && !NAME.test(trimmed)
      ? "Lowercase letters, digits and single hyphens, like pdf-reports."
      : undefined;
  const complete = trimmed !== "" && description.trim() !== "" && !problem;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete || busy) return;
    sent();
    actions.act(key, true, { type: "createSkill", name: trimmed, description: description.trim() });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogPopup>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>Written to the agent's skills folder, then opened.</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <DialogField label="Name">
              <Input
                placeholder="e.g. pdf-reports"
                spellCheck={false}
                autoFocus
                maxLength={64}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </DialogField>
            <DialogField
              label="Description"
              help="What it does and when to use it: the agent picks skills by it."
            >
              <Input
                placeholder="e.g. Write PDF reports from data. Use when asked for a report."
                maxLength={1024}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </DialogField>
            <FieldError>{problem}</FieldError>
            <FieldError>{actions.errors[key]}</FieldError>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || busy || !actions.ready}>
              {busy ? "Creating" : "Create and open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** The folders added to the `skills` setting; the usual ones are always read. */
function Folders({ folders, actions }: { folders: ReadonlyArray<string>; actions: SettingsActions }) {
  const [path, setPath] = useState("");
  const key = "skills/folder";
  const busy = key in actions.drafts;
  const sent = useSettled(key, actions, () => setPath(""));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!path.trim() || busy) return;
    sent();
    actions.act(key, true, { type: "skillFolder", path: path.trim(), add: true });
  };

  return (
    <SettingsSection {...searchableSetting("skill-folders")} title="Folders">
      <p className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">
        The agent reads ~/.unharnessed/skills, ~/.agents/skills, and the workspace's
        .unharnessed/skills and .agents/skills. It also reads the folders added here.
      </p>
      {folders.map((folder) => (
        <SettingsRow
          key={folder}
          title={
            <span className="flex items-center gap-1.5 font-mono">
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              {folder}
            </span>
          }
          control={
            <Button
              size="icon-xs"
              variant="ghost-destructive"
              aria-label={`Remove ${folder}`}
              disabled={!actions.ready || busy}
              onClick={() => actions.act(key, true, { type: "skillFolder", path: folder, add: false })}
            >
              <XIcon />
            </Button>
          }
        />
      ))}
      <form className="flex items-center gap-2 px-3 py-3 sm:px-4" onSubmit={submit}>
        <Input
          size="sm"
          className="font-mono"
          placeholder="e.g. ~/.claude/skills"
          aria-label="Folder to add"
          spellCheck={false}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button size="sm" type="submit" variant="outline" disabled={!path.trim() || busy || !actions.ready}>
          Add
        </Button>
      </form>
      {actions.errors[key] ? (
        <div className="px-3 pb-3 sm:px-4">
          <FieldError>{actions.errors[key]}</FieldError>
        </div>
      ) : null}
    </SettingsSection>
  );
}
