import { avatarDataUrl } from './portrait';
import type { AvatarKind } from './portrait';

export interface AvatarProps {
  seed: string;
  size?: number;
  kind?: AvatarKind;
  accent?: string;
  /** Fixed jersey colour (a real org's kit). */
  jersey?: string;
  className?: string;
  title?: string;
}

export function Avatar({ seed, size = 48, kind, accent, jersey, className, title }: AvatarProps) {
  return (
    <img
      src={avatarDataUrl(seed, { kind, accent, jersey })}
      width={size}
      height={size}
      alt={title ?? ''}
      title={title}
      draggable={false}
      className={`avatar ${className ?? ''}`}
      loading="lazy"
      decoding="async"
    />
  );
}
