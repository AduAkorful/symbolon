"use client";

import { useState, type ReactNode } from "react";
import { Act } from "@/components/Act";
import { useNotify, type Channel } from "@/components/notify";
import { QR } from "@/components/QR";

/**
 * Where a person enters the details for each way of being reached: email addresses (each confirmed with a code), Slack (a
 * workspace, a channel, and their own Slack account), Telegram (a link and a code) and push (this device). Nothing
 * is sent to a channel until it's set up here, and an approval is still signed on the person's own device.
 */
const btn = "rounded-doc border border-rule px-3.5 py-2 text-sm hover:border-ink";
const primary = "rounded-doc bg-ink px-3.5 py-2 text-sm font-medium text-paper disabled:opacity-40";
const field = "mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";

function Card({ id, name, status, on, children }: { id: string; name: string; status: string; on: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 rounded-doc border border-rule bg-paper-raised p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${id}-h`} className="font-display text-2xl">
          {name}
        </h3>
        <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${on ? "text-seal" : "text-graphite"}`}>{on ? "✓ " : ""}{status}</span>
      </div>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function EmailCard() {
  const { emails, addEmail, removeEmail } = useNotify();
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  return (
    <Card id="channel-email" name="Email" status={`${emails.length} confirmed`} on>
      <ul className="border-t border-rule">
        {emails.map((e) => (
          <li key={e.address} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft py-2.5">
            <span>
              <span className="font-mono">{e.address}</span>
              <span className="block text-xs text-graphite">Confirmed · used for {e.usedFor}</span>
            </span>
            {e.usedFor === "Extra address" ? (
              <Act
                className="text-xs text-red underline decoration-red/40 underline-offset-4"
                confirm={{ title: `Remove ${e.address}`, body: "Messages stop going there. Your other addresses aren’t affected.", action: "Remove" }}
                done="Removed."
                onDone={() => removeEmail(e.address)}
              >
                Remove
              </Act>
            ) : null}
          </li>
        ))}
      </ul>
      {step === "idle" ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            setStep("code");
          }}
        >
          <label className="min-w-[14rem] flex-1 text-xs text-graphite">
            Add an address
            <input required type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="you@example.com" className={field} />
          </label>
          <button className={btn}>Send a code</button>
        </form>
      ) : (
        <form
          className="mt-3 space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (code.replace(/\D/g, "") === "482913") {
              addEmail(address.trim());
              setAddress("");
              setCode("");
              setWrong(false);
              setStep("idle");
            } else setWrong(true);
          }}
        >
          <label className="block text-xs text-graphite">
            The 6-digit code we sent to {address}
            <input required inputMode="numeric" value={code} onChange={(e) => { setCode(e.target.value); setWrong(false); }} placeholder="000000" className={`${field} font-mono tracking-[0.2em]`} />
          </label>
          <p className="text-xs text-graphite">Demo: the code is 482 913.</p>
          {wrong ? (
            <p role="alert" className="text-xs text-red">
              That code doesn’t match. Check the email and try again.
            </p>
          ) : null}
          <div className="flex gap-2">
            <button className={primary}>Confirm</button>
            <button type="button" onClick={() => setStep("idle")} className={btn}>
              Back
            </button>
          </div>
        </form>
      )}
      <p className="mt-3 text-xs text-graphite">An address only receives messages once you’ve confirmed it. Approvals sent by email link to your own device to sign.</p>
    </Card>
  );
}

function SlackCard() {
  const { connected, setConnected, detail, setDetail } = useNotify();
  const [step, setStep] = useState<"idle" | "workspace" | "channel">("idle");
  const [channel, setChannel] = useState("#payables");
  const on = connected.Slack;
  return (
    <Card id="channel-slack" name="Slack" status={on ? "Connected" : "Not set up"} on={on}>
      {on ? (
        <>
          <p>{detail.Slack}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Act className={btn} done={`Sent a test message to ${channel}.`}>
              Send a test message
            </Act>
            <Act
              className={`${btn} text-red`}
              confirm={{ title: "Disconnect Slack", body: "Approvals and news stop going to Slack. Your choices below are kept, in case you connect it again.", action: "Disconnect" }}
              done="Disconnected."
              onDone={() => setConnected("Slack", false)}
            >
              Disconnect
            </Act>
          </div>
        </>
      ) : step === "idle" ? (
        <>
          <p className="text-graphite">Approvals and news appear in a channel you choose, with buttons. Symbolon can post there and see who clicks; it can’t read your messages.</p>
          <button onClick={() => setStep("workspace")} className={`mt-3 ${primary}`}>
            Connect Slack
          </button>
        </>
      ) : step === "workspace" ? (
        <>
          <p className="font-medium">Choose the workspace</p>
          <button onClick={() => setStep("channel")} className="mt-2 block w-full rounded-doc border border-rule px-4 py-3 text-left hover:border-ink">
            <span className="font-medium">Acme</span>
            <span className="block text-xs text-graphite">acme.slack.com · you’re a member</span>
          </button>
          <button onClick={() => setStep("idle")} className={`mt-3 ${btn}`}>
            Back
          </button>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setDetail("Slack", `Acme workspace · ${channel} · linked as @owner`);
            setConnected("Slack", true);
            setStep("idle");
          }}
        >
          <label className="block text-xs text-graphite">
            Post into
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={field}>
              {["#payables", "#finance-ops", "#general"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-graphite">You’ll also link your own Slack account, so an approval clicked there is recognised as you.</p>
          <div className="flex gap-2">
            <button className={primary}>Link my Slack account</button>
            <button type="button" onClick={() => setStep("workspace")} className={btn}>
              Back
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function TelegramCard() {
  const { connected, setConnected, detail, setDetail } = useNotify();
  const [linking, setLinking] = useState(false);
  const on = connected.Telegram;
  return (
    <Card id="channel-telegram" name="Telegram" status={on ? "Connected" : "Not set up"} on={on}>
      {on ? (
        <>
          <p>{detail.Telegram}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Act className={btn} done="Sent a test message to your Telegram.">
              Send a test message
            </Act>
            <Act className={`${btn} text-red`} confirm={{ title: "Disconnect Telegram", body: "Messages stop going to Telegram. Your choices below are kept.", action: "Disconnect" }} done="Disconnected." onDone={() => setConnected("Telegram", false)}>
              Disconnect
            </Act>
          </div>
        </>
      ) : linking ? (
        <div className="flex flex-wrap items-start gap-5">
          <QR seed="7a4e91c0d3b2" className="h-28 w-28 rounded-sm bg-paper p-2" />
          <div className="min-w-[14rem] flex-1">
            <p className="font-medium">Link your Telegram</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-graphite">
              <li>Scan this with your phone, or open the link it holds.</li>
              <li>Press Start in the chat with Symbolon.</li>
              <li>
                It checks the one-time code <span className="font-mono text-ink">7Q4M-92</span> and links this chat to you.
              </li>
            </ol>
            <p className="mt-2 text-xs text-graphite">Demo: the picture isn’t scannable.</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setDetail("Telegram", "Linked to @owner_acme");
                  setConnected("Telegram", true);
                  setLinking(false);
                }}
                className={primary}
              >
                I’ve pressed Start (demo)
              </button>
              <button onClick={() => setLinking(false)} className={btn}>
                Back
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="text-graphite">Get approvals and news in a chat with Symbolon. You link it once with a code, so only your account can receive them.</p>
          <button onClick={() => setLinking(true)} className={`mt-3 ${primary}`}>
            Connect Telegram
          </button>
        </>
      )}
    </Card>
  );
}

function PushCard() {
  const { connected, setConnected, detail, setDetail } = useNotify();
  const [asking, setAsking] = useState(false);
  const on = connected.Push;
  return (
    <Card id="channel-push" name="Push" status={on ? "Connected" : "Not set up"} on={on}>
      {on ? (
        <>
          <ul className="border-t border-rule">
            <li className="flex justify-between gap-3 border-b border-rule-soft py-2.5">
              <span>{detail.Push}</span>
              <Act className="text-xs text-red underline decoration-red/40 underline-offset-4" confirm={{ title: "Turn off push on this device", body: "This device stops getting push messages.", action: "Turn off" }} done="Turned off." onDone={() => setConnected("Push", false)}>
                Turn off
              </Act>
            </li>
          </ul>
          <div className="mt-3">
            <Act className={btn} done="Sent a test push to this device.">
              Send a test push
            </Act>
          </div>
        </>
      ) : asking ? (
        <div className="rounded-doc border border-rule bg-paper p-4">
          <p className="font-medium">localhost:3100 wants to send you notifications</p>
          <p className="mt-1 text-xs text-graphite">This is your browser’s own question, shown here as it will look.</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                setDetail("Push", "This browser · added just now");
                setConnected("Push", true);
                setAsking(false);
              }}
              className={primary}
            >
              Allow
            </button>
            <button onClick={() => setAsking(false)} className={btn}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-graphite">A message on this device the moment something needs you. Add each phone or browser you want it on.</p>
          <button onClick={() => setAsking(true)} className={`mt-3 ${primary}`}>
            Turn on for this device
          </button>
        </>
      )}
    </Card>
  );
}

export function ChannelSetup({ channels }: { channels?: Channel[] }) {
  const show = (c: Channel) => !channels || channels.includes(c);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {show("Email") ? <EmailCard /> : null}
      {show("Slack") ? <SlackCard /> : null}
      {show("Telegram") ? <TelegramCard /> : null}
      {show("Push") ? <PushCard /> : null}
    </div>
  );
}
