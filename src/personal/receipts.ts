import { safeReceiptUrl } from '../components';
export function validUploadFilename(value: string): boolean {
  return !!value.trim() && value.length <= 120 && !value.trim().startsWith('.') && !/[\x00-\x1f\x7f/\\]/.test(value);
}
export function personalReceiptUrl(value: string): string | null {
  return value.length <= 300 && /^https:\/\/drive\.google\.com\/(?:file\/d\/[A-Za-z0-9_-]{10,}\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?|open\?id=[A-Za-z0-9_-]{10,}(?:&[A-Za-z0-9_=%&.~+\-]*)?)$/.test(value) ? safeReceiptUrl(value) : null;
}
