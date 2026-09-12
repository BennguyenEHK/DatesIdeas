import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isAlbumKey, isLegacyAlbumKey } from "@/lib/album/keys";
import { DATED_PATTERN } from "./datedName";

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

/**
 * One S3 client for this bucket. Neon uses bucket path segments; virtual-host
 * URLs would point nowhere, so path style is not optional.
 */
function storageClient(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
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
  /**
   * How long the download link should last, when the default is wrong.
   *
   * It is wrong in exactly one place: a link put inside a push notification.
   * A push can sit on the service for hours before the phone comes back, and
   * a picture signed for the length of a page view would be dead by the time
   * anybody saw the notification carrying it.
   */
  downloadTtlSec?: number,
): Promise<PresignedPair | null> {
  const resolvedConfig = config === undefined ? storageConfig() : config;
  if (resolvedConfig === null) return null;

  try {
    const client = storageClient(resolvedConfig);

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
          // Measured against the live bucket: it ignores response-* overrides,
          // so disposition and type come from stored metadata set at PUT time.
          // The client, not this URL, therefore decides the download filename.
        }),
        { expiresIn: downloadTtlSec ?? DOWNLOAD_URL_TTL_SEC },
      ),
    ]);

    return { uploadUrl, downloadUrl, key };
  } catch {
    // Signing failures can contain request details, so callers only get absence.
    return null;
  }
}

/** `keepsakes/2026/09/12_21-04-17_strip_KW3KDD_8e2d4a1b.png` */
const KEEPSAKE_KEY = new RegExp(
  `^keepsakes\\/${DATED_PATTERN}_(?:strip|clip)_[A-Z0-9]+_[a-f0-9]+\\.[a-z0-9]+$`,
);
/** Before files were filed by date: `keepsakes/<ROOM>/strip-<token>.png`. */
const LEGACY_KEEPSAKE_KEY = /^keepsakes\/[A-Za-z0-9_-]+\/(?:strip|clip)-[A-Za-z0-9_-]+\.[a-z0-9]+$/;

/** Whether a key is one this app is allowed to sign for. */
export function isKeepsakeKey(key: string): boolean {
  // This constrains client input so it cannot turn our signer into bucket-wide access.
  if (key.includes("..") || key.includes("\\")) return false;
  if (KEEPSAKE_KEY.test(key) || LEGACY_KEEPSAKE_KEY.test(key)) return true;
  // An album object may also be pointed at by a keepsake row.
  //
  // A keepsake is a public, room-lifetime-bounded pointer at one object; it has
  // never cared where that object came from. Allowing an album key here is what
  // lets a recording already saved to the album be shared by QR without
  // uploading the same fifty megabytes a second time.
  return isAlbumKey(key) || isLegacyAlbumKey(key);
}

export interface StoredObject {
  key: string;
  /** Null when the bucket did not say, which the cleanup treats as "too new to judge". */
  lastModified: Date | null;
}

/**
 * Every object under a prefix, across as many pages as the bucket returns.
 *
 * Throws on failure rather than returning an empty list. An empty list here is
 * safe -- it deletes nothing -- but a cleanup that silently read nothing would
 * report success while leaving every file in place.
 */
export async function listKeys(
  prefix: string,
  config?: StorageConfig | null,
): Promise<StoredObject[]> {
  const resolved = config === undefined ? storageConfig() : config;
  if (resolved === null) return [];

  const client = storageClient(resolved);
  const found: StoredObject[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: resolved.bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) found.push({ key: object.Key, lastModified: object.LastModified ?? null });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return found;
}

/**
 * The only two places this app ever writes. Anything else is refused outright:
 * a delete helper that would remove any key it was handed is one bad string
 * away from emptying the bucket.
 *
 * Both layouts: `album/2026/09/<file>` now, and `album/<code>/<file>` for
 * anything saved before files were filed by date.
 */
function mayDelete(key: string): boolean {
  if (key.includes("..") || key.includes("\\")) return false;
  return /^(?:keepsakes|album)\/(?:\d{4}\/\d{2}\/[^/]+|[^/]+\/[^/]+)$/.test(key);
}

/**
 * Deletes objects, a few at a time, and says how many actually went.
 *
 * One refused delete does not stop the rest -- a cleanup that gave up on the
 * first failure would leave the whole folder behind for want of one file.
 */
export async function deleteKeys(
  keys: readonly string[],
  config?: StorageConfig | null,
): Promise<number> {
  const allowed = keys.filter(mayDelete);
  if (allowed.length === 0) return 0;
  const resolved = config === undefined ? storageConfig() : config;
  if (resolved === null) return 0;

  const client = storageClient(resolved);
  let deleted = 0;
  for (let index = 0; index < allowed.length; index += 10) {
    const batch = allowed.slice(index, index + 10);
    const results = await Promise.allSettled(
      batch.map((key) => client.send(new DeleteObjectCommand({ Bucket: resolved.bucket, Key: key }))),
    );
    deleted += results.filter((result) => result.status === "fulfilled").length;
  }
  return deleted;
}
