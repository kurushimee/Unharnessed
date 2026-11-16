import { useState, type ReactNode } from "react";
import type { ModelSpecs, TopLevel } from "../src/protocol";

/** What the agent uses when a count is not set (models.json defaults). */
const DEFAULT_CONTEXT = 128_000;
const DEFAULT_ANSWER = 16_384;

const TOP_LEVELS: TopLevel[] = ["xhigh", "max"];

/**
 * A model's specs, set by hand: what a server does not tell. Counts take
 * `400000`, `400k` or `1m`; empty puts the default back.
 */
export function ModelSpecsEditor({
  specs,
  disabled,
  onChange,
}: {
  specs: ModelSpecs;
  disabled: boolean;
  onChange: (specs: ModelSpecs) => void;
}) {
  const set = (change: Partial<ModelSpecs>) => onChange({ ...specs, ...change });

  const toggleLevel = (level: TopLevel) => {
    const on = specs.topLevels.includes(level);
    set({ topLevels: on ? specs.topLevels.filter((each) => each !== level) : [...specs.topLevels, level] });
  };

  return (
    <div className="model-specs">
      <SpecLine label="Context">
        <TokenField
          label="Context window"
          value={specs.contextWindow}
          fallback={DEFAULT_CONTEXT}
          disabled={disabled}
          onChange={(contextWindow) => set({ contextWindow })}
        />
      </SpecLine>

      <SpecLine label="Longest answer">
        <TokenField
          label="Longest answer"
          value={specs.maxTokens}
          fallback={DEFAULT_ANSWER}
          disabled={disabled}
          onChange={(maxTokens) => set({ maxTokens })}
        />
      </SpecLine>

      <SpecLine label="Reads images">
        <Switch label="Reads images" on={specs.image} disabled={disabled} onChange={(image) => set({ image })} />
      </SpecLine>

      <SpecLine label="Thinks">
        <Switch label="Thinks" on={specs.reasoning} disabled={disabled} onChange={(reasoning) => set({ reasoning })} />
      </SpecLine>

      <SpecLine label="Claude model">
        <input
          className="input is-mono model-spec-text"
          type="text"
          placeholder="none"
          aria-label="Claude model it stands for"
          data-tip="Set it (claude-opus-5-5) to ask the model through the server's Anthropic API, as that Claude model"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={specs.claudeModel ?? ""}
          onChange={(event) => set({ claudeModel: event.target.value.trim() || undefined })}
        />
      </SpecLine>

      {specs.reasoning && (
        <SpecLine label="Above high">
          <div className="choice" role="group" aria-label="Thinking levels above high">
            {TOP_LEVELS.map((level) => (
              <button
                key={level}
                className={specs.topLevels.includes(level) ? "choice-option is-on" : "choice-option"}
                type="button"
                aria-pressed={specs.topLevels.includes(level)}
                disabled={disabled}
                onClick={() => toggleLevel(level)}
              >
                {level}
              </button>
            ))}
          </div>
        </SpecLine>
      )}
    </div>
  );
}

function SpecLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="model-spec">
      <span className="model-spec-label">{label}</span>
      {children}
    </div>
  );
}

function Switch({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      className={on ? "switch is-on" : "switch"}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** A token count, taken when the field is left or on Enter. */
function TokenField({
  label,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  fallback: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (!text.trim()) {
      setInvalid(false);
      onChange(undefined);
      return;
    }

    const count = parseTokens(text);
    setInvalid(count === null);

    if (count !== null) {
      setText(String(count));
      onChange(count);
    }
  };

  return (
    <label className={invalid ? "number-field is-invalid" : "number-field"}>
      <input
        className="input"
        type="text"
        inputMode="numeric"
        aria-label={label}
        placeholder={String(fallback)}
        spellCheck={false}
        disabled={disabled}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span className="number-unit">tokens</span>
    </label>
  );
}

/** `400000`, `400k`, `1.5m` → a whole positive count, else `null`. */
export function parseTokens(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([km])?\s*$/i.exec(text.replace(/[_,\s](?=\d)/g, ""));
  if (!match) return null;

  const scale = { k: 1_000, m: 1_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  const count = Math.round(Number(match[1]) * scale);

  return count > 0 ? count : null;
}
