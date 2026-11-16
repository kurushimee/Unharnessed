// kuru code: T3 Code's voice input transcribes through its environments' speech models; Unharnessed has none, so voice input is never available.
export type VoiceInputPhase = "idle" | "preparing" | "recording" | "transcribing";

const NOOP = () => undefined;
const NOOP_ASYNC = async () => undefined;

export function useEnvironmentSpeechInput(_input: { readonly [key: string]: unknown }) {
  return {
    available: false,
    status: null as { readonly supported?: boolean; readonly modelId?: string } | null,
    transcriptionEnvironmentId: null,
    transcriptionEnvironmentLabel: null as string | null,
    setup: {
      open: false,
      step: "intro" as const,
      model: null,
      language: null,
      downloading: false,
      error: null as string | null,
      catalogFailed: false,
      setOpen: (_open: boolean) => undefined,
      retryCatalog: null as (() => void) | null,
      download: NOOP_ASYNC,
      cancelDownload: NOOP_ASYNC,
      startRecording: NOOP_ASYNC,
    },
    state: { phase: "idle" as VoiceInputPhase },
    preview: null as { readonly committed: string; readonly tentative: string } | null,
    level: 0,
    preparing: false,
    blocksSubmission: false,
    freezesEditor: false,
    start: NOOP_ASYNC,
    submitAfterDictation: (submit: () => void) => submit(),
    stop: NOOP_ASYNC,
    cancel: NOOP,
    skipPostProcessing: NOOP,
  };
}
