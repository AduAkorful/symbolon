"use client";

import { useState } from "react";
import { postJson } from "@/lib/client/api";

interface RenameProps {
  businessId: string;
  initialName: string;
  isOwner: boolean;
  onRenamed?: (newName: string) => void;
}

export function Rename({ businessId, initialName, isOwner, onRenamed }: RenameProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Business name cannot be empty.");
      return;
    }
    if (name.length > 80) {
      setError("Business name must be 80 characters or fewer.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ ok: boolean; name: string }>(
        `/api/business/${businessId}/settings`,
        {
          action: "rename",
          name: name.trim(),
        },
      );
      if (res.ok) {
        setEditing(false);
        onRenamed?.(res.name);
      } else {
        setError("Failed to rename business.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to rename business.");
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) {
    return <p className="text-xl font-medium">{name}</p>;
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xl font-medium">{name}</span>
        <button
          type="button"
          onClick={() => {
            setName(initialName);
            setEditing(true);
          }}
          className="text-xs text-graphite underline hover:text-ink"
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="rounded-doc border border-rule px-3 py-1.5 text-sm focus:border-ink focus:outline-none flex-1"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-doc bg-ink px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setName(initialName);
            setEditing(false);
            setError(null);
          }}
          disabled={busy}
          className="rounded-doc border border-rule px-3 py-1.5 text-xs hover:border-ink"
        >
          Cancel
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-graphite">
        <span>1 to 80 characters</span>
        <span>{name.length}/80</span>
      </div>
      {error && <p className="mt-1 text-xs text-red">{error}</p>}
    </form>
  );
}
