"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/Field";

interface RenameProps {
  businessId: string;
  initialName: string;
  isOwner: boolean;
  onRenamed?: (newName: string) => void;
}

export function Rename({ businessId, initialName, isOwner, onRenamed }: RenameProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [same, setSame] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent, confirm = false) {
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
      const res = await postJson<{ ok: boolean; name?: string; conflict?: { name: string } }>(
        `/api/business/${businessId}/settings`,
        {
          action: "rename",
          name: name.trim(),
          ...(confirm ? { confirm: true } : {}),
        },
      );
      if (res.conflict) {
        setSame(res.conflict.name);
      } else if (res.ok && res.name) {
        setSame(null);
        setEditing(false);
        onRenamed?.(res.name);
        // the switcher and header read the name from the server; refresh so they stop showing the old one (plan 05zj E, SYM-27)
        router.refresh();
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
    return <p className="font-medium text-ink">{name}</p>;
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="font-medium text-ink">{name}</span>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setName(initialName);
            setEditing(true);
          }}
        >
          Rename
        </Button>
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
          onChange={(e) => { setName(e.target.value); setSame(null); }}
          disabled={busy}
          className={`${controlClass} flex-1`}
          autoFocus
        />
        <Button type="submit" size="sm" busy={busy} disabled={!name.trim()}>{busy ? "Saving…" : "Save"}</Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setName(initialName); setEditing(false); setError(null); }}>Cancel</Button>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-graphite">
        <span>1 to 80 characters</span>
        <span>{name.length}/80</span>
      </div>
      {error && <p className="mt-1 text-xs text-red">{error}</p>}
      {same ? (
        <div className="mt-2 rounded-doc border border-rule p-3 text-sm">
          <p>You already own a business called “{same}”. Two with the same name are easy to mix up in the switcher.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSame(null)}>Choose another name</Button>
            <Button size="sm" busy={busy} onClick={(e) => void handleSubmit(e as unknown as React.FormEvent, true)}>Use this name anyway</Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
