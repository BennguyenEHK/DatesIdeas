import QRCode from "qrcode";

/**
 * How large the code is drawn, in pixels.
 *
 * Big enough that a phone camera locks on from a comfortable distance across
 * a desk. Smaller looks tidier and makes people lean in, which is the one
 * thing a QR code must never do.
 */
export const QR_SIZE = 176;

/**
 * Renders a link as a QR image, or null when it cannot be drawn.
 *
 * A QR code holds a few kilobytes of TEXT at most — nowhere near a photograph,
 * which runs to megabytes. So what is encoded here is never the picture, only
 * a link to it. That single fact is why the save menu's QR modes need the
 * strip uploaded somewhere first, while the download mode does not.
 */
export async function qrDataUrl(
  text: string,
  size = QR_SIZE,
): Promise<string | null> {
  if (text.trim() === "") return null;
  try {
    return await QRCode.toDataURL(text, {
      width: size,
      // One module of quiet zone rather than the default four: the code sits
      // on its own cream card, which already provides the contrast border a
      // scanner needs.
      margin: 1,
      // Medium recovery. A screen is not a crumpled receipt, and higher
      // correction only makes the modules smaller and harder to read.
      errorCorrectionLevel: "M",
      color: { dark: "#080b1c", light: "#f5efe0" },
    });
  } catch {
    // An unrenderable code is a missing convenience, not a broken evening.
    return null;
  }
}
