import { useState } from 'react';
import { PLAYER_PHOTOS } from '../../engine/data/playerPhotos.generated';
import { avatarDataUrl } from './portrait';
import type { AvatarKind } from './portrait';

export interface AvatarProps {
  /** The player's stable id (pro-<handle> for real players); also seeds the drawn portrait. */
  seed: string;
  size?: number;
  kind?: AvatarKind;
  accent?: string;
  /** Fixed jersey colour (a real org's kit). */
  jersey?: string;
  className?: string;
  title?: string;
  /** Draw the procedural portrait even when a photo exists (e.g. a coach). */
  drawn?: boolean;
  /** Load right away instead of when scrolled into view (the case strip moves too fast for lazy loading). */
  eager?: boolean;
}

/** URL of a real player's photo (served from public/players), or undefined. */
export function playerPhotoUrl(id: string): string | undefined {
  const p = PLAYER_PHOTOS[id];
  return p ? p.src : undefined;
}

/**
 * A player's picture: the real photo when we have one, otherwise the drawn portrait.
 * A photo that fails to load (offline single-file build, missing file) falls back to the
 * drawn portrait, so a card never shows a broken image.
 */
export function Avatar({ seed, size = 48, kind, accent, jersey, className, title, drawn, eager }: AvatarProps) {
  const photo = drawn || kind === 'coach' ? undefined : playerPhotoUrl(seed);
  const [failed, setFailed] = useState<string | null>(null);
  const usePhoto = !!photo && failed !== photo;
  return (
    <img
      src={usePhoto ? photo : avatarDataUrl(seed, { kind, accent, jersey })}
      width={size}
      height={size}
      alt={title ?? ''}
      title={title}
      draggable={false}
      className={`avatar${usePhoto ? ' photo' : ''} ${className ?? ''}`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={usePhoto ? () => setFailed(photo!) : undefined}
      style={usePhoto && accent ? { ['--ava-accent' as string]: accent } : undefined}
    />
  );
}
