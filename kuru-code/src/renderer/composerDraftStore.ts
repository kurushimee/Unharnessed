// Adapted from T3 Code's composerDraftStore.ts: new threads not yet sent (draft
// threads, by draft id) and each thread's unsent prompt. A kuru code draft
// thread is a new Unharnessed conversation in a project; its first send makes
// it a saved session, the thread it is promoted to.
import { scopedThreadKey } from "~/rt/environment/index";
import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "~/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

export const DraftId = Schema.String.pipe(Schema.brand("DraftId"));
export type DraftId = typeof DraftId.Type;

export type DraftThreadEnvMode = "local" | "worktree";

export interface DraftSessionState {
  threadId: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  createdAt: string;
  branch: string | null;
  worktreePath: string | null;
  envMode: DraftThreadEnvMode;
  /** The saved thread the draft became once sent. */
  promotedTo?: ScopedThreadRef | null;
}
export type DraftThreadState = DraftSessionState;

export interface ProjectDraftSession extends DraftSessionState {
  draftId: DraftId;
}

export interface ComposerImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly previewUrl: string;
  readonly dataUrl?: string;
}

export interface ComposerThreadDraftState {
  prompt: string;
  images: ComposerImageAttachment[];
  files: ReadonlyArray<never>;
  persistedAttachments: ReadonlyArray<never>;
  terminalContexts: ReadonlyArray<never>;
  previewAnnotations: ReadonlyArray<never>;
  reviewComments: ReadonlyArray<never>;
  threadContexts: ReadonlyArray<never>;
  environmentContexts: ReadonlyArray<never>;
}

export const EMPTY_THREAD_DRAFT: ComposerThreadDraftState = {
  prompt: "",
  images: [],
  files: [],
  persistedAttachments: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  threadContexts: [],
  environmentContexts: [],
};

export function composerDraftHasUserContent(
  draft: ComposerThreadDraftState | null | undefined,
): boolean {
  if (!draft) {
    return false;
  }
  return draft.prompt.trim().length > 0 || draft.images.length > 0;
}

/** A thread's drafts are keyed by its scoped key; a draft thread's by its draft id. */
export type ComposerThreadTarget = ScopedThreadRef | DraftId;

function targetKey(target: ComposerThreadTarget): string {
  return typeof target === "string" ? target : scopedThreadKey(target);
}

interface ComposerDraftStoreState {
  draftsByThreadKey: Record<string, ComposerThreadDraftState>;
  draftThreadsByThreadKey: Record<string, DraftSessionState>;
  projectDraftThreadKeyByProjectKey: Record<string, string>;
  getComposerDraft: (target: ComposerThreadTarget) => ComposerThreadDraftState | null;
  getDraftSession: (draftId: DraftId) => DraftSessionState | null;
  getDraftSessionByProjectRef: (projectRef: ScopedProjectRef) => ProjectDraftSession | null;
  getDraftSessionByRef: (threadRef: ScopedThreadRef) => DraftSessionState | null;
  setProjectDraftThreadId: (projectRef: ScopedProjectRef, draftId: DraftId, session: DraftSessionState) => void;
  markDraftThreadPromoting: (draftId: DraftId, promotedTo: ScopedThreadRef) => void;
  clearDraftThread: (draftId: DraftId) => void;
  setPrompt: (target: ComposerThreadTarget, prompt: string) => void;
  setImages: (target: ComposerThreadTarget, images: ComposerImageAttachment[]) => void;
  clearComposerDraft: (target: ComposerThreadTarget) => void;
}

const projectKey = (ref: ScopedProjectRef) => `${ref.environmentId}:${ref.projectId}`;

export const useComposerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      projectDraftThreadKeyByProjectKey: {},
      getComposerDraft: (target) => get().draftsByThreadKey[targetKey(target)] ?? null,
      getDraftSession: (draftId) => get().draftThreadsByThreadKey[draftId] ?? null,
      getDraftSessionByProjectRef: (projectRef) => {
        const draftId = get().projectDraftThreadKeyByProjectKey[projectKey(projectRef)];
        const session = draftId ? get().draftThreadsByThreadKey[draftId] : undefined;
        return draftId && session && !session.promotedTo
          ? { ...session, draftId: DraftId.make(draftId) }
          : null;
      },
      getDraftSessionByRef: (threadRef) =>
        Object.values(get().draftThreadsByThreadKey).find(
          (session) =>
            session.environmentId === threadRef.environmentId &&
            session.threadId === threadRef.threadId,
        ) ?? null,
      setProjectDraftThreadId: (projectRef, draftId, session) =>
        set((state) => ({
          draftThreadsByThreadKey: { ...state.draftThreadsByThreadKey, [draftId]: session },
          projectDraftThreadKeyByProjectKey: {
            ...state.projectDraftThreadKeyByProjectKey,
            [projectKey(projectRef)]: draftId,
          },
        })),
      markDraftThreadPromoting: (draftId, promotedTo) =>
        set((state) => {
          const session = state.draftThreadsByThreadKey[draftId];
          if (!session) return state;
          return {
            draftThreadsByThreadKey: {
              ...state.draftThreadsByThreadKey,
              [draftId]: { ...session, promotedTo },
            },
          };
        }),
      clearDraftThread: (draftId) =>
        set((state) => {
          const { [draftId]: _removed, ...draftThreadsByThreadKey } = state.draftThreadsByThreadKey;
          const { [draftId]: _draft, ...draftsByThreadKey } = state.draftsByThreadKey;
          return {
            draftThreadsByThreadKey,
            draftsByThreadKey,
            projectDraftThreadKeyByProjectKey: Object.fromEntries(
              Object.entries(state.projectDraftThreadKeyByProjectKey).filter(
                ([, key]) => key !== draftId,
              ),
            ),
          };
        }),
      setPrompt: (target, prompt) =>
        set((state) => {
          const key = targetKey(target);
          const draft = state.draftsByThreadKey[key] ?? EMPTY_THREAD_DRAFT;
          return { draftsByThreadKey: { ...state.draftsByThreadKey, [key]: { ...draft, prompt } } };
        }),
      setImages: (target, images) =>
        set((state) => {
          const key = targetKey(target);
          const draft = state.draftsByThreadKey[key] ?? EMPTY_THREAD_DRAFT;
          return { draftsByThreadKey: { ...state.draftsByThreadKey, [key]: { ...draft, images } } };
        }),
      clearComposerDraft: (target) =>
        set((state) => {
          const { [targetKey(target)]: _removed, ...draftsByThreadKey } = state.draftsByThreadKey;
          return { draftsByThreadKey };
        }),
    }),
    {
      name: "kuru:composer-drafts:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Images hold data URLs; prompts are what is worth keeping across a restart.
        draftsByThreadKey: Object.fromEntries(
          Object.entries(state.draftsByThreadKey).map(([key, draft]) => [key, { ...draft, images: [] }]),
        ),
        draftThreadsByThreadKey: state.draftThreadsByThreadKey,
        projectDraftThreadKeyByProjectKey: state.projectDraftThreadKeyByProjectKey,
      }),
    },
  ),
);

export function getComposerDraftState(
  state: Pick<ComposerDraftStoreState, "draftsByThreadKey">,
  target: ComposerThreadTarget,
): ComposerThreadDraftState | null {
  return state.draftsByThreadKey[targetKey(target)] ?? null;
}

export function useComposerThreadDraft(target: ComposerThreadTarget): ComposerThreadDraftState {
  return useComposerDraftStore(
    (state) => getComposerDraftState(state, target) ?? EMPTY_THREAD_DRAFT,
  );
}

export function useThreadHasUnsentDraft(threadRef: ScopedThreadRef): boolean {
  return useComposerDraftStore((state) =>
    composerDraftHasUserContent(getComposerDraftState(state, threadRef)),
  );
}

/** Threads a sent draft is launching into: from their shell's arrival until the server owns the send. */
export function usePromotingDraftThreadKeys(): ReadonlyArray<string> {
  return useComposerDraftStore(
    useShallow((state) =>
      Object.values(state.draftThreadsByThreadKey).flatMap((draft) =>
        draft.promotedTo ? [scopedThreadKey(draft.promotedTo)] : [],
      ),
    ),
  );
}
