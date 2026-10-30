// Ортогональная маршрутизация рёбер связей:
// - параллельные линии со смещением (не накладываются друг на друга);
// - «мостики» (дуги) в местах пересечения линий.

export interface Pt {
  x: number;
  y: number;
}

export interface RouteItem {
  id: string;
  sourceId: string;
  targetId: string;
  fwIds: string[];
  source: Pt;
  waypoints: Pt[];
  target: Pt;
  sourceSide: string;
  targetSide: string;
  horizontalPass: boolean;
}

export const HANDLE_GAP = 12; // gap between connection points on same node side
export const NODE_EDGE_INSET = 8; // отступ линии внутрь узла от границы, чтобы не ложиться на скруглённые углы

// Константы расстояния для адаптивной толщины линий (в пикселях)
export const MIN_CONN_DIST = 30;
export const MID_CONN_DIST = 120;
export const MAX_CONN_DIST = 300;

// Константа толщины линии (в пикселях) - используется для зазора между параллельными линиями и радиуса мостиков
export const LINE_WIDTH = 2;

// Настраиваемый отступ между параллельными линиями одного коридора (в пикселях).
// Может быть переопределён через параметр spacing routeConnections — по умолчанию
// используется эта константа. 12 px ≈ 5–6 толщин линии, достаточно чтобы линии не
// сливались визуально, но не так много, чтобы раздувать схему.
export const EDGE_SPACING = 12;

// Find nearest point on rectangle boundary to a target point.
// Returns the point on the closest side (top/right/bottom/left) — the clamped
// projection of the target onto that side — so lines terminate at the nearest
// boundary port instead of the node centre or a corner.
export function nearestBoundaryPoint(
  node: { position: { x: number; y: number }; width?: number; height?: number },
  target: { x: number; y: number },
): { x: number; y: number; side: 'top' | 'right' | 'bottom' | 'left' } {
  const nx = node.position.x;
  const ny = node.position.y;
  const h = node.height ?? 60;
  const w = node.width ?? 150;
  const cx = nx + w / 2;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const dx = target.x - cx;

  // Соединяемся только с боковыми сторонами (левой/правой), независимо от
  // вертикального смещения цели. Верх/низ больше не используются.
  // Точка подключения сдвинута внутрь на NODE_EDGE_INSET, чтобы линия не «висела»
  // на скруглённом углу фигуры, а начиналась чуть ближе к центру узла.
  if (dx > 0) {
    return {
      x: nx + w - NODE_EDGE_INSET,
      y: clamp(target.y, ny + NODE_EDGE_INSET, ny + h - NODE_EDGE_INSET),
      side: 'right',
    };
  }
  return {
    x: nx + NODE_EDGE_INSET,
    y: clamp(target.y, ny + NODE_EDGE_INSET, ny + h - NODE_EDGE_INSET),
    side: 'left',
  };
}

// Вычисляет толщину линии соединения на основе расстояния между объектами.
// Возвращает толщину в пикселях.
export function getLineWidthForConnection(source: Pt, target: Pt): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= MIN_CONN_DIST) {
    return 1; // Толщина 1px при близком расположении узлов
  } else if (distance >= MAX_CONN_DIST) {
    return 2; // Толщина 2px при удалении
  } else {
    // Интерполяция между 1 и 2px в зависимости от расстояния
    const normalizedDist = (distance - MIN_CONN_DIST) / (MAX_CONN_DIST - MIN_CONN_DIST);
    return 1 + normalizedDist; // Возвращает значение между 1 и 2
  }
}

// Get connection point with tangential distribution along node side
function getDistributedPoint(
  node: { position: { x: number; y: number }; width?: number; height?: number },
  side: 'top' | 'right' | 'bottom' | 'left',
  count: number,
  index: number,
): { x: number; y: number } {
  const nx = node.position.x;
  const ny = node.position.y;
  const w = node.width ?? 150;
  const h = node.height ?? 60;

  // Fixed coordinate on the chosen side (x for left/right, y for top/bottom),
  // pulled inside NODE_EDGE_INSET so lines leave the flat edge, not the corner.
  let fixedX = nx + w / 2;
  let fixedY = ny + h / 2;
  let lo: number;
  let hi: number;
  if (side === 'left') {
    fixedX = nx + NODE_EDGE_INSET;
    lo = ny + NODE_EDGE_INSET;
    hi = ny + h - NODE_EDGE_INSET;
    fixedY = (lo + hi) / 2;
  } else if (side === 'right') {
    fixedX = nx + w - NODE_EDGE_INSET;
    lo = ny + NODE_EDGE_INSET;
    hi = ny + h - NODE_EDGE_INSET;
    fixedY = (lo + hi) / 2;
  } else if (side === 'top') {
    fixedY = ny + NODE_EDGE_INSET;
    lo = nx + NODE_EDGE_INSET;
    hi = nx + w - NODE_EDGE_INSET;
    fixedX = (lo + hi) / 2;
  } else {
    // bottom
    fixedY = ny + h - NODE_EDGE_INSET;
    lo = nx + NODE_EDGE_INSET;
    hi = nx + w - NODE_EDGE_INSET;
    fixedX = (lo + hi) / 2;
  }
  if (hi < lo) hi = lo;

  if (count <= 1) return { x: fixedX, y: fixedY };

  // Распределение по всей высоте стороны с центром в середине.
  // Первая линия в центре, каждая следующая смещается на HANDLE_GAP;
  // если места не хватает, шаг сжимается, чтобы линии заняли всю
  // вертикальную поверхность [lo, hi] и не наслаивались друг на друга.
  const center = (lo + hi) / 2;
  const natural = Math.max(0, count - 1) * HANDLE_GAP;
  const available = hi - lo;
  const gap = natural > available && count > 1 ? available / (count - 1) : HANDLE_GAP;
  const offset = (index - Math.max(0, count - 1) / 2) * gap;
  const v = Math.max(lo, Math.min(hi, center + offset));

  if (side === 'left' || side === 'right') {
    return { x: fixedX, y: v };
  }
  return { x: v, y: fixedY };
}

const R = LINE_WIDTH * 2; // радиус «мостика» на пересечении

// Ортогональный путь source..target с вертикальными и горизонтальными сегментами.
// - `lane` сдвигает внутренний вертикальный изгиб ( середина по X ) по горизонтали,
//   чтобы изгибы параллельных линий не накладывались.
// - Конечные точки (source, target) остаются приклеенными к портам/анкорам узлов.
// - Если источник и цель лежат на одной вертикали (source.x === target.x), путь
  // не заламывается в точку цели, а делает U-джог наружу: short horizontal step,
// vertical, short horizontal step. Это даёт отдельный вертикальный коридор для
// каждой линии, который затем разводится separateLanes.
export function orthoPath(source: Pt, waypoints: Pt[], target: Pt, lane = 0): Pt[] {
  const pts: Pt[] = [source, ...waypoints, target];
  const path: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) {
    const a = path[path.length - 1];
    const b = pts[i];
    if (a.x === b.x) {
      // Чисто вертикальный переход. Не патчим сразу: для чисто вертикального всего
      // пути (source.x === target.x) вертикальный сегмент будет разведён позже
      // через separateLanes (U-образный джог добавит горизонтальные кронштейны).
      if (a.y !== b.y) path.push({ x: b.x, y: b.y });
    } else {
      const midX = (a.x + b.x) / 2 + lane;
      path.push({ x: midX, y: a.y });
      if (a.y !== b.y) path.push({ x: midX, y: b.y });
      path.push({ x: b.x, y: b.y });
    }
  }
  return path;
}



// Сегмент ортогонального пути. Построен для выявления совпадающих (коллинеарных)
// коридоров и разведения параллельных линий.
export interface Seg {
  edgeIndex: number;
  segIndex: number;
  a: Pt;
  b: Pt;
  orientation: 'h' | 'v'; // 'h' — горизонтальный (a.y === b.y), 'v' — вертикальный
  fixed: number;          // константная координата: Y для 'h', X для 'v'
  lo: number;             // минимум по вертикальной оси
  hi: number;             // максимум по вертикальной оси
}

function makeSeg(edgeIndex: number, segIndex: number, a: Pt, b: Pt): Seg {
  const horizontal = a.y === b.y;
  const orientation = horizontal ? 'h' : 'v';
  return {
    edgeIndex,
    segIndex,
    a,
    b,
    orientation,
    fixed: horizontal ? a.y : a.x,
    lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
    hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
  };
}

function crossing(s1: Seg, s2: Seg): Pt | null {
  const h1 = s1.a.y === s1.b.y;
  const h2 = s2.a.y === s2.b.y;
  if (h1 === h2) return null; // обе горизонтальные или обе вертикальные — не пересекаются
  const h = h1 ? s1 : s2;
  const v = h1 ? s2 : s1;
  const x = v.a.x;
  const y = h.a.y;
  const hx1 = Math.min(h.a.x, h.b.x);
  const hx2 = Math.max(h.a.x, h.b.x);
  const vy1 = Math.min(v.a.y, v.b.y);
  const vy2 = Math.max(v.a.y, v.b.y);
  if (x > hx1 && x < hx2 && y > vy1 && y < vy2) return { x, y };
  return null;
}

const round = (v: number): number => Math.round(v * 10) / 10;

interface Bridge {
  segIndex: number;
  x: number;
  y: number;
}

function buildPath(path: Pt[], bridges: Bridge[]): string {
  let d = `M ${round(path[0].x)},${round(path[0].y)}`;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const horizontal = a.y === b.y;
    const dir = horizontal ? (a.x <= b.x ? 1 : -1) : (a.y <= b.y ? 1 : -1);
    const segBridges = bridges
      .filter((br) => br.segIndex === i - 1)
      .sort((p, q) => dir * (horizontal ? p.x - q.x : p.y - q.y));
    if (segBridges.length === 0) {
      d += ` L ${round(b.x)},${round(b.y)}`;
      continue;
    }
    let cur = a;
    for (const br of segBridges) {
      const sweep = dir === 1 ? 1 : 0;
      if (horizontal) {
        const t = br.x;
        d += ` L ${round(t - dir * R)},${round(cur.y)}`;
        d += ` A ${R} ${R} 0 0 ${sweep} ${round(t + dir * R)},${round(cur.y)}`;
        cur = { x: t + dir * R, y: cur.y };
      } else {
        const t = br.y;
        d += ` L ${round(cur.x)},${round(t - dir * R)}`;
        d += ` A ${R} ${R} 0 0 ${sweep} ${round(cur.x)},${round(t + dir * R)}`;
        cur = { x: cur.x, y: t + dir * R };
      }
    }
    d += ` L ${round(b.x)},${round(b.y)}`;
  }
  return d;
}

function midpointAlongPath(path: Pt[]): Pt {
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    lens.push(l);
    total += l;
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    if (acc + lens[i] >= half) {
      const t = lens[i] === 0 ? 0 : (half - acc) / lens[i];
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t,
      };
    }
    acc += lens[i];
  }
  return path[path.length - 1];
}

export function routeConnections(
  items: RouteItem[],
  nodes: Map<string, { position: { x: number; y: number }; width?: number; height?: number }>
): Array<{ id: string; d: string; labelPos: Pt }> {
  // --- 1. Determine the boundary side for every endpoint (nearest point) ---
  // This must happen before grouping, because distribution is per (node, side):
  // lines leaving the same node on different sides must not share an index.
  type Side = 'top' | 'right' | 'bottom' | 'left';
  const endpointSides: { sourceSide: Side; targetSide: Side }[] = items.map((it) => {
    const sourceNode = nodes.get(it.sourceId);
    const targetNode = nodes.get(it.targetId);
    const sourceSide = sourceNode
      ? nearestBoundaryPoint(sourceNode, it.target).side
      : (it.sourceSide as Side);
    const targetSide = targetNode
      ? nearestBoundaryPoint(targetNode, it.source).side
      : (it.targetSide as Side);
    return { sourceSide, targetSide };
  });

  // --- 2. Group by (node, side), merging source and target ends together.
  // This makes a line A→B and the reverse line B→A share the same side-group
  // on each node, so their connection points spread vertically instead of
  // collapsing onto the centre point of the side.
  interface EndpointRef {
    itemIndex: number;
    end: 'source' | 'target';
    sortKey: number; // y of the opposite end — spatial order for deterministic lanes
  }

  const sideGroups = new Map<string, EndpointRef[]>();
  items.forEach((it, i) => {
    const sKey = `${it.sourceId}:${endpointSides[i].sourceSide}`;
    const tKey = `${it.targetId}:${endpointSides[i].targetSide}`;
    if (!sideGroups.has(sKey)) sideGroups.set(sKey, []);
    if (!sideGroups.has(tKey)) sideGroups.set(tKey, []);
    sideGroups.get(sKey)!.push({ itemIndex: i, end: 'source', sortKey: it.target.y });
    sideGroups.get(tKey)!.push({ itemIndex: i, end: 'target', sortKey: it.source.y });
  });

  // Deterministic ordering: spatial (by opposite end) + tie-break by item index.
  const distIndex = new Map<string, { count: number; index: number }>();
  for (const refs of sideGroups.values()) {
    refs.sort((a, b) => a.sortKey - b.sortKey || a.itemIndex - b.itemIndex);
    refs.forEach((ref, j) => {
      distIndex.set(`${ref.itemIndex}:${ref.end}`, { count: refs.length, index: j });
    });
  }

  // Apply tangential distribution to source/target points
  const distributedItems = items.map((it, i) => {
    const sourceNode = nodes.get(it.sourceId);
    const targetNode = nodes.get(it.targetId);
    const { sourceSide, targetSide } = endpointSides[i];

    let newSource = it.source;
    let newTarget = it.target;
    let newSourceSide = it.sourceSide as Side;
    let newTargetSide = it.targetSide as Side;

    if (sourceNode) {
      const info = distIndex.get(`${i}:source`);
      if (info) {
        const distributed = getDistributedPoint(sourceNode, sourceSide, info.count, info.index);
        newSource = { x: distributed.x, y: distributed.y };
        newSourceSide = sourceSide;
      }
    }

    if (targetNode) {
      const info = distIndex.get(`${i}:target`);
      if (info) {
        const distributed = getDistributedPoint(targetNode, targetSide, info.count, info.index);
        newTarget = { x: distributed.x, y: distributed.y };
        newTargetSide = targetSide;
      }
    }

    return { ...it, source: newSource, target: newTarget, sourceSide: newSourceSide, targetSide: newTargetSide };
  });

  // Направление прохода берётся из RouteItem (рассчитано в App.tsx из центров узлов),
  // чтобы не расходиться с осью, по которой уже построены waypoints.
  const passH = distributedItems.map((it) => it.horizontalPass);

  // Лейны: линии, проходящие через один и тот же МСЭ, разводим, чтобы не ложились друг на друга.
  const fwGroups = new Map<string, number[]>();
  distributedItems.forEach((it, i) => {
    it.fwIds.forEach((fwId) => {
      if (!fwGroups.has(fwId)) fwGroups.set(fwId, []);
      fwGroups.get(fwId)!.push(i);
    });
  });
  const laneMap = new Map<string, number>();
  // Перпендикулярная координата «коридора» линии — ось, по которой
  // разводятся лейны у МСЭ. Горизонтальный проход → середина по Y,
  // вертикальный проход → середина по X.
  const corridorKey = (it: RouteItem): number =>
    it.horizontalPass ? (it.source.y + it.target.y) / 2 : (it.source.x + it.target.x) / 2;

  for (const [fwId, lines] of fwGroups) {
    // Линии по одному маршруту (через один и тот же МСЭ) должны получать
    // лейны в пространственном порядке, а не в порядке вставки в массив
    // connections — иначе при «обратном» порядке добавления связей линии
    // сходятся и пересекаются. Тай-брейк по индексу делает порядок детерминированным.
    const sorted = [...lines].sort(
      (a, b) =>
        corridorKey(distributedItems[a]) - corridorKey(distributedItems[b]) || a - b
    );
    const n = sorted.length;
    sorted.forEach((lineIdx, j) => {
      laneMap.set(`${lineIdx}:${fwId}`, (j - (n - 1) / 2) * EDGE_SPACING);
    });
  }

  const adjusted = distributedItems.map((it, i) => {
    const h = passH[i];
    return it.waypoints.map((wp, k) => {
      const fwId = it.fwIds[Math.floor(k / 2)];
      const lane = laneMap.get(`${i}:${fwId}`) ?? 0;
      if (h) return { x: wp.x, y: wp.y + lane };
      return { x: wp.x + lane, y: wp.y };
    });
  });

  // ---- LANE SEPARATION: разводят параллельные линии одного коридора ----
  // Строим базовые пути (без разведения), затем ищем сегменты, лежащие на одной
  // прямой (совпадающий коридор), группируем их в связные «пучки» и сдвигаем
  // каждый член пучка на фиксированный перпендикулярный отступ. Порты (source,
  // target) не трогаем — смещение применяется только к промежуточным точкам излома.
  // Смещение стабильно: порядок полос задаётся пространственной координатой якоря
  // с тай-брейком по индексу ребра, а sign определяется направлением потока,
  // поэтому при перетаскивании/перерисовке полосы не «прыгают».
  const spacing = EDGE_SPACING;
  const basePaths = distributedItems.map((it, i) =>
    orthoPath(it.source, adjusted[i], it.target, bendCorridor(it))
  );

  const laneOffsets = separateLanes(basePaths, spacing);

  // Применяем вычисленные смещения, сохраняя ортогональность и не трогая порты.
  // Смещение считается по X (вертикальные пучки разводятся горизонтально);
  // горизонтальные параллельные линии уже разводятся через тангенциальное
  // распределение точек подключения (getDistributedPoint).
  //
  // - Чисто вертикальная связь (source.x === target.x, один вертикальный сегмент):
  //   разводим U-образно — два горизонтальных кронштейна у портов + вертикаль между ними.
  //   Порты остаются привязаны к узлам.
  // - Z-образный путь (source → изгиб → цель): сдвигаем все ВНУТРЕННИЕ точки излома
  //   по X на off — вертикальный изгиб уходит в свою полосу, а горизонтальные
  //   сегменты к портам остаются ортогональными.
  const paths = basePaths.map((path, i) => {
    const off = laneOffsets.get(i) ?? 0;
    if (!off) return path;
    const sign = off > 0 ? 1 : -1;
    const dx = Math.abs(off);
    const p0 = path[0];
    const pLast = path[path.length - 1];
    // Чисто вертикальная связь — U-джог.
    if (path.length === 2 && p0.x === pLast.x) {
      return [
        p0,
        { x: p0.x + sign * dx, y: p0.y },
        { x: pLast.x + sign * dx, y: pLast.y },
        pLast,
      ];
    }
    // Z-образный путь — сдвигаем внутренние точки излома по X.
    return path.map((p, k) => {
      if (k === 0 || k === path.length - 1) return p;
      return { x: p.x + sign * dx, y: p.y };
    });
  });

  // Сегменты всех разведённых линий — для поиска пересечений (мостиков).
  const segs: Seg[] = [];
  paths.forEach((path, edgeIndex) => {
    for (let segIndex = 0; segIndex < path.length - 1; segIndex++) {
      segs.push(makeSeg(edgeIndex, segIndex, path[segIndex], path[segIndex + 1]));
    }
  });

  // «Мостики»: более новая линия «перепрыгивает» через более старую.
  const bridges: Bridge[][] = distributedItems.map(() => []);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.edgeIndex === s2.edgeIndex) continue;
      const p = crossing(s1, s2);
      if (!p) continue;
      const newer = s1.edgeIndex > s2.edgeIndex ? s1 : s2;
      bridges[newer.edgeIndex].push({ segIndex: newer.segIndex, x: p.x, y: p.y });
    }
  }

  return paths.map((path, i) => ({
    id: distributedItems[i].id,
    d: buildPath(path, bridges[i]),
    labelPos: midpointAlongPath(path),
  }));
}

// Коридор вертикального изгиба линии — середина по X между источником и целью.
// Линии с одинаковым коридором получат разные лейны. Округление до 0.5px — защита
// от шума плавающей точки.
function bendCorridor(it: RouteItem): number {
  return Math.round(((it.source.x + it.target.x) / 2) * 2);
}

// Направление потока линии по общему вектору source→target: +1 (вниз/вправо) или -1.
// Используется, чтобы знаки смещений у параллельных линий согласовывались и не
// перекручивались при отрисовке.
function flowDirection(seg: Seg, paths: Pt[][]): 1 | -1 {
  const path = paths[seg.edgeIndex];
  if (path.length < 2) return 1;
  const p0 = path[0];
  const pLast = path[path.length - 1];
  const dx = pLast.x - p0.x;
  const dy = pLast.y - p0.y;
  if (seg.orientation === 'v') return dy >= 0 ? 1 : -1;
  return dx >= 0 ? 1 : -1;
}

// Находит совпадающие коллинеарные сегменты (общий коридор) и возвращает
// смещение (в пикселях) для каждого ребра.
//
// Группировка:
//   1. Ключ коридора = ориентация + фиксированная координата, округлённая до 0.5px.
//      Сегменты одной прямой попадают в один ключ.
//   2. Внутри ключа сегменты сортируются по интервалу [lo, hi] вдоль оси.
//   3. Транзитивное замыкание по пересечению интервалов → «пучок» (bundle).
//      Внутри пучка линии идут параллельно по совпадающему участку — их и разводим.
//   4. Внутри пучка порядок полос стабилен: сортировка по перпендикулярной
//      координате якоря (для вертикальных — y верхнего конца, для горизонтальных —
//      x левого конца), тай-брейк по индексу ребра. Знак смещения корректируется
//      направлением потока (dx/dy), чтобы параллельные линии не перекрещивались.
//   5. Смещение члена пучка с индексом j из n: (j - (n-1)/2) * spacing.
//
// Порты (source/target) не смещаются: applyLaneOffsets сдвигает только внутренние
// точки излома.
export function separateLanes(
  paths: Pt[][],
  spacing: number = EDGE_SPACING
): Map<number, number> {
  const offsets = new Map<number, number>();
  if (spacing <= 0) return offsets;

  // --- 1. Коридоры: ключ → список сегментов ---------------------------------
  const keyOf = (s: Seg): string => `${s.orientation}:${Math.round(s.fixed * 2)}`;
  const corridors = new Map<string, Seg[]>();
  paths.forEach((path, edgeIndex) => {
    for (let segIndex = 0; segIndex < path.length - 1; segIndex++) {
      const s = makeSeg(edgeIndex, segIndex, path[segIndex], path[segIndex + 1]);
      // Разводим только ВЕРТИКАЛЬНЫЕ сегменты (коридоры «вверх/вниз»).
      // Горизонтальные параллельные линии уже разводятся через тангенциальное
      // распределение точек подключения (getDistributedPoint).
      if (s.orientation !== 'v') continue;
      const key = keyOf(s);
      if (!corridors.has(key)) corridors.set(key, []);
      corridors.get(key)!.push(s);
    }
  });

  // --- 2. Пучки (связные компоненты по пересечению интервалов) --------------
  for (const segments of corridors.values()) {
    // Сортируем по началу интервала для детерминированного обхода.
    segments.sort(
      (a, b) => a.lo - b.lo || a.hi - b.hi || a.edgeIndex - b.edgeIndex
    );

    const n = segments.length;
    const compId = new Array(n).fill(-1);
    let compCount = 0;
    for (let i = 0; i < n; i++) {
      if (compId[i] !== -1) continue;
      const stack = [i];
      compId[i] = compCount;
      while (stack.length) {
        const u = stack.pop()!;
        const su = segments[u];
        for (let v = 0; v < n; v++) {
          if (compId[v] !== -1) continue;
          const sv = segments[v];
          // Пересечение интервалов (более чем в одну точку).
          if (Math.max(su.lo, sv.lo) < Math.min(su.hi, sv.hi)) {
            compId[v] = compCount;
            stack.push(v);
          }
        }
      }
      compCount++;
    }

    // --- 3. Внутри каждого пучка ставим лейны -------------------------------
    const bundles = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const c = compId[i];
      if (!bundles.has(c)) bundles.set(c, []);
      bundles.get(c)!.push(i);
    }

    for (const members of bundles.values()) {
      if (members.length <= 1) continue;

      // Все сегменты в коридоре вертикальные — сортируем по y верхнего конца
      // (lo), тай-брейк по индексу ребра для детерминизма.
      members.sort((a, b) => {
        const sa = segments[a];
        const sb = segments[b];
        return sa.lo - sb.lo || a - b;
      });

      const m = members.length;
      const dir = flowDirection(segments[members[0]], paths);
      members.forEach((posIdx, j) => {
        const seg = segments[posIdx];
        const lane = (j - (m - 1) / 2) * spacing * dir;
        const cur = offsets.get(seg.edgeIndex);
        // Записываем смещение, если для ребра ещё не было ни одного, либо новое
        // смещение больше по модулю (центральный/основной коридор побеждает).
        if (cur === undefined || Math.abs(lane) > Math.abs(cur)) {
          offsets.set(seg.edgeIndex, lane);
        }
      });
    }
  }
  return offsets;
}

// Force inclusion in bundle (prevents tree-shaking of routing functions)
export const ROUTING_SYMBOLS = {
  routeConnections,
  nearestBoundaryPoint,
  HANDLE_GAP,
  EDGE_SPACING,
  getDistributedPoint,
  orthoPath,
  crossing,
  buildPath,
  midpointAlongPath,
  separateLanes,
  makeSeg,
  getLineWidthForConnection,
  LINE_WIDTH,
  MIN_CONN_DIST,
  MAX_CONN_DIST,
} as const;

// Build marker: verifies this module is included in the frontend bundle.
export const ROUTING_BUILD_MARKER = 'routing_build_marker_20261018_v2';

