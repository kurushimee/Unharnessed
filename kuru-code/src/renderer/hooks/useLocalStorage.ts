import { useSyncExternalStore } from "react";

const CHANGE = "kuru:local_storage_change";

export function readLocalStorageValue<T>(key: string, initialValue: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? initialValue : (JSON.parse(raw) as T);
  } catch {
    return initialValue;
  }
}

export function writeLocalStorageValue<T>(key: string, value: T | ((val: T) => T), initialValue: T): void {
  const next = typeof value === "function" ? (value as (val: T) => T)(readLocalStorageValue(key, initialValue)) : value;
  if (next === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHANGE, { detail: { key } }));
}

export function subscribeLocalStorageKey(key: string, onChange: () => void): () => void {
  const local = (event: Event) => {
    if ((event as CustomEvent<{ key: string }>).detail.key === key) onChange();
  };
  window.addEventListener(CHANGE, local);
  return () => window.removeEventListener(CHANGE, local);
}

/** A JSON value in localStorage; the schema argument T3 Code passes is ignored. */
export function useLocalStorage<T>(key: string, initialValue: T, _schema?: unknown): [T, (value: T | ((val: T) => T)) => void] {
  const raw = useSyncExternalStore(
    (onChange) => subscribeLocalStorageKey(key, onChange),
    () => window.localStorage.getItem(key),
  );
  let value = initialValue;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = initialValue;
    }
  }
  return [value, (next) => writeLocalStorageValue(key, next, initialValue)];
}

export function getLocalStorageItem<T>(key: string, _schema?: unknown): T | null {
  return readLocalStorageValue<T | null>(key, null);
}

export function setLocalStorageItem<T>(key: string, value: T, _schema?: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}
