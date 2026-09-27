import type { LookbookPiece, Outfit, Placement } from "./types";

const DEFAULT_WIDTH = 1080;
const BOARD_RATIO = 4 / 3;
const DEFAULT_PIECE_RATIO = 0.4;

type LoadedImage = CanvasImageSource & { width: number; height: number };

function browserImage(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("piece image failed"));
    image.src = url;
  });
}

/** Draws the same paper board used by Keep in album without allowing one bad photo to throw. */
export async function renderOutfitPng(
  outfit: Outfit,
  pieces: LookbookPiece[],
  options: {
    width?: number;
    loadImage?: (url: string) => Promise<LoadedImage>;
  } = {},
): Promise<Blob | null> {
  try {
    const width = options.width ?? DEFAULT_WIDTH;
    const height = Math.round(width * BOARD_RATIO);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.fillStyle = "#f4eee1";
    context.fillRect(0, 0, width, height);
    const byId = new Map(pieces.map((piece) => [piece.id, piece]));
    const ordered = [...outfit.layout].sort((a, b) => a.z - b.z);
    const load = options.loadImage ?? browserImage;

    for (const placement of ordered) {
      const piece = byId.get(placement.pieceId);
      if (piece === undefined) continue;
      const image = await load(piece.url);
      const targetWidth = width * DEFAULT_PIECE_RATIO * placement.scale;
      const ratio = image.width > 0 ? image.height / image.width : 1;
      const targetHeight = targetWidth * ratio;
      context.drawImage(
        image,
        placement.x * width - targetWidth / 2,
        placement.y * height - targetHeight / 2,
        targetWidth,
        targetHeight,
      );
    }
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch {
    return null;
  }
}

export type { Placement };
