import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_TAG_LENGTH = 50;

/**
 * Chip-style tag editor. Enter or comma commits the typed tag, Backspace on an
 * empty field removes the last one, and pending text is committed on blur so
 * it isn't lost when the form is submitted. Duplicates are ignored
 * case-insensitively. `suggestions` feed a native datalist for autocomplete.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add a tag…",
  id,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const has = (name: string) => value.some((t) => t.toLowerCase() === name.toLowerCase());

  function commit(raw: string) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
    setDraft("");
    if (name && !has(name)) onChange([...value, name]);
  }

  function remove(name: string) {
    onChange(value.filter((t) => t !== name));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault(); // don't submit the form / type the comma
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  }

  const available = suggestions.filter((s) => !has(s));

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-sm bg-secondary py-0.5 pr-1 pl-2 text-xs font-medium text-secondary-foreground"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(tag);
            }}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        list={listId}
        onChange={(e) => {
          // Picking a datalist option or pasting "a, b" commits immediately.
          const v = e.target.value;
          if (v.includes(",")) {
            const parts = v.split(",");
            const rest = parts.pop() ?? "";
            const added = parts
              .map((p) => p.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH))
              .filter((p, i, arr) => p && !has(p) && arr.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
            if (added.length) onChange([...value, ...added]);
            setDraft(rest);
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
      />
      <datalist id={listId}>
        {available.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
