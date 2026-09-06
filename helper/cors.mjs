/**
 * The headers the browser has to be given before it will talk to this machine,
 * and before it will let the page read the answer.
 *
 * Kept apart from the server so the rules can be tested without opening a
 * socket. They are exactly the kind of thing that looks right in a response
 * dump and is still wrong.
 */

/**
 * The track's details ride on the response as headers rather than in the body,
 * because the body is the video itself.
 *
 * They are useless unless they are named here. A browser lets a page read only
 * a handful of response headers by default -- Content-Type and a few others --
 * and every other one is silently invisible to fetch(), including these. curl
 * has no such rule, so a request that works perfectly from a terminal can
 * arrive in a browser with the video intact and the title missing, and the page
 * throws away three megabytes of song for want of its name.
 */
export const EXPOSED_HEADERS = ['X-Track-Title', 'X-Track-Duration'];

/**
 * The CORS headers for a request, or null when the origin is not the app.
 *
 * Null rather than a permissive answer: this server is reachable from the
 * public internet through a tunnel, so an arbitrary website must not be able to
 * drive a visitor's browser into fetching through it.
 */
export function corsHeaders(requestOrigin, allowedOrigin) {
  if (typeof allowedOrigin !== 'string' || allowedOrigin === '') return null;
  if (requestOrigin !== allowedOrigin) return null;

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': EXPOSED_HEADERS.join(', '),
    // Caches must not hand an answer made for one origin to another.
    Vary: 'Origin',
  };
}
