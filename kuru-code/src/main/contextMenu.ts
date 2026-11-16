// Adapted from T3 Code's desktop electron/ElectronMenu.ts: the native context
// menu the window asks for, its items as T3 Code's interface builds them.
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

export interface ContextMenuItem {
  id: string;
  label: string;
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
  header?: boolean;
  icon?: string;
  separatorBefore?: boolean;
  checked?: boolean;
  children?: readonly ContextMenuItem[];
}

function normalizeContextMenuItems(source: readonly ContextMenuItem[]): ContextMenuItem[] {
  const normalizedItems: ContextMenuItem[] = [];
  for (const sourceItem of source) {
    if (typeof sourceItem.id !== "string" || typeof sourceItem.label !== "string") continue;
    // Native menus cannot display the web fallback's decorative headers.
    if (sourceItem.header === true) continue;
    const normalizedItem: ContextMenuItem = {
      id: sourceItem.id,
      label:
        typeof sourceItem.detail === "string" && sourceItem.detail.length > 0
          ? `${sourceItem.label} (${sourceItem.detail})`
          : sourceItem.label,
      destructive: sourceItem.destructive === true,
      disabled: sourceItem.disabled === true,
      ...(sourceItem.separatorBefore === true ? { separatorBefore: true } : {}),
      ...(typeof sourceItem.checked === "boolean" ? { checked: sourceItem.checked } : {}),
    };
    if (sourceItem.children) {
      const normalizedChildren = normalizeContextMenuItems(sourceItem.children);
      if (normalizedChildren.length === 0) continue;
      normalizedItem.children = normalizedChildren;
    }
    normalizedItems.push(normalizedItem);
  }
  return normalizedItems;
}

function buildTemplate(
  entries: readonly ContextMenuItem[],
  complete: (selectedItemId: string | null) => void,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  let hasInsertedDestructiveSeparator = false;
  let sectionStartedByExplicitSeparator = false;
  const appendSeparator = () => {
    if (template.length === 0 || template.at(-1)?.type === "separator") return;
    template.push({ type: "separator" });
  };
  for (const item of entries) {
    if (item.separatorBefore) {
      appendSeparator();
      sectionStartedByExplicitSeparator = true;
    }
    if (
      item.destructive &&
      !hasInsertedDestructiveSeparator &&
      !sectionStartedByExplicitSeparator &&
      template.length > 0
    ) {
      appendSeparator();
      hasInsertedDestructiveSeparator = true;
    }
    const itemOption: MenuItemConstructorOptions = {
      label: item.label,
      enabled: !item.disabled,
      ...(typeof item.checked === "boolean" ? { type: "checkbox" as const, checked: item.checked } : {}),
    };
    if (item.children && item.children.length > 0) {
      itemOption.submenu = buildTemplate(item.children, complete);
    } else {
      itemOption.click = () => complete(item.id);
    }
    template.push(itemOption);
  }
  return template;
}

/** Shows the menu at `position` (CSS pixels); resolves with the picked item's id, or null. */
export function showContextMenu(
  window: BrowserWindow,
  items: readonly ContextMenuItem[],
  position?: { x: number; y: number },
): Promise<string | null> {
  return new Promise((resolve) => {
    const normalizedItems = normalizeContextMenuItems(items);
    if (normalizedItems.length === 0) {
      resolve(null);
      return;
    }
    let completed = false;
    const complete = (selectedItemId: string | null) => {
      if (completed) return;
      completed = true;
      resolve(selectedItemId);
    };
    const zoom = window.webContents.getZoomFactor();
    const valid =
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      position.x >= 0 &&
      position.y >= 0;
    Menu.buildFromTemplate(buildTemplate(normalizedItems, complete)).popup({
      window,
      ...(valid ? { x: Math.floor(position.x * zoom), y: Math.floor(position.y * zoom) } : {}),
      callback: () => complete(null),
    });
  });
}
