import { describe, it, expect, vi } from 'vitest';
import { routeConnections } from './routing';
import type { RouteItem } from './routing';

// Разбирает SVG-путь (строится buildPath в routing.ts) на точки-вершины сегментов.
// Команды M/L задают точки; команда A (мостик) имеет форму
//   A rx ry x-axis-rotation large-arc-flag sweep-flag x y
// где только последние два числа — координата конечной точки дуги.
// Функция игнорирует остальные параметры дуги и не ложит их в список точек.
function parsePathPts(d: string): { x: number; y: number }[] {
  const tokens = d.match(/[MLA]\s*[^MLA]*/g) ?? [];
  const pts: { x: number; y: number }[] = [];
  for (const tok of tokens) {
    const kind = tok[0];
    const nums = tok.slice(1).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    if (kind === 'M' || kind === 'L') {
      // М/L идут парами координат.
      for (let k = 0; k + 1 < nums.length; k += 2) {
        pts.push({ x: nums[k], y: nums[k + 1] });
      }
    } else if (kind === 'A') {
      // A: rx ry rot lf sf x y — конечная точка — последние два числа.
      if (nums.length >= 7) {
        pts.push({ x: nums[nums.length - 2], y: nums[nums.length - 1] });
      }
    }
  }
  return pts;
}


// vi.hmmodule('orthoroute') не нужен — мокируем прямо через vi.doMock,
// но vitest не поддерживает partial mock легко, поэтому мокаем модуль целиком.

vi.mock('./orthoroute', () => ({
  routeAllConnections: vi.fn(() => []),
  routeOneConnection: vi.fn(),
}));

import { routeAllConnections } from './orthoroute';

const nodes = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>(
  [
    ['a', { position: { x: 0, y: 0 }, width: 100, height: 60 }],
    ['b', { position: { x: 200, y: 100 }, width: 100, height: 60 }],
  ],
);

describe('routing — fallback when router returns no path', () => {
  const baseItem: RouteItem = {
    id: 'c1',
    sourceId: 'a',
    targetId: 'b',
    fwIds: [],
    source: { x: 48, y: 30 },
    target: { x: 148, y: 70 },
    waypoints: [],
    sourceSide: 'right',
    targetSide: 'left',
    horizontalPass: true,
  };

  it('строит ортогональную (только горизонталь/вертикаль) линию, если routeAllConnections вернул []', () => {
    (routeAllConnections as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const result = routeConnections([baseItem], nodes);

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c1');
    // Путь — ортогональный (только горизонталь/вертикаль), не диагональ.
    expect(result[0].d.startsWith('M')).toBe(true);
    expect(result[0].d).not.toContain('NaN');
    // labelPos — конечная точка конечного ребра.
    expect(result[0].labelPos.x).toBeGreaterThanOrEqual(0);
    expect(result[0].labelPos.y).toBeGreaterThanOrEqual(0);

    // Разбираем SVG-путь на точки и проверяем, что каждый сегмент
    // горизонтальный или вертикальный (один из осей совпадает).
    const pts = parsePathPts(result[0].d);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pts.length; i++) {
      expect(
        pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y,
        `сегмент ${i} не ортогонален: (${pts[i - 1].x},${pts[i - 1].y}) -> (${pts[i].x},${pts[i].y})`
      ).toBe(true);
    }
  });

  it('корректно обрабатывает несколько связей с пустым путём (все ортогональные)', () => {
    (routeAllConnections as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const result = routeConnections([baseItem, { ...baseItem, id: 'c2' }], nodes);

    expect(result.length).toBe(2);
    expect(result.every((r) => r.d.startsWith('M'))).toBe(true);
    for (const r of result) {
      const pts = parsePathPts(r.d);
      for (let i = 1; i < pts.length; i++) {
        expect(
          pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y,
          `сегмент ${i} не ортогонален: (${pts[i - 1].x},${pts[i - 1].y}) -> (${pts[i].x},${pts[i].y})`
        ).toBe(true);
      }
    }
  });
});
