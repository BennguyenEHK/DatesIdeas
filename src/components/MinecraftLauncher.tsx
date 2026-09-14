"use client";

import { useState, type ReactElement } from "react";
import { bedrockJoinUrl, formatAddress, parseServerAddress } from "@/lib/gameword/minecraft";
import styles from "./GameWord.module.css";

const STORAGE_KEY = "gameword-minecraft-address";

function savedAddress(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function MinecraftLauncher({ onBack }: { onBack?: () => void } = {}): ReactElement {
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
    <section className={styles.arcade} aria-label="Minecraft launcher">
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Minecraft</h2>
          {/* The launcher replaces the game menu entirely, so without this the
              only way back to the games was to close the whole activity. */}
          {onBack ? (
            <button type="button" className={styles.back} onClick={onBack}>
              Back to games
            </button>
          ) : null}
        </div>
        <p className={styles.panelIntro}>
          This server is not part of FestiBooth. It runs on a computer one of you hosts; this panel only helps
          you both get to it.
        </p>
        <div>
          <label className={styles.label} htmlFor="minecraft-address">
            Server address
          </label>
          <input
            id="minecraft-address"
            value={rawAddress}
            onChange={(event) => updateAddress(event.target.value)}
            placeholder="play.example.com:25565"
            className={styles.input}
          />
          {rawAddress && !address ? (
            <p className={styles.error}>Use a hostname or IPv4 address, with an optional port.</p>
          ) : null}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={!address} onClick={copy}>
            Copy address
          </button>
          {address ? (
            <a
              href={bedrockJoinUrl("GameWord server", address.host, address.port)}
              className={styles.buttonPrimary}
            >
              Open in Minecraft (Bedrock)
            </a>
          ) : null}
        </div>
        {message ? (
          <p role="status" className={styles.note}>
            {message}
          </p>
        ) : null}
        <p className={styles.note}>
          Java Edition: Multiplayer, then Direct connection, then paste the address.
        </p>
      </div>
    </section>
  );
}
