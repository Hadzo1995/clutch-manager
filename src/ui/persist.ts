/** Local saves. Storage can be unavailable (private mode, blocked site data), so every call is guarded. */
import type { Career } from '../engine/career';
import { deserializeCareer, serializeCareer } from '../engine/save';
import type { Dataset } from '../engine/types';

const SAVE_KEY = 'clutch-manager.save.v1';
const DATASET_KEY = 'clutch-manager.dataset.v1';

export function loadCareer(): Career | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? deserializeCareer(raw) : null;
  } catch {
    return null;
  }
}

export function storeCareer(c: Career | null): boolean {
  try {
    if (c) localStorage.setItem(SAVE_KEY, serializeCareer(c));
    else localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadDataset(): Dataset | null {
  try {
    const raw = localStorage.getItem(DATASET_KEY);
    return raw ? (JSON.parse(raw) as Dataset) : null;
  } catch {
    return null;
  }
}

export function storeDataset(d: Dataset | null): boolean {
  try {
    if (d) localStorage.setItem(DATASET_KEY, JSON.stringify(d));
    else localStorage.removeItem(DATASET_KEY);
    return true;
  } catch {
    return false;
  }
}
