import { scopeProjectRef } from "~/rt/environment/index";
import type { EnvironmentId, ProjectId, ThreadId } from "~/contracts";
import { type Ref, type ReactNode, memo, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { type DraftId } from "../composerDraftStore";
import { useProject } from "../state/entities";
import { resolveContextStripLabelsCompact } from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector, type BranchToolbarBranchSelectorHandle } from "./BranchToolbarBranchSelector";
import { ComposerSurface } from "./chat/ComposerSurface";
import { cn } from "~/lib/utils";
import { observeResize } from "~/lib/observeResize";

export interface BranchToolbarHandle {
  openBranchPicker: () => void;
}

interface BranchToolbarProps {
  layout?: "composer" | "panel";
  ref?: Ref<BranchToolbarHandle>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  showGitControls: boolean;
  draftId?: DraftId;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  /** Shown at the end of the composer strip. */
  trailing?: ReactNode;
}

const COMPOSER_CONTEXT_MOTION_DURATION_MS = 180;
const COMPOSER_CONTEXT_MOTION_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const COMPOSER_CONTEXT_LABEL_SELECTOR = "[data-composer-label]";

/** A hidden or squeezed label's scrollWidth loses its tail, causing label/icon flapping. */
function labelTextWidth(label: HTMLElement, range: Range): number {
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let width = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    width += range.getBoundingClientRect().width;
  }
  const motion = label.querySelector<HTMLElement>("[data-composer-label-motion]");
  const maxWidth = motion ? Number.parseFloat(getComputedStyle(motion).maxWidth) : Number.NaN;
  return Number.isFinite(maxWidth) ? Math.min(width, maxWidth) : width;
}

function animateLabelWidths(
  previousRects: ReadonlyMap<HTMLElement, DOMRect>,
  animations: Map<HTMLElement, Animation>,
) {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const [label, previousRect] of previousRects) {
    if (!label.isConnected) continue;
    const nextWidth = label.getBoundingClientRect().width;
    if (Math.abs(previousRect.width - nextWidth) < 0.5) continue;

    const animation = label.animate(
      [
        { width: `${previousRect.width}px`, maxWidth: `${previousRect.width}px` },
        { width: `${nextWidth}px`, maxWidth: `${nextWidth}px` },
      ],
      {
        duration: COMPOSER_CONTEXT_MOTION_DURATION_MS,
        easing: COMPOSER_CONTEXT_MOTION_EASING,
        fill: "backwards",
      },
    );
    animations.set(label, animation);
    animation.addEventListener(
      "finish",
      () => {
        if (animations.get(label) === animation) animations.delete(label);
      },
      { once: true },
    );
  }
}

/**
 * Whether the strip's labels must collapse to icons. The strip is measured when
 * it, a control group or a hosted control resizes, when its text or children
 * change, and when fonts load, which covers everything the widths depend on.
 */
function useLabelsOverflow(): readonly [
  attach: (element: HTMLDivElement | null) => (() => void) | undefined,
  overflows: boolean,
] {
  const [overflows, setOverflows] = useState(false);

  const attach = (current: HTMLDivElement | null) => {
    if (!current) return;
    const labelAnimations = new Map<HTMLElement, Animation>();

    const measure = () => {
      // The committed attribute, not render state, so a stale closure cannot misread it.
      const compact = current.hasAttribute("data-compact");
      const stripWidth = current.clientWidth;
      if (stripWidth === 0) return;
      const stripStyle = getComputedStyle(current);
      const available =
        stripWidth -
        (Number.parseFloat(stripStyle.paddingInlineStart) || 0) -
        (Number.parseFloat(stripStyle.paddingInlineEnd) || 0);
      const contentWidth = (parent: Element): number => {
        const gap = Number.parseFloat(getComputedStyle(parent).columnGap) || 0;
        let width = 0;
        let counted = 0;
        for (const child of parent.children) {
          if (!(child instanceof HTMLElement)) continue;
          if (child.offsetWidth === 0) continue;
          const style = getComputedStyle(child);
          const position = style.position;
          if (position === "absolute" || position === "fixed") continue;
          width +=
            child.offsetWidth +
            (Number.parseFloat(style.marginInlineStart) || 0) +
            (Number.parseFloat(style.marginInlineEnd) || 0);
          counted += 1;
        }
        return width + gap * Math.max(0, counted - 1);
      };
      const stripGap = Number.parseFloat(stripStyle.columnGap) || 0;
      let needed = 0;
      let groups = 0;
      for (const child of current.children) {
        if (!(child instanceof HTMLElement)) continue;
        const width = contentWidth(child);
        if (width <= 1) continue;
        groups += 1;
        needed += width;
      }
      needed += stripGap * Math.max(0, groups - 1);
      const range = document.createRange();
      for (const label of current.querySelectorAll<HTMLElement>("[data-composer-label]")) {
        needed += Math.max(0, labelTextWidth(label, range) - label.getBoundingClientRect().width);
      }
      const nextOverflows = resolveContextStripLabelsCompact({
        compact,
        neededWidth: needed,
        availableWidth: available,
      });
      if (nextOverflows === compact) return;
      const previousRects = new Map(
        Array.from(current.querySelectorAll<HTMLElement>(COMPOSER_CONTEXT_LABEL_SELECTOR)).map(
          (label) => [label, label.getBoundingClientRect()] as const,
        ),
      );
      flushSync(() => setOverflows(nextOverflows));
      animateLabelWidths(previousRects, labelAnimations);
    };

    let stopResize = () => {};
    const observeSizes = () => {
      stopResize();
      stopResize = observeResize(
        [
          current,
          ...Array.from(current.children),
          ...Array.from(current.querySelectorAll(COMPOSER_CONTEXT_LABEL_SELECTOR)),
        ],
        measure,
      );
    };
    observeSizes();
    // Text and control changes alter natural widths without resizing a hidden
    // or squeezed label, so they re-measure too. Only added or removed elements
    // can change the observed set; re-subscribing delivers a measure itself.
    const mutations = new MutationObserver((records) => {
      const elementsChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element),
      );
      if (elementsChanged) observeSizes();
      else measure();
    });
    mutations.observe(current, { childList: true, characterData: true, subtree: true });
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      stopResize();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
      for (const animation of labelAnimations.values()) animation.cancel();
    };
  };

  return [attach, overflows] as const;
}

export const BranchToolbar = memo(function BranchToolbar({
  layout = "composer",
  ref,
  environmentId,
  threadId,
  projectId,
  showGitControls,
  draftId,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  trailing,
}: BranchToolbarProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  // The composer retains resolved thread details while bootstrap cleanup can remove its shell.
  const activeProject = useProject(scopeProjectRef(environmentId, projectId));

  useImperativeHandle(
    ref,
    () => ({
      openBranchPicker: () => branchSelectorRef.current?.open(),
    }),
    [],
  );

  const [attachStrip, labelsOverflow] = useLabelsOverflow();

  if (!activeProject) return null;

  if (layout === "panel") {
    return (
      <div className="flex w-full flex-col" data-thread-panel-run-context>
        <BranchToolbarBranchSelector
          displayMode="panel"
          className="w-full"
          environmentId={environmentId}
          threadId={threadId}
          {...(draftId ? { draftId } : {})}
          {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
          {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      </div>
    );
  }

  return (
    <ComposerSurface.ContextStrip
      ref={attachStrip}
      data-compact={labelsOverflow ? "" : undefined}
      className={cn("gap-1 text-xs font-normal text-foreground/70 dark:text-muted-foreground")}
    >
      {showGitControls ? (
        <BranchToolbarBranchSelector
          ref={branchSelectorRef}
          className="ml-auto min-w-0 flex-initial justify-end"
          environmentId={environmentId}
          threadId={threadId}
          {...(draftId ? { draftId } : {})}
          {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
          {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      ) : null}
      {trailing}
    </ComposerSurface.ContextStrip>
  );
});
