// ============================================================================
// Orthogonal router based on A* over a sparse grid (Hanan grid).
//
// Builds connection paths with MINIMAL crossings with already-placed segments,
// avoids node interiors, and penalizes overlaps and bends. Used as the core
// pathfinder inside routeConnections (routing.ts).
// ============================================================================

import { Pt, NODE_EDGE_INSET } from './routing';

const EPS = 0.5;

// --- Constants --------------------------------------------------------------

// Зазор между внутренностью узла и «коридором» сетки, чтобы линии могли
// проложиться в щелях между узлами и не ложились на скруглённые углы.
const NODE_PAD = 8; // совпадает с NODE_EDGE_INSET из routing.ts

// Штрафы (веса). Пересечение с уже проложенной линией — сильно undesirable,
// наложение (коллинеарное совпадение сегментов) — ещё хуже.
export const CROSS_PENALTY = 1000; // правильное пересечение с другим сегментом
export const OVERLAP_PENALTY = 5000; // коллинеарное наложение сегментов
export const BEND_PENALTY = 3; // смена направления (чтобы пути не «пилили» лесенкой)

// ============================================================================
// 1. Sparse grid (coordinates)
// ============================================================================

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectFromItem(
  item: { position: { x: number; y: number }; width?: number; height?: number },
): Rect {
  const x = item.position.x;
  const y = item.position.y;
  const w = item.width ?? 150;
  const h = item.height ?? 60;
  return { x, y, w, h };
}

// Уникальные отсортированные координаты по каждой оси: границы узлов (±PAD/INSET)
// плюс все точки подключения / waypoints — в этих колонках/строках строятся пути.
function buildCoords(
  nodes: Map<string, { position: { x: number; y: number }; width?: number; height?: number }>,
  items: Array<{ source: Pt; target: Pt; waypoints: Pt[] }>,
  lanes = 0,
): { xs: number[]; ys: number[] } {
  const xsSet = new Set<number>();
  const ysSet = new Set<number>();

  // Добавляем координаты из узлов (грани + внутренние отступы).
  nodes.forEach((node) => {
    const r = rectFromItem(node);
    xsSet.add(r.x - NODE_PAD);
    xsSet.add(r.x + NODE_PAD);
    xsSet.add(r.x + NODE_EDGE_INSET);
    xsSet.add(r.x + r.w - NODE_EDGE_INSET);
    xsSet.add(r.x + r.w + NODE_PAD);
    ysSet.add(r.y - NODE_PAD);
    ysSet.add(r.y + NODE_PAD);
    ysSet.add(r.y + NODE_EDGE_INSET);
    ysSet.add(r.y + r.h - NODE_EDGE_INSET);
    ysSet.add(r.y + r.h + NODE_PAD);
    // Дополнительные внешние колонки/строки, чтобы чисто вертикальные линии
    // (узлы друг над другом, точки подключения на одном X) могли разойтись
    // по горизонтали и не накладываться друг на друга — как это уже работает
    // для горизонтальных линий через вертикальное распределение точек подключения.
    for (let k = 2; k <= lanes; k++) {
      xsSet.add(r.x - NODE_PAD * k);
      xsSet.add(r.x + r.w + NODE_PAD * k);
      ysSet.add(r.y - NODE_PAD * k);
      ysSet.add(r.y + r.h + NODE_PAD * k);
    }
  });

  // Добавляем координаты всех точек подключения и waypoints.
  items.forEach((it) => {
    const add = (p: Pt) => {
      xsSet.add(p.x);
      ysSet.add(p.y);
    };
    add(it.source);
    add(it.target);
    it.waypoints.forEach(add);
  });

  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);
  return { xs, ys };
}

// ============================================================================
// 2. Obstacles (node interiors)
// ============================================================================

// Рекурсивно размалывает rect на клетки сетки, которые полностью лежат внутри
// прямоугольника узла (со строгим сравнением, EPS-зазор). Эти клетки запрещены
// для прохода. Граница самого узла остаётся доступной — точки подключения лежат
// ровно на ней, и выход наружу из узла не блокируется.
function collectObstacleCells(
  rect: Rect,
  xs: number[],
  ys: number[],
): Set<string> {
  const blocked = new Set<string>();
  const { x, y, w, h } = rect;
  const right = x + w;
  const bottom = y + h;

  for (let i = 0; i < xs.length - 1; i++) {
    const cx1 = xs[i];
    const cx2 = xs[i + 1];
    const cxMid = (cx1 + cx2) / 2;
    // Вертикальная щель между xs[i] и xs[i+1] внутри прямоугольника узла.
    const insideX = cxMid > x + EPS && cxMid < right - EPS;
    if (!insideX) continue;

    for (let j = 0; j < ys.length - 1; j++) {
      const cy1 = ys[j];
      const cy2 = ys[j + 1];
      const cyMid = (cy1 + cy2) / 2;
      const insideY = cyMid > y + EPS && cyMid < bottom - EPS;
      if (!insideY) continue;

      blocked.add(`${i},${j}`);
    }
  }
  return blocked;
}

function buildObstacles(
  nodes: Map<string, { position: { x: number; y: number }; width?: number; height?: number }>,
  xs: number[],
  ys: number[],
): Set<string> {
  const blocked = new Set<string>();
  nodes.forEach((node) => {
    const rect = rectFromItem(node);
    collectObstacleCells(rect, xs, ys).forEach((k) => blocked.add(k));
  });
  return blocked;
}

// ============================================================================
// 3. Segment geometry: crossing vs overlap
// ============================================================================

export interface Seg {
  a: Pt;
  b: Pt;
}

// Абсолютная разница с учётом EPS.
function feq(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

// Правильное пересечение перпендикулярных отрезков (внутри обоих, не на концах).
export function properlyCrosses(s1: Seg, s2: Seg): boolean {
  const h1 = feq(s1.a.y, s1.b.y);
  const h2 = feq(s2.a.y, s2.b.y);
  if (h1 === h2) return false; // обе горизонтальные или обе вертикальные

  const h = h1 ? s1 : s2;
  const v = h1 ? s2 : s1;
  const x = v.a.x;
  const y = h.a.y;
  const hx1 = Math.min(h.a.x, h.b.x);
  const hx2 = Math.max(h.a.x, h.b.x);
  const vy1 = Math.min(v.a.y, v.b.y);
  const vy2 = Math.max(v.a.y, v.b.y);
  // Строго внутри — концевые точки (общие пины) не считаются пересечением.
  return x > hx1 + EPS && x < hx2 - EPS && y > vy1 + EPS && y < vy2 - EPS;
}

// Коллинеарное наложение двух отрезков (накладываются по более чем одной точке).
export function collinearOverlap(s1: Seg, s2: Seg): boolean {
  const h1 = feq(s1.a.y, s1.b.y);
  const h2 = feq(s2.a.y, s2.b.y);
  if (h1 !== h2) return false; // только перпендикулярные не накладываются коллинеарно

  if (h1) {
    // обе горизонтальные: должны быть на одной Y и интервалы по X пересекаться больше чем в точку
    if (!feq(s1.a.y, s2.a.y)) return false;
    const lo = Math.max(Math.min(s1.a.x, s1.b.x), Math.min(s2.a.x, s2.b.x));
    const hi = Math.min(Math.max(s1.a.x, s1.b.x), Math.max(s2.a.x, s2.b.x));
    return hi - lo > EPS;
  } else {
    // обе вертикальные: должны быть на одной X и интервалы по Y пересекаться больше чем в точку
    if (!feq(s1.a.x, s2.a.x)) return false;
    const lo = Math.max(Math.min(s1.a.y, s1.b.y), Math.min(s2.a.y, s2.b.y));
    const hi = Math.min(Math.max(s1.a.y, s1.b.y), Math.max(s2.a.y, s2.b.y));
    return hi - lo > EPS;
  }
}

// ============================================================================
// 4. A* on grid with direction state
// ============================================================================

type Dir = 'none' | 'horizontal' | 'vertical';

function keyOf(i: number, j: number, dir: Dir): string {
  return `${i},${j},${dir}`;
}

// Индекс узла в массиве координат, соответствующего точке p (точка точно входит
// в xs/ys, т.к. мы добавляли все точки подключения и waypoints при построении).
function indexOf(arr: number[], v: number): number {
  // arr отсортирован; ищем точное совпадение (с допуском EPS).
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (feq(arr[mid], v)) return mid;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid - 1;
  }
  // На случай плавающей точки — nearest.
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < arr.length; k++) {
    const d = Math.abs(arr[k] - v);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// Клетка (i,j) — прямоугольник [xs[i], xs[i+1]] × [ys[j], ys[j+1]].
// За пределами сетки препятствий нет.
function isCellBlocked(
  i: number,
  j: number,
  xs: number[],
  ys: number[],
  blocked: Set<string>,
): boolean {
  if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
  return blocked.has(`${i},${j}`);
}

// Соседи узла (i,j): ходы по вертикальным/горизонтальным линиям сетки до
// ближайших соседей по координатам. Каждый ход — отрезок, который мы оцениваем.
//
// Отрезок между соседними точками сетки лежит на границе двух клеток (слева/справа
// для вертикального хода, сверху/снизу для горизонтального). Он запрещён только
// если лежит СТРОГО ВНУТРИ препятствия — то есть обе прилегающие клетки
// заблокированы. Если заблокирована лишь одна — это кромка узла, по которой
// линия может идти (именно там лежат точки подключения на внутреннем отступе).
function neighbors(
  i: number,
  j: number,
  xs: number[],
  ys: number[],
  blocked: Set<string>,
  placed: Seg[],
): Array<{ ni: number; nj: number; dir: Dir; seg: Seg; cost: number }> {
  const res: Array<{ ni: number; nj: number; dir: Dir; seg: Seg; cost: number }> = [];
  const x = xs[i];
  const y = ys[j];

  // Вверх / вниз (вертикальный ход) вдоль x = xs[i].
  for (const [nj, dir] of [
    [j - 1, 'vertical'] as const,
    [j + 1, 'vertical'] as const,
  ]) {
    if (nj < 0 || nj >= ys.length) continue;
    const k = Math.min(j, nj); // строка, которую пересекает вертикальный отрезок
    const leftBlocked = isCellBlocked(i - 1, k, xs, ys, blocked);
    const rightBlocked = isCellBlocked(i, k, xs, ys, blocked);
    if (leftBlocked && rightBlocked) continue;
    const seg: Seg = { a: { x, y }, b: { x, y: ys[nj] } };
    let cost = Math.abs(ys[nj] - y);
    placed.forEach((s) => {
      if (properlyCrosses(seg, s)) cost += CROSS_PENALTY;
      if (collinearOverlap(seg, s)) cost += OVERLAP_PENALTY;
    });
    res.push({ ni: i, nj, dir, seg, cost });
  }

  // Влево / вправо (горизонтальный ход) вдоль y = ys[j].
  for (const [ni, dir] of [
    [i - 1, 'horizontal'] as const,
    [i + 1, 'horizontal'] as const,
  ]) {
    if (ni < 0 || ni >= xs.length) continue;
    const k = Math.min(i, ni); // колонка, которую пересекает горизонтальный отрезок
    const aboveBlocked = isCellBlocked(k, j - 1, xs, ys, blocked);
    const belowBlocked = isCellBlocked(k, j, xs, ys, blocked);
    if (aboveBlocked && belowBlocked) continue;
    const seg: Seg = { a: { x, y }, b: { x: xs[ni], y } };
    let cost = Math.abs(xs[ni] - x);
    placed.forEach((s) => {
      if (properlyCrosses(seg, s)) cost += CROSS_PENALTY;
      if (collinearOverlap(seg, s)) cost += OVERLAP_PENALTY;
    });
    res.push({ ni, nj: j, dir, seg, cost });
  }

  return res;
}

function aStarPath(
  startIdx: { i: number; j: number },
  goalIdx: { i: number; j: number },
  xs: number[],
  ys: number[],
  blocked: Set<string>,
  placed: Seg[],
): Pt[] | null {
  const startKey = keyOf(startIdx.i, startIdx.j, 'none');
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([
    [
      startKey,
      Math.abs(xs[startIdx.i] - xs[goalIdx.i]) +
        Math.abs(ys[startIdx.j] - ys[goalIdx.j]),
    ],
  ]);
  const cameFrom = new Map<string, { pi: number; pj: number; pdir: Dir }>();

  // Оптимистичная очередь (маленькие графы — линейный scan приемлем).
  type PQItem = { f: number; i: number; j: number; dir: Dir };
  const open: PQItem[] = [{ f: fScore.get(startKey)!, i: startIdx.i, j: startIdx.j, dir: 'none' }];
  const closed = new Set<string>();

  while (open.length > 0) {
    // Извлекаем минимум f.
    let bestIdx = 0;
    for (let k = 1; k < open.length; k++) {
      if (open[k].f < open[bestIdx].f) bestIdx = k;
    }
    const cur = open.splice(bestIdx, 1)[0];
    const curKey = keyOf(cur.i, cur.j, cur.dir);
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (cur.i === goalIdx.i && cur.j === goalIdx.j) {
      // Реконструируем путь по cameFrom.
      const path: Pt[] = [];
      let ci = cur.i;
      let cj = cur.j;
      path.push({ x: xs[ci], y: ys[cj] });
      let k = keyOf(ci, cj, cur.dir);
      while (cameFrom.has(k)) {
        const prev = cameFrom.get(k)!;
        ci = prev.pi;
        cj = prev.pj;
        path.push({ x: xs[ci], y: ys[cj] });
        k = keyOf(ci, cj, prev.pdir);
      }
      path.reverse();
      return path;
    }

    for (const nb of neighbors(cur.i, cur.j, xs, ys, blocked, placed)) {
      const nbKey = keyOf(nb.ni, nb.nj, nb.dir);
      if (closed.has(nbKey)) continue;
      const tentativeG = gScore.get(curKey)! + nb.cost;
      // Штраф за поворот: если направление менялось и не было 'none'.
      const turnPenalty =
        cur.dir !== 'none' && cur.dir !== nb.dir ? BEND_PENALTY : 0;
      const g2 = tentativeG + turnPenalty;
      const oldG = gScore.get(nbKey);
      if (oldG === undefined || g2 < oldG) {
        gScore.set(nbKey, g2);
        const h =
          Math.abs(xs[nb.ni] - xs[goalIdx.i]) + Math.abs(ys[nb.nj] - ys[goalIdx.j]);
        fScore.set(nbKey, g2 + h);
        cameFrom.set(nbKey, { pi: cur.i, pj: cur.j, pdir: cur.dir });
        open.push({ f: g2 + h, i: nb.ni, j: nb.nj, dir: nb.dir });
      }
    }
  }
  return null;
}

// Упрощаем полилайн: склеиваем коллинеарные подряд идущие сегменты.
function simplifyPath(path: Pt[]): Pt[] {
  if (path.length <= 2) return path;
  const res: Pt[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = res[res.length - 1];
    const cur = path[i];
    const next = path[i + 1];
    const d1x = cur.x - prev.x;
    const d1y = cur.y - prev.y;
    const d2x = next.x - cur.x;
    const d2y = next.y - cur.y;
    // Пропускаем cur, если prev->cur->next коллинеарны (одно направление).
    if ((feq(d1x, 0) && feq(d2x, 0)) || (feq(d1y, 0) && feq(d2y, 0))) continue;
    res.push(cur);
  }
  res.push(path[path.length - 1]);
  return res;
}

// ============================================================================
// 5. Public API: route one connection (multi-leg through firewalls)
// ============================================================================

export interface RouteRequest {
  id: string;
  source: Pt;
  target: Pt;
  waypoints: Pt[];
  // waypoint pair ownership: for each waypoint index, which firewall it belongs to.
  // When two consecutive waypoints belong to the SAME firewall (entry+exit), the
  // leg between them is routed as a straight segment through that firewall.
  fwWaypointIndex: number[]; // same length as waypoints; fwWaypointIndex[k] = firewall ordinal for waypoint k
}

export interface RouteResult {
  id: string;
  pts: Pt[]; // упрощённый ортогональный полилайн source..target
  segs: Seg[]; // сегменты итогового пути (для учёта в placed)
}

// Маршрутизирует одну связь по сетке с учётом уже размещённых сегментов placed.
// Возвращает null, если путь не найден (теоретически невозможно при достаточном PAD).
export function routeOneConnection(
  req: RouteRequest,
  nodes: Map<string, { position: { x: number; y: number }; width?: number; height?: number }>,
  placed: Seg[],
  lanes = 0,
): RouteResult | null {
  const { xs, ys } = buildCoords(nodes, [req], lanes);
  const blocked = buildObstacles(nodes, xs, ys);

  const pts: Pt[] = [req.source];
  const allSegs: Seg[] = [];

  const pins: Pt[] = [req.source, ...req.waypoints, req.target];
  // fwId для каждого пина: source/target — -1 (не МЭ), waypoints — индекс МЭ.
  const pinFw: number[] = [-1, ...req.fwWaypointIndex.map(() => -1), -1];
  // заполним корректно: waypoints идут между source и target
  for (let k = 0; k < req.waypoints.length; k++) {
    pinFw[k + 1] = req.fwWaypointIndex[k];
  }

  for (let leg = 0; leg < pins.length - 1; leg++) {
    const p0 = pins[leg];
    const p1 = pins[leg + 1];
    const fw0 = pinFw[leg];
    const fw1 = pinFw[leg + 1];

    // Принудительный прямой отрезок: вход и выход одного и того же МЭ.
    if (fw0 !== -1 && fw0 === fw1) {
      // Создаём ортогональный L-образный путь: горизонталь, затем вертикаль (или наоборот),
      // выбираем вариант с меньшей стоимостью пересечений с placed.
      const cand1: Pt[] = [p0, { x: p1.x, y: p0.y }, p1];
      const cand2: Pt[] = [p0, { x: p0.x, y: p1.y }, p1];
      const cost = (path: Pt[]) => {
        let c = 0;
        for (let i = 1; i < path.length; i++) {
          const seg: Seg = { a: path[i - 1], b: path[i] };
          c += Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
          placed.forEach((s) => {
            if (properlyCrosses(seg, s)) c += CROSS_PENALTY;
            if (collinearOverlap(seg, s)) c += OVERLAP_PENALTY;
          });
        }
        return c;
      };
      const chosen = cost(cand1) <= cost(cand2) ? cand1 : cand2;
      for (let i = 1; i < chosen.length; i++) {
        pts.push(chosen[i]);
        allSegs.push({ a: chosen[i - 1], b: chosen[i] });
      }
      continue;
    }

    // Иначе — A* по сетке (узлы — препятствия).
    const si = indexOf(xs, p0.x);
    const sj = indexOf(ys, p0.y);
    const gi = indexOf(xs, p1.x);
    const gj = indexOf(ys, p1.y);
    const path = aStarPath({ i: si, j: sj }, { i: gi, j: gj }, xs, ys, blocked, placed);
    if (!path) return null;

    // Добавляем промежуточные точки (без дублирования первой, она уже в pts).
    for (let i = 1; i < path.length; i++) {
      pts.push(path[i]);
    }
  }

  const simple = simplifyPath(pts);
  // Пересчитаем сегменты упрощённого пути.
  const segs: Seg[] = [];
  for (let i = 1; i < simple.length; i++) {
    segs.push({ a: simple[i - 1], b: simple[i] });
  }
  return { id: req.id, pts: simple, segs };
}

// Сколько внешних «лейнов» нужно добавить в сетку, чтобы параллельные
// вертикальные линии (узлы друг над другом, точки подключения на одном X)
// могли разойтись по горизонтали и не накладывались друг на друга — как это
// уже работает для горизонтальных линий (точки подключения распределяются
// по вертикали, а вертикальные нуждаются в разводе по горизонтали).
// Считаем максимум по «чисто вертикальным» коридорам (source.x ≈ target.x)
// и возвращаем число дополнительных колонок с каждой стороны (0 — если нет
// таких групп или группа из одной линии).
function computeLaneCount(reqs: RouteRequest[]): number {
  const EPS2 = 0.5;
  const key = (n: number) => String(Math.round(n * 2));
  const groups = new Map<string, number>();
  for (const r of reqs) {
    if (Math.abs(r.source.x - r.target.x) <= EPS2) {
      const k = 'v:' + key(r.source.x);
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
  }
  let max = 0;
  for (const n of groups.values()) max = Math.max(max, n);
  return Math.max(0, max - 1);
}

// ============================================================================
// 6. Batch routing: order connections, route incrementally, accumulate placed
// ============================================================================

export interface RoutedConnection {
  id: string;
  pts: Pt[];
  segs: Seg[];
}

// Порядок: сначала короткие/простые (меньше waypoints, меньше манхэттенского
// расстояния), затем по исходному индексу — детерминированно.
export function routeAllConnections(
  reqs: RouteRequest[],
  nodes: Map<string, { position: { x: number; y: number }; width?: number; height?: number }>,
): RoutedConnection[] {
  const order = reqs
    .map((req, idx) => ({ req, idx }))
    .sort((a, b) => {
      const da = Math.abs(a.req.target.x - a.req.source.x) + Math.abs(a.req.target.y - a.req.source.y);
      const db = Math.abs(b.req.target.x - b.req.source.x) + Math.abs(b.req.target.y - b.req.source.y);
      if (da !== db) return da - db;
      if (a.req.waypoints.length !== b.req.waypoints.length)
        return a.req.waypoints.length - b.req.waypoints.length;
      return a.idx - b.idx;
    });

  const placed: Seg[] = [];
  const results = new Map<string, RoutedConnection>();
  const lanes = computeLaneCount(reqs);

  for (const { req } of order) {
    const res = routeOneConnection(req, nodes, placed, lanes);
    if (res) {
      placed.push(...res.segs);
      results.set(req.id, res);
    }
  }

  // Возвращаем в исходном порядке reqs; пропускаем те, что не получилось.route.
  return reqs.map((r) => results.get(r.id)!).filter(Boolean);
}





