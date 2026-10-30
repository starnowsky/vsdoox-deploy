import { describe, it, expect } from 'vitest';
import { separateLanes, orthoPath, type Pt } from './routing';

type Edge = { id: string; source: Pt; target: Pt; waypoints: Pt[] };

function pathsOf(edges: Edge[]): Pt[][] {
  return edges.map((e) => orthoPath(e.source, e.waypoints, e.target));
}

describe('separateLanes — вертикальные связи (узлы друг над другом)', () => {
  const source = { x: 100, y: 10 };
  const target = { x: 100, y: 90 };

  it('разводит 2 чисто вертикальные связи на фиксированный отступ', () => {
    const edges: Edge[] = [
      { id: 'e1', source, target, waypoints: [] },
      { id: 'e2', source, target, waypoints: [] },
    ];
    const paths = pathsOf(edges);
    const offsets = separateLanes(paths, 12);
    expect(offsets.size).toBe(2);
    const o1 = offsets.get(0)!;
    const o2 = offsets.get(1)!;
    // Смещения противоположные и симметричные относительно 0.
    expect(o1).toBe(-o2);
    expect(Math.abs(o1 - o2)).toBe(12);
    // Упорядочены: одна влево, другая вправо.
    expect(o1 < 0 && o2 > 0 || o1 > 0 && o2 < 0).toBe(true);
  });

  it('разводит 3 чисто вертикальные связи симметрично (центральная без смещения)', () => {
    const edges: Edge[] = [
      { id: 'e1', source, target, waypoints: [] },
      { id: 'e2', source, target, waypoints: [] },
      { id: 'e3', source, target, waypoints: [] },
    ];
    const paths = pathsOf(edges);
    const offsets = separateLanes(paths, 12);
    const vals = [offsets.get(0), offsets.get(1), offsets.get(2)];
    expect(vals[1]).toBe(0); // центральная — на месте
    expect(vals[0]!).toBe(-12);
    expect(vals[2]!).toBe(12);
  });

  it('порты не смещаются — первая и последняя точка остаются на исходном X', () => {
    const edges: Edge[] = [
      { id: 'e1', source, target, waypoints: [] },
      { id: 'e2', source, target, waypoints: [] },
    ];
    const paths = pathsOf(edges);
    separateLanes(paths, 12);
    for (const p of paths) {
      expect(p[0].x).toBe(source.x);
      expect(p[p.length - 1].x).toBe(target.x);
    }
  });

  it('стабильность: одинаковый вход даёт одинаковые смещения при повторном вызове', () => {
    const edges: Edge[] = [
      { id: 'e1', source, target, waypoints: [] },
      { id: 'e2', source, target, waypoints: [] },
    ];
    const a = separateLanes(pathsOf(edges), 12);
    const b = separateLanes(pathsOf(edges), 12);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('spacing = 0 не смешивает линии', () => {
    const edges: Edge[] = [
      { id: 'e1', source, target, waypoints: [] },
      { id: 'e2', source, target, waypoints: [] },
    ];
    const offsets = separateLanes(pathsOf(edges), 0);
    expect(offsets.size).toBe(0);
  });
});

describe('separateLanes — Z-пути с общим вертикальным коридором', () => {
  // Две Z-связи между одними и теми же узлами — их вертикальные изгибы лежат
  // на одной прямой, должны разойтись по горизонтали.
  it('разводит вертикальные изгибы двух Z-путей', () => {
    const edges: Edge[] = [
      {
        id: 'z1',
        source: { x: 0, y: 50 },
        target: { x: 200, y: 150 },
        waypoints: [],
      },
      {
        id: 'z2',
        source: { x: 0, y: 50 },
        target: { x: 200, y: 150 },
        waypoints: [],
      },
    ];
    const paths = pathsOf(edges);
    const offsets = separateLanes(paths, 12);
    expect(offsets.size).toBe(2);
    const o1 = offsets.get(0)!;
    const o2 = offsets.get(1)!;
    expect(o1).toBe(-o2);
    expect(Math.abs(o1 - o2)).toBe(12);
  });

  it('не разводит линии с разными коридорами (разный средний X)', () => {
    const edges: Edge[] = [
      {
        id: 'z1',
        source: { x: 0, y: 50 },
        target: { x: 200, y: 150 },
        waypoints: [],
      },
      {
        id: 'z2',
        source: { x: 0, y: 50 },
        target: { x: 400, y: 150 }, // другой средний X → другой коридор
        waypoints: [],
      },
    ];
    const paths = pathsOf(edges);
    const offsets = separateLanes(paths, 12);
    // Разные вертикальные коридоры → группы по одной линии → нет смещения.
    expect(offsets.size).toBe(0);
  });

  it('разводит Z-пути между разными парами узлов с общим средним X (общий коридор изгиба)', () => {
    // z1: A(0,0)->B(200,100), midX=100. z2: C(50,20)->D(150,120), midX=100.
    // Вертикальные изгибы обеих линий попадают на x=100 — общий коридор.
    const edges: Edge[] = [
      { id: 'z1', source: { x: 0, y: 0 }, target: { x: 200, y: 100 }, waypoints: [] },
      { id: 'z2', source: { x: 50, y: 20 }, target: { x: 150, y: 120 }, waypoints: [] },
    ];
    const paths = pathsOf(edges);
    const offsets = separateLanes(paths, 12);
    expect(offsets.size).toBe(2);
    const o1 = offsets.get(0)!;
    const o2 = offsets.get(1)!;
    expect(o1).toBe(-o2);
    expect(Math.abs(o1 - o2)).toBe(12);
  });
});
