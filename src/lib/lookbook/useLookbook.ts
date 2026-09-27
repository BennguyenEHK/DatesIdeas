"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerMessage } from "@/lib/rtc/protocol";
import type {
  BoardState,
  LookbookAccept,
  LookbookResult,
  LookbookView,
  PlaceOp,
  UseLookbookArgs,
} from "./contract";
import type { Outfit, PieceKind, PiecePatch, Placement } from "./types";
import { applyPlace, boardFrom, boardLayout, newer } from "./layout";
import { lookbookClient } from "./client";

const EMPTY_BOARD: BoardState = { placed: {}, removed: {} };

function newestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function changedFirst(items: Outfit[]): Outfit[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Shared Lookbook state, with refs so inbound room events never use stale renders. */
export function useLookbook(args: UseLookbookArgs): { view: LookbookView; accept: LookbookAccept } {
  const client = args.client ?? lookbookClient;
  const mounted = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const board = useRef<BoardState>(EMPTY_BOARD);
  const openId = useRef<string | null>(null);
  const openStamp = useRef({ at: -1, by: "" });
  // Whether the board was seeded from the open outfit itself. An outfit opened
  // by the other screen before this one has loaded is seeded from nothing, and
  // has to be filled in when the outfits arrive -- or it shows empty, and the
  // next move saves that empty board over the real one.
  const seeded = useRef(false);
  const outfitsRef = useRef<Outfit[]>([]);
  const piecesRef = useRef<LookbookView["pieces"]>([]);
  const [status, setStatus] = useState<LookbookView["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<LookbookView["pieces"]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [open, setOpen] = useState<Outfit | null>(null);
  const [adding, setAdding] = useState(false);

  const setOutfitsBoth = useCallback((next: Outfit[]) => {
    const sorted = changedFirst(next);
    outfitsRef.current = sorted;
    if (mounted.current) setOutfits(sorted);
  }, []);
  const setPiecesBoth = useCallback((next: LookbookView["pieces"]) => {
    const sorted = newestFirst(next);
    piecesRef.current = sorted;
    if (mounted.current) setPieces(sorted);
  }, []);
  const showOpen = useCallback(() => {
    const base =
      openId.current === null
        ? null
        : outfitsRef.current.find((outfit) => outfit.id === openId.current);
    if (mounted.current)
      setOpen(
        base === undefined || base === null
          ? null
          : { ...base, layout: boardLayout(board.current) },
      );
  }, []);

  /** Seeds the board from the open outfit, once it is known. */
  const seedIfNeeded = useCallback(() => {
    if (openId.current === null || seeded.current) return;
    const outfit = outfitsRef.current.find((candidate) => candidate.id === openId.current);
    if (outfit === undefined) return;
    board.current = boardFrom(outfit.layout, openStamp.current);
    seeded.current = true;
  }, []);

  /**
   * Takes pieces that no longer exist off the board. The server strips a
   * deleted piece from every outfit, and a board still holding it would have
   * every later save refused for naming a piece that is not in the wardrobe.
   */
  const pruneBoard = useCallback(() => {
    const known = new Set(piecesRef.current.map((piece) => piece.id));
    const gone = Object.keys(board.current.placed).filter((id) => !known.has(id));
    if (gone.length === 0) return;
    const placed = { ...board.current.placed };
    for (const id of gone) delete placed[id];
    board.current = { ...board.current, placed };
  }, []);

  const reload = useCallback(async () => {
    if (!args.active) return;
    if (!args.paired) {
      if (mounted.current) {
        setStatus("unpaired");
        setError(null);
      }
      return;
    }
    if (mounted.current) {
      setStatus("loading");
      setError(null);
    }
    const [pieceResult, outfitResult] = await Promise.all([
      client.listPieces(),
      client.listOutfits(),
    ]);
    if (!mounted.current) return;
    if (!pieceResult.ok) {
      const failure = pieceResult;
      setStatus(failure.status === 401 ? "unpaired" : "error");
      setError(failure.status === 401 ? null : failure.error);
      return;
    }
    if (!outfitResult.ok) {
      const failure = outfitResult;
      setStatus(failure.status === 401 ? "unpaired" : "error");
      setError(failure.status === 401 ? null : failure.error);
      return;
    }
    setPiecesBoth(pieceResult.value);
    setOutfitsBoth(outfitResult.value);
    seedIfNeeded();
    pruneBoard();
    // Reload refreshes metadata, but the in-flight board is the source of truth
    // until its debounced save lands.
    if (openId.current !== null) showOpen();
    setStatus("ready");
  }, [
    args.active,
    args.paired,
    client,
    pruneBoard,
    seedIfNeeded,
    setOutfitsBoth,
    setPiecesBoth,
    showOpen,
  ]);

  useEffect(() => {
    // Defer the initial read one microtask so this effect only starts external
    // work; React can commit the loading view before the response is applied.
    void Promise.resolve().then(reload);
  }, [reload]);
  useEffect(
    () => () => {
      mounted.current = false;
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    },
    [],
  );

  const sendChanged = useCallback(() => args.send({ t: "lookbook-changed" }), [args]);
  const replaceOutfit = useCallback(
    (outfit: Outfit) => {
      setOutfitsBoth([
        outfit,
        ...outfitsRef.current.filter((candidate) => candidate.id !== outfit.id),
      ]);
      if (openId.current === outfit.id) showOpen();
    },
    [setOutfitsBoth, showOpen],
  );
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const id = openId.current;
      if (id === null) return;
      void client.updateOutfit(id, { layout: boardLayout(board.current) }).then((result) => {
        if (result.ok) replaceOutfit(result.value);
      });
    }, 1000);
  }, [client, replaceOutfit]);

  const openOutfit = useCallback(
    (id: string | null) => {
      const at = args.now();
      openId.current = id;
      openStamp.current = { at, by: args.identity };
      const outfit =
        id === null ? null : (outfitsRef.current.find((candidate) => candidate.id === id) ?? null);
      board.current = outfit === null ? EMPTY_BOARD : boardFrom(outfit.layout, openStamp.current);
      seeded.current = outfit !== null;
      showOpen();
      args.send({ t: "lookbook-open", outfitId: id, at });
    },
    [args, showOpen],
  );
  const mutate = useCallback(
    async (action: () => Promise<LookbookResult<Outfit>>) => {
      const result = await action();
      if (!result.ok) return false;
      replaceOutfit(result.value);
      sendChanged();
      return true;
    },
    [replaceOutfit, sendChanged],
  );

  const placeOp = useCallback(
    (op: PlaceOp, announce: boolean) => {
      const next = applyPlace(board.current, op);
      if (next === board.current) return;
      board.current = next;
      showOpen();
      if (announce && openId.current !== null) {
        args.send({
          t: "lookbook-place",
          outfitId: openId.current,
          pieceId: op.pieceId,
          place: op.place,
          at: op.stamp.at,
          by: op.stamp.by,
        });
      }
      scheduleSave();
    },
    [args, scheduleSave, showOpen],
  );

  const accept = useCallback(
    (message: PeerMessage) => {
      if (message.t === "lookbook-changed") {
        void reload();
        return;
      }
      if (message.t === "lookbook-open") {
        const remote = { at: message.at, by: "" };
        if (!newer(remote, openStamp.current)) return;
        openId.current = message.outfitId;
        openStamp.current = remote;
        const outfit =
          message.outfitId === null
            ? null
            : (outfitsRef.current.find((item) => item.id === message.outfitId) ?? null);
        board.current = outfit === null ? EMPTY_BOARD : boardFrom(outfit.layout, remote);
        seeded.current = outfit !== null;
        showOpen();
        return;
      }
      if (message.t === "lookbook-place" && message.outfitId === openId.current) {
        placeOp(
          {
            pieceId: message.pieceId,
            place: message.place,
            stamp: { at: message.at, by: message.by },
          },
          false,
        );
      }
    },
    [placeOp, reload, showOpen],
  );

  const view: LookbookView = {
    status,
    error,
    pieces,
    outfits,
    open,
    me: args.identity,
    adding,
    async addPiece(file: Blob, kind: PieceKind, label = "") {
      if (mounted.current) setAdding(true);
      const result = await client.addPiece(file, { kind, label, addedBy: args.identity });
      if (mounted.current) setAdding(false);
      if (!result.ok) return false;
      setPiecesBoth([result.value, ...piecesRef.current]);
      sendChanged();
      return true;
    },
    async updatePiece(id: string, patch: PiecePatch) {
      const result = await client.updatePiece(id, patch);
      if (!result.ok) return false;
      setPiecesBoth([result.value, ...piecesRef.current.filter((piece) => piece.id !== id)]);
      sendChanged();
      return true;
    },
    async deletePiece(id: string) {
      const result = await client.deletePiece(id);
      if (!result.ok) return false;
      setPiecesBoth(piecesRef.current.filter((piece) => piece.id !== id));
      pruneBoard();
      showOpen();
      sendChanged();
      return true;
    },
    async createOutfit() {
      const result = await client.createOutfit({
        name: `Outfit ${outfitsRef.current.length + 1}`,
        createdBy: args.identity,
      });
      if (!result.ok) return null;
      replaceOutfit(result.value);
      sendChanged();
      openOutfit(result.value.id);
      return result.value;
    },
    openOutfit,
    place(placement: Placement) {
      if (openId.current === null) return;
      const { pieceId, ...place } = placement;
      placeOp({ pieceId, place, stamp: { at: args.now(), by: args.identity } }, true);
    },
    unplace(pieceId: string) {
      if (openId.current !== null)
        placeOp({ pieceId, place: null, stamp: { at: args.now(), by: args.identity } }, true);
    },
    rename: (id: string, name: string) => mutate(() => client.updateOutfit(id, { name })),
    setWearOn: (id: string, wearOn: string | null) =>
      mutate(() => client.updateOutfit(id, { wearOn })),
    setNote: (id: string, note: string) => mutate(() => client.updateOutfit(id, { note })),
    toggleLove: (id: string) => {
      const outfit = outfitsRef.current.find((candidate) => candidate.id === id);
      return mutate(() =>
        client.updateOutfit(id, {
          love: { by: args.identity, on: !(outfit?.lovedBy.includes(args.identity) ?? false) },
        }),
      );
    },
    async deleteOutfit(id: string) {
      const result = await client.deleteOutfit(id);
      if (!result.ok) return false;
      setOutfitsBoth(outfitsRef.current.filter((outfit) => outfit.id !== id));
      if (openId.current === id) {
        openId.current = null;
        board.current = EMPTY_BOARD;
        showOpen();
      }
      sendChanged();
      return true;
    },
    reload: () => {
      void reload();
    },
  };
  return { view, accept };
}
