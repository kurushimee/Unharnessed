// T3 Code's "Text generation" settings (components/settings/SettingsPanels.tsx and
// ThreadTitleInstructionsSettings.tsx): the model that writes thread titles, and
// instructions added to its prompt. With no model chosen, titles are written by the
// agent's summary model (`auxiliaryModel`), else its default model, as kuru code's
// main process asks the agent (`_unharnessed/complete`).
import { useRef } from "react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  LOCAL_ENVIRONMENT_ID,
  type ModelSelection,
  type ProviderInstanceId,
} from "~/contracts";
import { createModelSelection } from "~/shared/model";
import { useStore } from "~/state";
import { useEnvironmentProviders } from "~/state/environments";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import { providerInstanceEntriesFor, type ProviderInstanceEntry } from "../../providerInstances";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Textarea } from "../ui/textarea";
import { AdvancedSettings } from "./AdvancedSettings";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const NO_PROVIDERS = [] as const;

/** A `provider/model` setting of the agent, as one of the providers' models. */
function agentModel(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  key: unknown,
): ModelSelection | null {
  if (typeof key !== "string") return null;
  const at = key.indexOf("/");
  if (at <= 0) return null;
  return known(entries, createModelSelection(key.slice(0, at) as ProviderInstanceId, key.slice(at + 1)));
}

function known(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  if (!selection) return null;
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  return entry?.models.some((model) => model.slug === selection.model) ? selection : null;
}

export function TextGenerationSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const providers = useEnvironmentProviders().get(LOCAL_ENVIRONMENT_ID) ?? NO_PROVIDERS;
  const agentValues = useStore((state) => state.settings.view?.values ?? null);
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const chosen = known(entries, settings.textGenerationModelSelection);
  // What the agent writes titles with when none is chosen (kuru code's main process).
  const selection =
    chosen ??
    agentModel(entries, agentValues?.["auxiliaryModel"]) ??
    (typeof agentValues?.["defaultProvider"] === "string"
      ? agentModel(entries, `${agentValues["defaultProvider"]}/${String(agentValues["defaultModel"])}`)
      : null);
  const entry = selection
    ? entries.find((candidate) => candidate.instanceId === selection.instanceId)
    : undefined;
  const modelOptionsByInstance = new Map(
    entries.map((candidate) => [
      candidate.instanceId,
      getAppModelOptionsForInstance(
        settings,
        candidate,
        candidate.instanceId === selection?.instanceId ? selection.model : null,
      ),
    ]),
  );

  return (
    <SettingsSection id="text-generation" title="Text generation">
      <SettingsRow
        {...searchableSetting("text-generation-model")}
        description="For thread titles. Unless one is chosen, the agent's summary model writes them."
        resetAction={
          chosen ? (
            <SettingResetButton
              label="text generation model"
              onClick={() =>
                updateSettings({
                  textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                })
              }
            />
          ) : null
        }
        control={
          selection === null || entry === undefined ? (
            <span className="text-sm text-muted-foreground">
              No text generation providers available.
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                environmentId={LOCAL_ENVIRONMENT_ID}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onInstanceModelChange={(instanceId, model) =>
                  updateSettings({
                    textGenerationModelSelection: createModelSelection(instanceId, model),
                  })
                }
              />
              <TraitsPicker
                provider={entry.driverKind}
                instanceId={selection.instanceId}
                models={entry.models}
                model={selection.model}
                modelOptions={selection.options}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(nextOptions) =>
                  updateSettings({
                    textGenerationModelSelection: createModelSelection(
                      selection.instanceId,
                      selection.model,
                      nextOptions,
                    ),
                  })
                }
              />
            </div>
          )
        }
      />
      <AdvancedSettings targetIds={[searchableSetting("thread-title-instructions").id]}>
        <ThreadTitleInstructionsSettings />
      </AdvancedSettings>
    </SettingsSection>
  );
}

function ThreadTitleInstructionsSettings() {
  const settings = useScopedSettings();
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      {...searchableSetting("thread-title-instructions")}
      description="Appended to the prompt for new thread titles."
      resetAction={
        settings.threadTitleInstructions !== "" ? (
          <SettingResetButton
            label="thread title instructions"
            onClick={() => updateSettings({ threadTitleInstructions: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={settings.threadTitleInstructions}
          aria-label="Thread title instructions"
          onChange={() => {
            edited.current = true;
          }}
          rows={4}
          defaultValue={settings.threadTitleInstructions}
          placeholder="Keep titles to a few words. Lead with the main subject."
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && value !== settings.threadTitleInstructions)
              updateSettings({ threadTitleInstructions: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
