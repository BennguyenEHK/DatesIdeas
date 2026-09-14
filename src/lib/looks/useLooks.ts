"use client";

import { useCallback, useEffect, useState } from "react";
import { looksClient } from "./client";
import type { CustomLook, LooksClient } from "./types";

/**
 * The looks this pair designed, for the photo booth's picker.
 *
 * Loaded once a device is known to be paired, and again whenever a look is
 * saved or the other screen says one was. An unpaired device simply has none:
 * a designed look lives in the pair's storage, and there is nowhere to read
 * it from without a season ticket.
 */
export function useLooks({ paired, client = looksClient }: { paired: boolean; client?: LooksClient }) {
  const [looks, setLooks] = useState<readonly CustomLook[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!paired) return;
    let active = true;
    void client.list().then((result) => {
      if (active && result.ok) setLooks(result.looks);
    });
    return () => {
      active = false;
    };
  }, [client, paired, revision]);

  /** Adds a just-saved look straight away, then reloads for fresh signed links. */
  const added = useCallback((look: CustomLook) => {
    setLooks((current) => [look, ...current.filter((candidate) => candidate.id !== look.id)]);
    setRevision((value) => value + 1);
  }, []);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  return { looks: paired ? looks : [], added, reload };
}
