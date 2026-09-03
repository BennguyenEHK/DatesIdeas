import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** How long an upload link stays usable. Short: it is used immediately. */
export const UPLOAD_URL_TTL_SEC = 300;
/** How long a download link stays usable. Matches a room's lifetime, so a
 *  keepsake link dies with the evening that produced it. */
export const DOWNLOAD_URL_TTL_SEC = 24 * 60 * 60;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reads configuration from the environment. Returns null when storage is
 * not configured, so the feature can be absent rather than crash the app.
 */
export function storageConfig(): StorageConfig | null {
  const endpoint = configured(process.env.NEON_STORAGE_ENDPOINT);
  const bucket = configured(process.env.NEON_STORAGE_BUCKET);
  const accessKeyId = configured(process.env.NEON_STORAGE_ACCESS_KEY_ID);
  const secretAccessKey = configured(process.env.NEON_STORAGE_SECRET_ACCESS_KEY);

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint,
    region: configured(process.env.NEON_STORAGE_REGION) ?? "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export interface PresignedPair {
  uploadUrl: string;
  downloadUrl: string;
  key: string;
}

/**
 * Signs a PUT for the browser to upload to, and a GET for the phone to
 * download from.
 */
export async function presignKeepsake(
  key: string,
  contentType: string,
  config?: StorageConfig | null,
): Promise<PresignedPair | null> {
  const resolvedConfig = config === undefined ? storageConfig() : config;
  if (resolvedConfig === null) return null;

  try {
    // Neon uses bucket path segments; virtual-host URLs would point nowhere.
    const client = new S3Client({
      endpoint: resolvedConfig.endpoint,
      region: resolvedConfig.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: resolvedConfig.accessKeyId,
        secretAccessKey: resolvedConfig.secretAccessKey,
      },
    });

    const [uploadUrl, downloadUrl] = await Promise.all([
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: resolvedConfig.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: UPLOAD_URL_TTL_SEC },
      ),
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: resolvedConfig.bucket,
          Key: key,
          // Without this the link OPENS the file instead of saving it: a
          // browser handed an image or a video renders it inline, and the
          // phone that scanned the QR ends up looking at a picture it has no
          // copy of. "attachment" is the only thing that turns a link into a
          // download, and it has to be signed into the URL because nothing
          // else about the request is ours to control.
          ResponseContentDisposition: `attachment; filename="${downloadName(key)}"`,
          // Served as what it actually is, rather than whatever the object was
          // stored as, so a phone knows what it has been given.
          ResponseContentType: contentType,
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SEC },
      ),
    ]);

    return { uploadUrl, downloadUrl, key };
  } catch {
    // Signing failures can contain request details, so callers only get absence.
    return null;
  }
}

/**
 * What the file should be called once it reaches someone's phone.
 *
 * Built from the key rather than passed in, so it cannot disagree with the
 * object it names. The storage key carries a random token to stop two people
 * overwriting each other, which is exactly the sort of thing nobody wants in
 * their downloads folder — so the room and the kind survive and the token does
 * not. Quotes and backslashes are stripped because this string is interpolated
 * into a Content-Disposition header.
 */
export function downloadName(key: string): string {
  const match = /^keepsakes\/([A-Za-z0-9_-]+)\/(strip|clip)-[A-Za-z0-9_-]+\.([a-z0-9]+)$/.exec(
    key,
  );
  if (match === null) return "festibooth";
  const [, room, kind, extension] = match;
  return `festibooth-${room}${kind === "clip" ? "-live" : ""}.${extension}`;
}

/** Whether a key is one this app is allowed to sign for. */
export function isKeepsakeKey(key: string): boolean {
  // This constrains client input so it cannot turn our signer into bucket-wide access.
  if (key.includes("..") || key.includes("\\")) return false;
  return /^keepsakes\/[A-Za-z0-9_-]+\/(?:strip|clip)-[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(
    key,
  );
}
