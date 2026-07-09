/**
 * Vitest setup for the R3F hook tests.
 *
 * - Flags the act(...) environment so React's test renderer batches updates
 *   without the "not configured to support act" warning.
 * - Stubs a minimal WebGLRenderingContext on jsdom canvases. @react-three/fiber's
 *   default renderer probes for a GL context; jsdom has none, and without a stub
 *   R3F falls back to a path that attempts a network connection. The test renderer
 *   never actually rasterizes, so a permissive no-op context is enough.
 */
import { vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// R3F's test renderer supplies its own headless gl, but jsdom's
// HTMLCanvasElement.getContext returns null and R3F probes it — return a stub so
// no code path tries a real/remote context.
const proto = globalThis.HTMLCanvasElement?.prototype;
if (proto && !('__box3dGlStubbed' in proto)) {
  Object.defineProperty(proto, '__box3dGlStubbed', { value: true });
  const original = proto.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: any[]): any {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      return {
        getExtension: () => null,
        getParameter: () => 0,
        getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }),
        createTexture: () => ({}),
        bindTexture: vi.fn(),
        texImage2D: vi.fn(),
        canvas: this,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return original ? (original as any).call(this, type, ...rest) : null;
  };
}
