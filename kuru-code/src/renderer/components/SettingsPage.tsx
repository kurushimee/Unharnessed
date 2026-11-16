import {
  BookTextIcon,
  BotIcon,
  BlocksIcon,
  InfoIcon,
  PlugIcon,
  RotateCcwIcon,
  Settings2Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AppPrefs } from "@shared/protocol";
import { Providers } from "@panel/Providers";
import { Settings, type SettingsTab } from "@panel/Settings";
import { invoke, post } from "~/bridge";
import { cn } from "~/lib/utils";
import { set, useStore, type SettingsSection } from "~/state";
import { Button } from "./ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { WorkspaceHeader } from "./WorkspaceHeader";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Settings2Icon; group: string }[] = [
  { id: "general", label: "General", icon: Settings2Icon, group: "App" },
  { id: "providers", label: "Providers", icon: PlugIcon, group: "Agent" },
  { id: "agent", label: "Agent", icon: BotIcon, group: "Agent" },
  { id: "mcp", label: "MCP servers", icon: BlocksIcon, group: "Agent" },
  { id: "skills", label: "Skills", icon: SparklesIcon, group: "Agent" },
  { id: "instructions", label: "Instructions", icon: BookTextIcon, group: "Agent" },
  { id: "about", label: "About", icon: InfoIcon, group: "App" },
];

const AGENT_TABS: Partial<Record<SettingsSection, SettingsTab>> = {
  agent: "general",
  mcp: "mcp",
  skills: "skills",
  instructions: "instructions",
};

/** Settings, as T3 Code lays them out: a list of sections, one page each. */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const settings = useStore((state) => state.settings);
  const agent = useStore((state) => state.agent);
  const session = useStore((state) => state.session);
  const providers = useStore((state) => state.providers);
  const settingResult = useStore((state) => state.settingResult);
  const providerResult = useStore((state) => state.providerResult);
  const localScan = useStore((state) => state.localScan);
  const localProbe = useStore((state) => state.localProbe);
  const ready = agent?.kind === "ready";
  const close = () => set({ settingsOpen: null });
  const tab = AGENT_TABS[section];
  const current = SECTIONS.find((item) => item.id === section)!;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceHeader>
        <h1 className="text-sm font-medium">Settings</h1>
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label="Close settings" onClick={close}>
          <XIcon />
        </Button>
      </WorkspaceHeader>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings" className="w-52 shrink-0 overflow-y-auto border-r border-border/60 px-2 py-3">
          {["App", "Agent"].map((group) => (
            <div key={group} className="mb-3">
              <div className="px-2.5 pb-1 text-2xs font-medium text-muted-foreground">{group}</div>
              {SECTIONS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => set({ settingsOpen: item.id })}
                  className={cn(
                    "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm hover:bg-accent",
                    section === item.id ? "bg-accent font-medium text-foreground" : "text-foreground/80",
                  )}
                >
                  <item.icon className="size-4 text-muted-foreground" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">{current.label}</h2>
            {settings.pending.length > 0 && tab ? (
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-surface px-3 py-2 text-sm">
                <span className="flex-1">Some changes apply when the agent restarts.</span>
                <Button size="xs" variant="outline" disabled={!ready} onClick={() => post({ type: "restartAgent" })}>
                  <RotateCcwIcon />
                  {ready ? "Restart agent" : "Restarting"}
                </Button>
              </div>
            ) : null}
            {section === "general" ? <GeneralSection /> : null}
            {section === "about" ? <AboutSection /> : null}
            {section === "providers" ? (
              <div className="kuru-panel-page">
                {agent?.kind === "ready" ? (
                  <Providers providers={providers ?? []} result={providerResult} local={{ scan: localScan, probe: localProbe }} onBack={close} />
                ) : (
                  <p className="text-sm text-muted-foreground">The agent is starting…</p>
                )}
              </div>
            ) : null}
            {tab ? (
              <div className="kuru-panel-page">
                <Settings
                  settings={settings}
                  ready={ready}
                  session={session}
                  providers={providers ?? []}
                  result={settingResult}
                  tab={tab}
                  onTab={() => {}}
                  onBack={close}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-border/60 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function setPrefs(prefs: Partial<AppPrefs>) {
  post({ type: "setPrefs", prefs });
}

function GeneralSection() {
  const prefs = useStore((state) => state.prefs);
  return (
    <div className="rounded-xl border bg-card px-4">
      <Row title="Theme" description="Follow Windows, or always light or dark.">
        <Select value={prefs.theme} onValueChange={(value) => setPrefs({ theme: value as AppPrefs["theme"] })}>
          <SelectTrigger className="w-32" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectPopup>
        </Select>
      </Row>
      <Row title="Timestamps" description="How the sidebar shows when a thread last changed.">
        <Select value={prefs.timestampFormat} onValueChange={(value) => setPrefs({ timestampFormat: value as AppPrefs["timestampFormat"] })}>
          <SelectTrigger className="w-32" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="relative">Relative</SelectItem>
            <SelectItem value="24h">24-hour</SelectItem>
            <SelectItem value="12h">12-hour</SelectItem>
          </SelectPopup>
        </Select>
      </Row>
      <Row title="Notifications" description="A Windows notification when a thread finishes while you are elsewhere.">
        <Switch checked={prefs.notifications} onCheckedChange={(checked) => setPrefs({ notifications: checked })} />
      </Row>
      <Row title="Working section" description="Threads with a running turn gather at the top of the sidebar.">
        <Switch checked={prefs.workingSection} onCheckedChange={(checked) => setPrefs({ workingSection: checked })} />
      </Row>
      <Row title="Confirm thread deletion" description="Ask before deleting a thread.">
        <Switch checked={prefs.confirmDelete} onCheckedChange={(checked) => setPrefs({ confirmDelete: checked })} />
      </Row>
    </div>
  );
}

type Info = { version: string; electron: string; binary: string; log: string; userData: string };

function AboutSection() {
  const [info, setInfo] = useState<Info | null>(null);
  const agent = useStore((state) => state.agent);
  useEffect(() => void invoke<Info>("app.info").then(setInfo), []);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-4">
        <Row title="kuru code" description={info ? `Version ${info.version} · Electron ${info.electron}` : undefined}>
          <span />
        </Row>
        <Row title="Agent" description={info?.binary}>
          <Button size="xs" variant="outline" disabled={agent?.kind === "starting"} onClick={() => post({ type: "restartAgent" })}>
            <RotateCcwIcon />
            Restart
          </Button>
        </Row>
        <Row title="Log" description={info?.log}>
          <Button size="xs" variant="outline" onClick={() => info && void invoke("shell.showItemInFolder", { path: info.log })}>
            Show
          </Button>
        </Row>
        <Row title="App data" description={info?.userData}>
          <Button size="xs" variant="outline" onClick={() => info && void invoke("shell.openPath", { path: info.userData })}>
            Open
          </Button>
        </Row>
      </div>
      <p className="text-xs text-muted-foreground">The interface comes from T3 Code (MIT, © T3 Tools Inc.); the agent is Unharnessed.</p>
    </div>
  );
}
