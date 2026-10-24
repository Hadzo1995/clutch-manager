/**
 * Title screen backdrop: a slow camera flight over the real 3D maps, crossfading between three of them.
 * Falls back to the flat map art (rendered by the caller) when WebGL is unavailable; with reduced motion
 * it shows one still frame.
 */
import { useEffect, useRef, useState } from 'react';
import type { MapName } from '../engine/types';
import { geometryFor } from '../maps';
import { Viewer3D, webglAvailable } from './arena/Viewer3D';
import { reducedMotion } from './motion';

const TOUR: MapName[] = ['Mirage', 'Inferno', 'Dust2'];
const LEG_MS = 16000;

export function TitleScene({ onFail }: { onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [leg, setLeg] = useState(0);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !webglAvailable()) { onFail(); return; }
    const reduced = reducedMotion();
    const map = TOUR[leg % TOUR.length]!;
    let v: Viewer3D;
    try {
      v = new Viewer3D(canvas, geometryFor(map), { t: '#f0a33a', ct: '#5aa9e6' }, { onContextLost: onFail });
    } catch { onFail(); return; }
    v.showLabels = false; v.showVision = false;
    const start = performance.now();
    const offset = leg * 9;
    v.titleCam(offset, true);
    let raf = 0, alive = true, first = true, last = 0;
    const frame = (now: number) => {
      if (!alive) return;
      // About 30 fps is plenty for a slow flyover and halves the GPU cost behind the form.
      if (!first && now - last < 30) { raf = requestAnimationFrame(frame); return; }
      last = now;
      const sec = (now - start) / 1000;
      v.titleCam(offset + sec);
      v.render(0);
      if (first) { first = false; setShown(true); }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const fade = reduced ? 0 : window.setTimeout(() => setShown(false), LEG_MS - 900);
    const next = reduced ? 0 : window.setTimeout(() => setLeg((l) => l + 1), LEG_MS);
    return () => { alive = false; cancelAnimationFrame(raf); window.clearTimeout(fade); window.clearTimeout(next); v.dispose(); };
  }, [leg]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={ref} key={leg} className={`ob-scene${shown ? ' on' : ''}`} aria-hidden="true" />;
}
