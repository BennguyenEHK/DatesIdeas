"use client";

import { useState, type ReactElement } from "react";
import { bedrockJoinUrl, formatAddress, parseServerAddress } from "@/lib/gameword/minecraft";

const STORAGE_KEY = "gameword-minecraft-address";

function savedAddress(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function MinecraftLauncher(): ReactElement {
  const [rawAddress, setRawAddress] = useState(savedAddress);
  const [message, setMessage] = useState("");
  const address = parseServerAddress(rawAddress);
  const displayAddress = address ? formatAddress(address.host, address.port) : "";
  const updateAddress = (value: string) => {
    setRawAddress(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // A blocked storage area should not stop somebody joining their friend.
    }
  };
  const copy = async () => {
    if (!displayAddress) return;
    try {
      await navigator.clipboard.writeText(displayAddress);
      setMessage("Address copied.");
    } catch {
      setMessage("Copy was unavailable. Select and copy the address yourself.");
    }
  };
  return (
    <section
      className="border border-[var(--lamp)] bg-[var(--dusk)] p-5 sm:p-6"
      aria-label="Minecraft launcher"
    >
      <h2 className="font-[family-name:var(--font-display)] text-3xl text-[var(--dress)]">
        Minecraft together
      </h2>
      <p className="mt-3 text-[var(--cream)]">
        This Minecraft server is not part of FestiBooth. It runs on a computer one of you hosts;
        this panel only helps you both get to it.
      </p>
      <label className="mt-5 block text-sm text-[var(--mist)]" htmlFor="minecraft-address">
        Server address
      </label>
      <input
        id="minecraft-address"
        value={rawAddress}
        onChange={(event) => updateAddress(event.target.value)}
        placeholder="play.example.com:25565"
        className="mt-1 w-full border border-[var(--edge)] bg-[var(--night)] px-3 py-2 text-[var(--cream)]"
      />
      {rawAddress && !address ? (
        <p className="mt-2 text-sm text-[var(--neon)]">
          Use a hostname or IPv4 address, with an optional port.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!address}
          onClick={copy}
          className="border border-[var(--lamp)] px-4 py-2 text-[var(--cream)] disabled:border-[var(--edge)] disabled:text-[var(--mist)]"
        >
          Copy address
        </button>
        {address ? (
          <a
            href={bedrockJoinUrl("GameWord server", address.host, address.port)}
            className="bg-[var(--lamp)] px-4 py-2 text-[var(--night)]"
          >
            Open in Minecraft (Bedrock)
          </a>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="mt-2 text-sm text-[var(--mist)]">
          {message}
        </p>
      ) : null}
      <p className="mt-5 text-sm text-[var(--mist)]">
        Java Edition: Multiplayer, then Direct connection, then paste the address.
      </p>
    </section>
  );
}
