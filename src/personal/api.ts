import { api } from '../api';
import type { WriteAction } from './types';
const reads = new Set(['bootstrap', 'backup']);
const writes = new Set<WriteAction>(['save', 'generate', 'transaction', 'pay', 'void', 'reconcile', 'configure', 'upload', 'resolveOperation']);
export function personalApi<T>(action: 'bootstrap' | 'backup' | WriteAction, payload?: Record<string, unknown>): Promise<T> {
  if (payload === undefined ? !reads.has(action) : !writes.has(action as WriteAction)) throw new Error('Accion personal no permitida');
  return api<T>(`personal-${action}`, payload);
}
