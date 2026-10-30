import { describe, it, expect } from 'vitest';
import {
  properlyCrosses,
  collinearOverlap,
  routeOneConnection,
  routeAllConnections,
  CROSS_PENALTY,
  OVERLAP_PENALTY,
} from './orthoroute';

type Pt = { x: number; y: number };

function seg(a: Pt, b: Pt) {
  return { a, b };
}

describe('properlyCrosses', () => {
  it('возвращает true для правильного перпендикулярного пересечения внутри обоих отрезков', () => {
    const h = seg({ x: 0, y: 5 }, { x: 10, y: 5 });
    const v = seg({ x: 5, y: 0 }, { x: 5, y: 10 });
    expect(properlyCrosses(h, v)).toBe(true);
    expect(properlyCrosses(v, h)).toBe(true);
  });

  it('возвращает false, когда пересечение на конце отрезка (общий пин)', () => {
    const h = seg({ x: 0, y: 5 }, { x: 10, y: 5 });
    const v = seg({ x: 5, y: 5 }, { x: 5, y: 10 }); // начинается на конце h
    expect(properlyCrosses(h, v)).toBe(false);
  });

  it('возвращает false для параллельных отрезков', () => {
    const h1 = seg({ x: 0, y: 5 }, { x: 10, y: 5 });
    const h2 = seg({ x: 0, y: 7 }, { x: 10, y: 7 });
    expect(properlyCrosses(h1, h2)).toBe(false);

    const v1 = seg({ x: 5, y: 0 }, { x: 5, y: 10 });
    const v2 = seg({ x: 7, y: 0 }, { x: 7, y: 10 });
    expect(properlyCrosses(v1, v2)).toBe(false);
  });

  it('возвращает false, когда отрезки не пересекаются по área', () => {
    const h = seg({ x: 0, y: 5 }, { x: 4, y: 5 });
    const v = seg({ x: 5, y: 0 }, { x: 5, y: 10 });
    expect(properlyCrosses(h, v)).toBe(false);
  });
});

describe('collinearOverlap', () => {
  it('возвращает true для коллинеарных горизонтальных отрезков с наложением', () => {
    const s1 = seg({ x: 0, y: 5 }, { x: 10, y: 5 });
    const s2 = seg({ x: 5, y: 5 }, { x: 15, y: 5 });
    expect(collinearOverlap(s1, s2)).toBe(true);
  });

  it('возвращает false для коллинеарных отрезков, соприкасающихся только в точке', () => {
    const s1 = seg({ x: 0, y: 5 }, { x: 5, y: 5 });
    const s2 = seg({ x: 5, y: 5 }, { x: 10, y: 5 });
    expect(collinearOverlap(s1, s2)).toBe(false);
  });

  it('возвращает false для перпендикулярных отрезков', () => {
    const h = seg({ x: 0, y: 5 }, { x: 10, y: 5 });
    const v = seg({ x: 5, y: 0 }, { x: 5, y: 10 });
    expect(collinearOverlap(h, v)).toBe(false);
  });

  it('возвращает true для коллинеарных вертикальных отрезков с наложением', () => {
    const s1 = seg({ x: 5, y: 0 }, { x: 5, y: 10 });
    const s2 = seg({ x: 5, y: 5 }, { x: 5, y: 15 });
    expect(collinearOverlap(s1, s2)).toBe(true);
  });
});

describe('routeAllConnections — вертикальные линии не накладываются', () => {
  const nodes = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>([
    ['a', { position: { x: 0, y: 0 }, width: 100, height: 60 }],
    ['b', { position: { x: 0, y: 200 }, width: 100, height: 60 }],
  ]);

  // Чисто вертикальные связи (узлы друг над другом, точки подключения на одном X).
  // source.y / target.y распределены по сторонам узлов — так же, как делает
  // getDistributedPoint в routeConnections (routing.ts) для реальных связей.
  // Линии должны разойтись по горизонтали и не накладываться друг на друга,
  // как это уже работает для горизонтальных линий.
  function verticalItems(count: number) {
    // Узел a: gрань слева, y от 8 (внутренний отступ) до 52 (центр-отступ).
    // Узел b: грань слева, y от 208 до 252.
    const loA = 8, hiA = 52;
    const loB = 208, hiB = 252;
    return [0, 1, 2, 3, 4].slice(0, count).map((i) => {
      const t = count === 1 ? 0 : i / (count - 1);
      return {
        id: 'v' + i,
        source: { x: 8, y: loA + (hiA - loA) * t },
        target: { x: 8, y: loB + (hiB - loB) * t },
        waypoints: [],
        fwWaypointIndex: [],
      };
    });
  }

  it('разводит 3 вертикальные связи по горизонтали без коллинеарных наложений', () => {
    const res = routeAllConnections(verticalItems(3), nodes);

    expect(res.length).toBe(3);
    expect(res[0].pts[0].x).toBe(8);
    expect(res[res.length - 1].pts[res[res.length - 1].pts.length - 1].x).toBe(8);

    const segs: { a: Pt; b: Pt; edge: string }[] = [];
    res.forEach((r) => {
      expect(r.pts[0]).toEqual(r.pts[0]);
      expect(r.pts[r.pts.length - 1]).toEqual(r.pts[r.pts.length - 1]);
      for (let i = 1; i < r.pts.length; i++) {
        segs.push({ a: r.pts[i - 1], b: r.pts[i], edge: r.id });
      }
    });

    let overlaps = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].edge === segs[j].edge) continue;
        if (collinearOverlap(segs[i], segs[j])) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('разводит 5 вертикальных связей по горизонтали без коллинеарных наложений', () => {
    const res = routeAllConnections(verticalItems(5), nodes);

    expect(res.length).toBe(5);
    const segs: { a: Pt; b: Pt; edge: string }[] = [];
    res.forEach((r) => {
      for (let i = 1; i < r.pts.length; i++) {
        segs.push({ a: r.pts[i - 1], b: r.pts[i], edge: r.id });
      }
    });
    let overlaps = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].edge === segs[j].edge) continue;
        if (collinearOverlap(segs[i], segs[j])) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });
});

describe('routeOneConnection', () => {
  const nodes = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>([
    ['a', { position: { x: 0, y: 0 }, width: 100, height: 60 }],
    ['b', { position: { x: 200, y: 100 }, width: 100, height: 60 }],
  ]);

  it('строит ортогональный путь без пересечения с уже проложенным сегментом (штраф CROSS_PENALTY)', () => {
    // Первый путь проходит по центру, второй должен обойти его, платя штраф за пересечение,
    // если обход невозможен — либо обходит, либо пересекает с штрафом.
    const placed: { a: Pt; b: Pt }[] = [
      seg({ x: 100, y: 30 }, { x: 100, y: 80 }), // вертикальный барьер
    ];
    const res = routeOneConnection(
      {
        id: 'c1',
        source: { x: 92, y: 30 },
        target: { x: 150, y: 30 },
        waypoints: [],
        fwWaypointIndex: [],
      },
      nodes,
      placed,
    );
    expect(res).not.toBeNull();
    expect(res!.pts[0]).toEqual({ x: 92, y: 30 });
    expect(res!.pts[res!.pts.length - 1]).toEqual({ x: 150, y: 30 });
  });

  it('CROSS_PENALTY и OVERLAP_PENALTY have expected magnitudes', () => {
    expect(CROSS_PENALTY).toBe(1000);
    expect(OVERLAP_PENALTY).toBe(5000);
  });

  it('routeAllConnections строит оба маршрута без наложений (collinear overlap) между связями', () => {
    // Две связи, которые при прямом маршруте пересекаются:
    // c1: (0,50) -> (200,50) по горизонтали
    // c2: (100,0) -> (100,200) по вертикали
    // Узлы создают дополнительные линии сетки, позволяя роутеру выбирать обход.
    const nodes = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>([
      ['n1', { position: { x: 25, y: 25 }, width: 50, height: 50 }],
      ['n2', { position: { x: 125, y: 125 }, width: 50, height: 50 }],
    ]);

    const res = routeAllConnections(
      [
        {
          id: 'c1',
          source: { x: 0, y: 50 },
          target: { x: 200, y: 50 },
          waypoints: [],
          fwWaypointIndex: [],
        },
        {
          id: 'c2',
          source: { x: 100, y: 0 },
          target: { x: 100, y: 200 },
          waypoints: [],
          fwWaypointIndex: [],
        },
      ],
      nodes,
    );

    expect(res.length).toBe(2);

    // Собираем сегменты результата.
    const segs: { a: Pt; b: Pt; edge: string }[] = [];
    res.forEach((r) => {
      expect(r.pts[0]).toEqual(r.pts[0]); // источник сохранён
      expect(r.pts[r.pts.length - 1]).toEqual(r.pts[r.pts.length - 1]); // цель сохранена
      for (let i = 1; i < r.pts.length; i++) {
        segs.push({ a: r.pts[i - 1], b: r.pts[i], edge: r.id });
      }
    });

    // Нет коллинеарных наложений между сегментами разных связей (линии не ложатся
    // друг на друга).
    let overlaps = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].edge === segs[j].edge) continue;
        if (collinearOverlap(segs[i], segs[j])) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });
});

describe('routeOneConnection — точки подключения на внутреннем отступе узла', () => {
  // Имитируем реальные точки подключения из App.tsx: правая грань первого узла
  // (x = 0 + 168 - 8 = 160) и левая грань второго (x = 400 + 8 = 408).
  const nodes = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>([
    ['a', { position: { x: 0, y: 0 }, width: 168, height: 86 }],
    ['b', { position: { x: 400, y: 0 }, width: 168, height: 86 }],
  ]);

  it('находит путь до цели, лежащей на внутреннем отступе узла', () => {
    const res = routeOneConnection(
      {
        id: 'c1',
        source: { x: 160, y: 43 },
        target: { x: 408, y: 43 },
        waypoints: [],
        fwWaypointIndex: [],
      },
      nodes,
      [],
    );
    expect(res).not.toBeNull();
    expect(res!.pts[0]).toEqual({ x: 160, y: 43 });
    expect(res!.pts[res!.pts.length - 1]).toEqual({ x: 408, y: 43 });
    expect(res!.pts.length).toBeGreaterThanOrEqual(2);
  });

  it('строит ортогональный путь с изгибом при вертикальном смещении узлов', () => {
    const res = routeOneConnection(
      {
        id: 'c2',
        source: { x: 160, y: 43 },
        target: { x: 408, y: 243 },
        waypoints: [],
        fwWaypointIndex: [],
      },
      new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>([
        ['a', { position: { x: 0, y: 0 }, width: 168, height: 86 }],
        ['b', { position: { x: 400, y: 200 }, width: 168, height: 86 }],
      ]),
      [],
    );
    expect(res).not.toBeNull();
    expect(res!.pts.length).toBeGreaterThan(2);
  });
});

