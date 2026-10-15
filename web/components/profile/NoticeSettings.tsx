"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { SectionTitle } from "@/components/ui/Type";
import type { NoticeSettingsView } from "@/lib/server/notice-settings";

type Channel = "telegram" | "push";

function keyBytes(base64Url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** A short, honest name for this device so the list of devices means something */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os}, ${browser}`;
}

/** Notices outside the app (plan 05zr): connect a channel, then choose which notices it carries. The bell always has every notice. */
export function NoticeSettings() {
  const [view, setView] = useState<NoticeSettingsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingForLink, setWaitingForLink] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/profile/notices", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setView((await res.json()) as NoticeSettingsView);
      setProblem(null);
    } catch {
      setProblem("Couldn't load your notification settings.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  // after the person taps the link in Telegram, the page notices the connection when they come back to it
  useEffect(() => {
    if (!waitingForLink) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [waitingForLink]);
  useEffect(() => {
    if (view?.telegram.linked) setWaitingForLink(false);
  }, [view?.telegram.linked]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      return await postJson<Record<string, unknown>>("/api/profile/notices", body);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const out = await act({ action: "telegram-connect" });
    if (out && typeof out.url === "string") {
      setWaitingForLink(true);
      window.open(out.url, "_blank", "noopener");
    }
  }

  async function set(channel: Channel, value: boolean, kind?: string) {
    const out = await act({ action: "set", channel, value, ...(kind ? { kind } : {}) });
    if (out) setView(out as unknown as NoticeSettingsView);
  }

  async function enablePush() {
    if (!view?.push.publicKey) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      setProblem(ios ? "On iPhone, add Symbolon to your Home Screen first (Share, then Add to Home Screen), then open it from there." : "This browser can't receive push notifications.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      // asked only here, from the person's own click
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setProblem("Notifications are blocked for this site in your browser. Allow them in the site settings, then try again.");
        return;
      }
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(view.push.publicKey) as BufferSource });
      const out = await postJson<NoticeSettingsView>("/api/profile/notices", { action: "push-subscribe", subscription: subscription.toJSON(), label: deviceLabel() });
      setView(out);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(id: string) {
    const out = await act({ action: "push-remove", id });
    if (out) setView(out as unknown as NoticeSettingsView);
  }

  const groups = view ? [...new Set(view.kinds.map((k) => k.group))] : [];

  return (
    <section aria-labelledby="notices-heading" className="space-y-4">
      <div>
        <SectionTitle id="notices-heading">Notifications outside the app</SectionTitle>
        <p className="mt-1 max-w-[64ch] text-sm text-graphite">
          The bell always shows every notice. Here you can also get chosen ones on your phone. Messages only link back to Symbolon; nothing
          can be done from them.
        </p>
      </div>
      {problem ? <InlineError>{problem}</InlineError> : null}
      {view === null ? (
        <p className="text-sm text-graphite">Loading…</p>
      ) : !view.telegram.available && !view.push.available ? (
        <Callout tone="neutral" title="Not switched on yet">Notices outside the app aren’t switched on for this deployment.</Callout>
      ) : (
        <>
        {view.telegram.available ? (
        <div className="rounded-doc border border-rule px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-medium text-ink">Telegram</span>
              <StatusPill tone={view.telegram.linked ? "ok" : "neutral"}>{view.telegram.linked ? "Connected" : waitingForLink ? "Waiting for Telegram…" : "Not connected"}</StatusPill>
            </div>
            {view.telegram.linked ? (
              <Button variant="secondary" size="sm" busy={busy} onClick={() => void act({ action: "telegram-disconnect" }).then((o) => o && setView(o as unknown as NoticeSettingsView))}>
                Disconnect
              </Button>
            ) : (
              <Button size="sm" busy={busy} onClick={() => void connect()}>Connect Telegram</Button>
            )}
          </div>
          {!view.telegram.linked ? (
            <p className="mt-3 text-sm text-graphite">
              This opens Telegram with our bot. Press Start there and this page updates. The link works once and expires in 10 minutes.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={view.telegram.master} disabled={busy} onChange={(e) => void set("telegram", e.target.checked)} />
                <span className="font-medium text-ink">Send me notices on Telegram</span>
              </label>
              {groups.map((group) => (
                <fieldset key={group} disabled={busy || !view.telegram.master} className="space-y-2">
                  <legend className="text-xs font-medium uppercase tracking-wide text-graphite">{group}</legend>
                  {view.kinds
                    .filter((k) => k.group === group)
                    .map((k) => (
                      <label key={k.kind} className="flex items-center gap-3 text-sm text-ink">
                        <input type="checkbox" checked={view.telegram.enabled[k.kind] === true} onChange={(e) => void set("telegram", e.target.checked, k.kind)} />
                        {k.label}
                      </label>
                    ))}
                </fieldset>
              ))}
            </div>
          )}
        </div>
        ) : null}
        {view.push.available ? (
          <div className="rounded-doc border border-rule px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-medium text-ink">Browser or phone app notifications</span>
                <StatusPill tone={view.push.devices.length ? "ok" : "neutral"}>
                  {view.push.devices.length ? `${view.push.devices.length} device${view.push.devices.length === 1 ? "" : "s"}` : "Not turned on"}
                </StatusPill>
              </div>
              <Button size="sm" variant={view.push.devices.length ? "secondary" : "primary"} busy={busy} onClick={() => void enablePush()}>
                Turn on for this device
              </Button>
            </div>
            <p className="mt-3 text-sm text-graphite">Your browser asks for permission once. On iPhone, add Symbolon to your Home Screen first.</p>
            {view.push.devices.length ? (
              <ul className="mt-4 divide-y divide-rule-soft text-sm">
                {view.push.devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-ink">{d.label ?? "A device"}</span>
                    <Button variant="quiet" size="sm" disabled={busy} onClick={() => void removeDevice(d.id)}>Remove</Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {view.push.devices.length ? (
              <div className="mt-5 space-y-5">
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={view.push.master} disabled={busy} onChange={(e) => void set("push", e.target.checked)} />
                  <span className="font-medium text-ink">Send me notices on my devices</span>
                </label>
                {groups.map((group) => (
                  <fieldset key={group} disabled={busy || !view.push.master} className="space-y-2">
                    <legend className="text-xs font-medium uppercase tracking-wide text-graphite">{group}</legend>
                    {view.kinds
                      .filter((k) => k.group === group)
                      .map((k) => (
                        <label key={k.kind} className="flex items-center gap-3 text-sm text-ink">
                          <input type="checkbox" checked={view.push.enabled[k.kind] === true} onChange={(e) => void set("push", e.target.checked, k.kind)} />
                          {k.label}
                        </label>
                      ))}
                  </fieldset>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        </>
      )}
    </section>
  );
}
