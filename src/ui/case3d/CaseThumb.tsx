import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CaseId } from '../../engine/cases';
import type { Role } from '../../engine/types';
import { webglAvailable } from '../arena/Viewer3D';
import { caseThumb } from './thumbs';

/** The 3D case as a still picture for lists; shows `fallback` (the drawn case) without WebGL. */
export function CaseThumb({ id, role, fallback }: { id: CaseId; role?: Role; fallback: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(() => !webglAvailable());
  useEffect(() => {
    if (failed) return;
    let alive = true;
    caseThumb(id, role).then((u) => { if (alive) setSrc(u); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [id, role, failed]);
  if (failed) return <>{fallback}</>;
  return src ? <img className="case-thumb" src={src} alt="" width={160} height={120} draggable={false} /> : <span className="case-thumb pending" />;
}
