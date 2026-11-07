/**
 * Development only (#dev-map=Dust2): a map on its own in the 3D viewer, no round, so its
 * buildings, textures and props can be looked at. Screenshot scripts move the camera with
 * window.__viewer.debugCam(name).
 */
import { useEffect, useRef } from 'react';
import type { MapName } from '../../engine/types';
import { geometryFor } from '../../maps';
import { Viewer3D } from '../arena/Viewer3D';

export default function DevMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const name = decodeURIComponent(location.hash.split('=')[1] || 'Dust2') as MapName;
    const v = new Viewer3D(ref.current!, geometryFor(name), { t: '#f0a33a', ct: '#5aa9e6' });
    let raf = 0;
    const loop = () => { v.render(0); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); v.dispose(); };
  }, []);
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block' }} />;
}
