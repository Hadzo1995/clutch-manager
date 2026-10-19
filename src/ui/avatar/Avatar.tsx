import { avatarDataUrl } from './avatar';
import type { AvatarKind } from './avatar';

export interface AvatarProps {
  seed: string;
  size?: number;
  kind?: AvatarKind;
  accent?: string;
  className?: string;
  title?: string;
}

export function Avatar({ seed, size = 48, kind, accent, className, title }: AvatarProps) {
  return (
    <img
      src={avatarDataUrl(seed, { kind, accent })}
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
