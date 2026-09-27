/**
 * The seams between the Lookbook's three parts, written before any of them so
 * each can be built against the others without waiting for them.
 *
 *   client.ts          -- implements LookbookClient over /api/lookbook/*
 *   layout.ts          -- the pure board operations (BoardState, PlaceOp)
 *   useLookbook.ts     -- implements UseLookbook on top of both
 *   components/lookbook/*  -- render a LookbookView and call its actions
 */
import type { PeerMessage } from "@/lib/rtc/protocol";
import type {
  LookbookPiece,
  NewOutfit,
  Outfit,
  OutfitPatch,
  PieceKind,
  PiecePatch,
  Placement,
} from "./types";

/** Every client call resolves; none throws. `status` is the HTTP status, null when offline. */
export type LookbookResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number | null };

export interface LookbookClient {
  listPieces(): Promise<LookbookResult<LookbookPiece[]>>;
  /**
   * Shrinks the photo in the browser (JPEG, longest edge 1600px) unless it is
   * already small, then presigns, uploads and confirms.
   */
  addPiece(
    file: Blob,
    fields: { kind: PieceKind; label: string; addedBy: string },
  ): Promise<LookbookResult<LookbookPiece>>;
  updatePiece(id: string, patch: PiecePatch): Promise<LookbookResult<LookbookPiece>>;
  deletePiece(id: string): Promise<LookbookResult<true>>;
  /** `from`/`to` are inclusive `YYYY-MM-DD` days on `wearOn`, for the calendar. */
  listOutfits(range?: { from: string; to: string }): Promise<LookbookResult<Outfit[]>>;
  createOutfit(fields: NewOutfit): Promise<LookbookResult<Outfit>>;
  updateOutfit(id: string, patch: OutfitPatch): Promise<LookbookResult<Outfit>>;
  deleteOutfit(id: string): Promise<LookbookResult<true>>;
}

/** When a board change was made, and by whom; later wins, then the larger `by`. */
export interface Stamp {
  at: number;
  by: string;
}

/** A board being edited live: each piece's latest placement, and recent removals. */
export interface BoardState {
  placed: Record<string, { place: Placement; stamp: Stamp }>;
  removed: Record<string, Stamp>;
}

/** One change to a board, from either side: `place: null` takes the piece off. */
export interface PlaceOp {
  pieceId: string;
  place: Omit<Placement, "pieceId"> | null;
  stamp: Stamp;
}

/** What the Lookbook screen draws and can do. The hook's return value. */
export interface LookbookView {
  /** `unpaired` means no season ticket: show the album's join prompt instead. */
  status: "loading" | "ready" | "unpaired" | "error";
  error: string | null;
  /** Newest first. */
  pieces: LookbookPiece[];
  /** Most recently changed first. */
  outfits: Outfit[];
  /** The outfit on the board, with live moves applied, or null for the wardrobe. */
  open: Outfit | null;
  /** This person's identity, to tell "yours" from "theirs" and to heart. */
  me: string;
  /** True while a piece photo is uploading. */
  adding: boolean;

  addPiece(file: Blob, kind: PieceKind, label?: string): Promise<boolean>;
  updatePiece(id: string, patch: PiecePatch): Promise<boolean>;
  deletePiece(id: string): Promise<boolean>;

  /** Creates "Outfit N" (N = outfits + 1), opens it on both screens, resolves to it. */
  createOutfit(): Promise<Outfit | null>;
  /** Opens an outfit on both screens, or null to go back to the wardrobe. */
  openOutfit(id: string | null): void;
  /** Places or moves a piece on the open board. Live on both screens; saved within a second. */
  place(placement: Placement): void;
  /** Takes a piece off the open board. */
  unplace(pieceId: string): void;
  rename(id: string, name: string): Promise<boolean>;
  setWearOn(id: string, day: string | null): Promise<boolean>;
  setNote(id: string, note: string): Promise<boolean>;
  /** Hearts or un-hearts for `me`. */
  toggleLove(id: string): Promise<boolean>;
  deleteOutfit(id: string): Promise<boolean>;
  reload(): void;
}

export interface UseLookbookArgs {
  paired: boolean;
  /** getIdentity(): who "me" is. */
  identity: string;
  send: (message: PeerMessage) => void;
  /** Shared-clock time, which stamps board moves and opens. */
  now: () => number;
  /** True while the Lookbook activity is showing; nothing loads while it is not. */
  active: boolean;
  /** Injected for tests; defaults to the real client. */
  client?: LookbookClient;
}

/** The hook also takes the room's inbound peer messages; anything not lookbook-* is ignored. */
export type LookbookAccept = (message: PeerMessage) => void;
