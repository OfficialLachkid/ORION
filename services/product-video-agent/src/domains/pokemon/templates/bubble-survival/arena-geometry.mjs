const EPSILON = 1e-9;

export const BUBBLE_SURVIVAL_ARENA_SHAPES = Object.freeze([
  'circle',
  'triangle',
  'square',
  'diamond',
  'rectangle',
  'pentagon',
  'hexagon',
  'octagon',
  'trefoil',
  'quatrefoil',
  'pokemon-silhouette',
]);

const REGULAR_POLYGON_SIDES = Object.freeze({
  triangle: 3,
  square: 4,
  diamond: 4,
  pentagon: 5,
  hexagon: 6,
  octagon: 8,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeBubbleSurvivalArenaShape(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return BUBBLE_SURVIVAL_ARENA_SHAPES.includes(normalized) ? normalized : 'circle';
}

function buildRegularPolygonVertices({ centerX, centerY, radius, shape }) {
  const sideCount = REGULAR_POLYGON_SIDES[shape];
  const rotation = shape === 'square' ? -Math.PI / 4 : -Math.PI / 2;
  return Array.from({ length: sideCount }, (_unused, index) => {
    const angle = rotation + ((Math.PI * 2 * index) / sideCount);
    return {
      x: centerX + (Math.cos(angle) * radius),
      y: centerY + (Math.sin(angle) * radius),
    };
  });
}

function buildRectangleVertices({ centerX, centerY, radius, aspectRatio }) {
  const halfWidth = radius;
  const halfHeight = radius * clamp(aspectRatio, 0.55, 0.9);
  return [
    { x: centerX - halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY + halfHeight },
    { x: centerX - halfWidth, y: centerY + halfHeight },
  ];
}

function buildLobedVertices({ centerX, centerY, radius, lobes }) {
  const pointCount = Math.max(72, lobes * 24);
  return Array.from({ length: pointCount }, (_unused, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / pointCount);
    const radialRatio = 0.78 + (0.22 * Math.cos(lobes * (angle + (Math.PI / 2))));
    return {
      x: centerX + (Math.cos(angle) * radius * radialRatio),
      y: centerY + (Math.sin(angle) * radius * radialRatio),
    };
  });
}

function buildConfiguredContourVertices({ centerX, centerY, radius, points }) {
  const normalized = (Array.isArray(points) ? points : [])
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (normalized.length < 12) return [];
  return normalized.map((point) => ({
    x: centerX + (point.x * radius),
    y: centerY + (point.y * radius),
  }));
}

function pointIsInsidePolygon(point, vertices) {
  let inside = false;
  for (let current = 0, previous = vertices.length - 1; current < vertices.length; previous = current, current += 1) {
    const left = vertices[current];
    const right = vertices[previous];
    const crosses = ((left.y > point.y) !== (right.y > point.y))
      && (point.x < (((right.x - left.x) * (point.y - left.y))
        / (right.y - left.y)) + left.x);
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonIsConvex(vertices) {
  let direction = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index];
    const second = vertices[(index + 1) % vertices.length];
    const third = vertices[(index + 2) % vertices.length];
    const cross = ((second.x - first.x) * (third.y - second.y))
      - ((second.y - first.y) * (third.x - second.x));
    if (Math.abs(cross) <= EPSILON) continue;
    const nextDirection = Math.sign(cross);
    if (direction !== 0 && nextDirection !== direction) return false;
    direction = nextDirection;
  }
  return true;
}

function buildPolygonEdges(vertices, center) {
  let perimeter = 0;
  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    let inwardX = -dy / Math.max(EPSILON, length);
    let inwardY = dx / Math.max(EPSILON, length);
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const probeDistance = Math.min(1, Math.max(0.05, length * 0.01));
    const probe = {
      x: midpoint.x + (inwardX * probeDistance),
      y: midpoint.y + (inwardY * probeDistance),
    };
    if (!pointIsInsidePolygon(probe, vertices)) {
      inwardX *= -1;
      inwardY *= -1;
    }
    const edge = {
      start,
      end,
      dx,
      dy,
      length,
      perimeter_start: perimeter,
      inward_normal: { x: inwardX, y: inwardY },
    };
    perimeter += length;
    return edge;
  });
}

export function createBubbleSurvivalArenaGeometry(config = {}) {
  const center = {
    x: Number(config.center_x ?? 270),
    y: Number(config.center_y ?? 450),
  };
  const radius = Math.max(1, Number(config.arena_radius ?? 230));
  const shape = normalizeBubbleSurvivalArenaShape(config.arena_shape);
  if (shape === 'circle') {
    return {
      shape,
      center,
      radius,
      perimeter: Math.PI * 2 * radius,
      vertices: [],
      edges: [],
    };
  }
  let vertices;
  if (shape === 'rectangle') {
    vertices = buildRectangleVertices({
      centerX: center.x,
      centerY: center.y,
      radius,
      aspectRatio: Number(config.arena_shape_aspect_ratio ?? 0.72),
    });
  } else if (shape === 'trefoil' || shape === 'quatrefoil') {
    vertices = buildLobedVertices({
      centerX: center.x,
      centerY: center.y,
      radius,
      lobes: shape === 'trefoil' ? 3 : 4,
    });
  } else if (shape === 'pokemon-silhouette') {
    vertices = buildConfiguredContourVertices({
      centerX: center.x,
      centerY: center.y,
      radius,
      points: config.arena_contour_points,
    });
    if (vertices.length === 0) {
      vertices = buildRegularPolygonVertices({ centerX: center.x, centerY: center.y, radius, shape: 'octagon' });
    }
  } else {
    vertices = buildRegularPolygonVertices({ centerX: center.x, centerY: center.y, radius, shape });
  }
  const edges = buildPolygonEdges(vertices, center);
  return {
    shape,
    center,
    radius,
    vertices,
    edges,
    is_convex: polygonIsConvex(vertices),
    contour_source_id: String(config.arena_contour_source_id || '').trim() || null,
    perimeter: edges.reduce((sum, edge) => sum + edge.length, 0),
  };
}

function projectPointToEdge(point, edge) {
  const lengthSquared = (edge.dx * edge.dx) + (edge.dy * edge.dy);
  const t = lengthSquared <= EPSILON ? 0 : clamp(
    (((point.x - edge.start.x) * edge.dx) + ((point.y - edge.start.y) * edge.dy))
      / lengthSquared,
    0,
    1,
  );
  return {
    x: edge.start.x + (edge.dx * t),
    y: edge.start.y + (edge.dy * t),
  };
}

function buildInsetPolygonGeometry(geometry, inset) {
  if (inset <= EPSILON || geometry.is_convex === false) return geometry;
  const vertices = geometry.edges.map((edge, index) => {
    const previous = geometry.edges[(index - 1 + geometry.edges.length) % geometry.edges.length];
    const a1 = previous.inward_normal.x;
    const b1 = previous.inward_normal.y;
    const c1 = (a1 * previous.start.x) + (b1 * previous.start.y) + inset;
    const a2 = edge.inward_normal.x;
    const b2 = edge.inward_normal.y;
    const c2 = (a2 * edge.start.x) + (b2 * edge.start.y) + inset;
    const determinant = (a1 * b2) - (a2 * b1);
    if (Math.abs(determinant) <= EPSILON) return geometry.vertices[index];
    return {
      x: ((c1 * b2) - (c2 * b1)) / determinant,
      y: ((a1 * c2) - (a2 * c1)) / determinant,
    };
  });
  const edges = buildPolygonEdges(vertices, geometry.center);
  return {
    ...geometry,
    vertices,
    edges,
    perimeter: edges.reduce((sum, edge) => sum + edge.length, 0),
  };
}

export function sampleBubbleSurvivalArenaBoundary(geometry, fraction = 0, inset = 0) {
  const normalizedFraction = ((Number(fraction) % 1) + 1) % 1;
  if (geometry.shape === 'circle') {
    const angle = (-Math.PI / 2) + (normalizedFraction * Math.PI * 2);
    const outward = { x: Math.cos(angle), y: Math.sin(angle) };
    const sampleRadius = Math.max(0, geometry.radius - Math.max(0, Number(inset) || 0));
    return {
      x: geometry.center.x + (outward.x * sampleRadius),
      y: geometry.center.y + (outward.y * sampleRadius),
      inward_normal: { x: -outward.x, y: -outward.y },
      outward_normal: outward,
    };
  }
  const normalizedInset = Math.max(0, Number(inset) || 0);
  const sampleGeometry = buildInsetPolygonGeometry(geometry, normalizedInset);
  const targetDistance = normalizedFraction * sampleGeometry.perimeter;
  const edge = sampleGeometry.edges.find((candidate) => (
    targetDistance <= candidate.perimeter_start + candidate.length + EPSILON
  )) || sampleGeometry.edges.at(-1);
  const localDistance = clamp(targetDistance - edge.perimeter_start, 0, edge.length);
  const ratio = edge.length <= EPSILON ? 0 : localDistance / edge.length;
  const boundaryPoint = {
    x: edge.start.x + (edge.dx * ratio),
    y: edge.start.y + (edge.dy * ratio),
  };
  const insetPoint = geometry.is_convex === false && normalizedInset > EPSILON
    ? {
        x: boundaryPoint.x + (edge.inward_normal.x * normalizedInset),
        y: boundaryPoint.y + (edge.inward_normal.y * normalizedInset),
      }
    : boundaryPoint;
  return {
    x: insetPoint.x,
    y: insetPoint.y,
    inward_normal: edge.inward_normal,
    outward_normal: { x: -edge.inward_normal.x, y: -edge.inward_normal.y },
  };
}

function nearestPolygonBoundary(geometry, point) {
  let nearest = null;
  for (let edgeIndex = 0; edgeIndex < geometry.edges.length; edgeIndex += 1) {
    const edge = geometry.edges[edgeIndex];
    const projected = projectPointToEdge(point, edge);
    const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (!nearest || distance < nearest.distance) {
      const ratio = edge.length <= EPSILON
        ? 0
        : Math.hypot(projected.x - edge.start.x, projected.y - edge.start.y) / edge.length;
      nearest = { edge, edgeIndex, projected, distance, ratio };
    }
  }
  return nearest;
}

function buildPackedContourStartingSamples({
  geometry,
  count,
  inset,
  rotationFraction,
  minimumSpacing,
}) {
  const xs = geometry.vertices.map((point) => point.x);
  const ys = geometry.vertices.map((point) => point.y);
  const spacing = Math.max(1, Number(minimumSpacing) || 1);
  const gridStep = Math.max(4, spacing * 0.34);
  const candidates = [];
  let rowIndex = 0;
  for (let y = Math.min(...ys); y <= Math.max(...ys) + EPSILON; y += gridStep) {
    const offsetX = rowIndex % 2 === 0 ? 0 : gridStep / 2;
    for (let x = Math.min(...xs) + offsetX; x <= Math.max(...xs) + EPSILON; x += gridStep) {
      const constrained = constrainBubbleToArena(geometry, { x, y }, inset);
      if (Math.hypot(constrained.x - x, constrained.y - y) > 0.01) continue;
      const nearest = nearestPolygonBoundary(geometry, { x, y });
      if (!nearest) continue;
      candidates.push({
        x,
        y,
        inward_normal: nearest.edge.inward_normal,
        outward_normal: {
          x: -nearest.edge.inward_normal.x,
          y: -nearest.edge.inward_normal.y,
        },
        boundary_fraction: (
          nearest.edge.perimeter_start + (nearest.edge.length * nearest.ratio)
        ) / geometry.perimeter,
      });
    }
    rowIndex += 1;
  }
  if (candidates.length < count) {
    throw new Error(`Arena ${geometry.shape} has too little usable area for ${count} bubbles.`);
  }
  const target = sampleBubbleSurvivalArenaBoundary(geometry, rotationFraction, inset);
  const first = candidates.reduce((best, candidate) => {
    if (!best) return candidate;
    return Math.hypot(candidate.x - target.x, candidate.y - target.y)
      < Math.hypot(best.x - target.x, best.y - target.y) ? candidate : best;
  }, null);
  const selected = [first];
  while (selected.length < count) {
    let bestCandidate = null;
    let bestDistance = -1;
    for (const candidate of candidates) {
      if (selected.includes(candidate)) continue;
      const distance = Math.min(...selected.map((chosen) => Math.hypot(
        candidate.x - chosen.x,
        candidate.y - chosen.y,
      )));
      if (distance > bestDistance) {
        bestDistance = distance;
        bestCandidate = candidate;
      }
    }
    if (!bestCandidate || bestDistance + EPSILON < spacing) break;
    selected.push(bestCandidate);
  }
  if (selected.length !== count) {
    throw new Error(`Arena ${geometry.shape} cannot place ${count} bubbles at ${spacing}px spacing.`);
  }
  return selected;
}

export function buildBubbleSurvivalArenaStartingSamples({
  geometry,
  count,
  inset = 0,
  rotationFraction = 0,
  minimumSpacing = 0,
} = {}) {
  const sampleCount = Math.max(1, Math.round(Number(count) || 1));
  const normalizedRotation = ((Number(rotationFraction) % 1) + 1) % 1;
  if (geometry.shape === 'circle') {
    return Array.from({ length: sampleCount }, (_unused, index) => {
      const boundaryFraction = normalizedRotation + (index / sampleCount);
      return {
        ...sampleBubbleSurvivalArenaBoundary(geometry, boundaryFraction, inset),
        boundary_fraction: boundaryFraction,
      };
    });
  }
  if (geometry.is_convex === false) {
    return buildPackedContourStartingSamples({
      geometry,
      count: sampleCount,
      inset: Math.max(0, Number(inset) || 0),
      rotationFraction: normalizedRotation,
      minimumSpacing,
    });
  }
  const insetGeometry = buildInsetPolygonGeometry(
    geometry,
    Math.max(0, Number(inset) || 0),
  );
  const edgeCount = insetGeometry.edges.length;
  const spacing = Math.max(1, Number(minimumSpacing) || 1);
  if (geometry.shape === 'triangle' && sampleCount === 9) {
    const topY = Math.min(...insetGeometry.vertices.map((point) => point.y));
    const baseY = Math.max(...insetGeometry.vertices.map((point) => point.y));
    const rowFractions = [0.34, 0.66, 0.98];
    const rowCounts = [2, 3, 4];
    const rotationSteps = Math.floor(normalizedRotation * 3) % 3;
    const rotationRadians = rotationSteps * ((Math.PI * 2) / 3);
    const triangleSamples = rowFractions.flatMap((rowFraction, rowIndex) => {
      const rowCount = rowCounts[rowIndex];
      const y = topY + ((baseY - topY) * rowFraction);
      return Array.from({ length: rowCount }, (_unused, columnIndex) => {
        const x = geometry.center.x
          + ((columnIndex - ((rowCount - 1) / 2)) * spacing);
        const dx = x - geometry.center.x;
        const dy = y - geometry.center.y;
        const rotatedX = geometry.center.x
          + (dx * Math.cos(rotationRadians))
          - (dy * Math.sin(rotationRadians));
        const rotatedY = geometry.center.y
          + (dx * Math.sin(rotationRadians))
          + (dy * Math.cos(rotationRadians));
        const angle = Math.atan2(rotatedY - geometry.center.y, rotatedX - geometry.center.x);
        return {
          x: rotatedX,
          y: rotatedY,
          inward_normal: { x: -Math.cos(angle), y: -Math.sin(angle) },
          outward_normal: { x: Math.cos(angle), y: Math.sin(angle) },
          boundary_fraction: ((angle + (Math.PI / 2)) / (Math.PI * 2)) % 1,
        };
      });
    });
    const valid = triangleSamples.every((sample) => {
      const constrained = constrainBubbleToArena(geometry, sample, inset);
      return Math.hypot(constrained.x - sample.x, constrained.y - sample.y) < 0.01;
    }) && triangleSamples.every((left, leftIndex) => (
      triangleSamples.slice(leftIndex + 1).every((right) => (
        Math.hypot(left.x - right.x, left.y - right.y) + EPSILON >= spacing
      ))
    ));
    if (valid) return triangleSamples;
  }
  const startEdge = Math.floor(normalizedRotation * edgeCount) % edgeCount;
  const capacities = insetGeometry.edges.map((edge) => Math.max(
    1,
    Math.floor(edge.length / spacing) - 1,
  ));
  const edgeSampleCounts = Array.from({ length: edgeCount }, () => 0);
  let remainingBoundarySamples = Math.min(
    sampleCount,
    capacities.reduce((sum, capacity) => sum + capacity, 0),
  );
  while (remainingBoundarySamples > 0) {
    let assigned = false;
    for (let logicalEdge = 0; logicalEdge < edgeCount; logicalEdge += 1) {
      const edgeIndex = (startEdge + logicalEdge) % edgeCount;
      if (edgeSampleCounts[edgeIndex] >= capacities[edgeIndex]) continue;
      edgeSampleCounts[edgeIndex] += 1;
      remainingBoundarySamples -= 1;
      assigned = true;
      if (remainingBoundarySamples === 0) break;
    }
    if (!assigned) break;
  }
  const samples = [];
  for (let logicalEdge = 0; logicalEdge < edgeCount; logicalEdge += 1) {
    const edgeIndex = (startEdge + logicalEdge) % edgeCount;
    const edge = insetGeometry.edges[edgeIndex];
    const outerEdge = geometry.edges[edgeIndex];
    const edgeSampleCount = edgeSampleCounts[edgeIndex];
    for (let sampleIndex = 0; sampleIndex < edgeSampleCount; sampleIndex += 1) {
      const ratio = (sampleIndex + 1) / (edgeSampleCount + 1);
      const boundaryFraction = (
        outerEdge.perimeter_start + (outerEdge.length * ratio)
      ) / geometry.perimeter;
      samples.push({
        x: edge.start.x + (edge.dx * ratio),
        y: edge.start.y + (edge.dy * ratio),
        inward_normal: edge.inward_normal,
        outward_normal: { x: -edge.inward_normal.x, y: -edge.inward_normal.y },
        boundary_fraction: boundaryFraction,
      });
    }
  }
  const interiorCount = sampleCount - samples.length;
  if (interiorCount > 0) {
    const interiorRadius = interiorCount === 1
      ? 0
      : Math.min(geometry.radius * 0.32, spacing * 1.08);
    for (let index = 0; index < interiorCount; index += 1) {
      const angle = (-Math.PI / 2)
        + (normalizedRotation * Math.PI * 2)
        + ((Math.PI * 2 * index) / interiorCount);
      const boundaryFraction = ((angle + (Math.PI / 2)) / (Math.PI * 2)) % 1;
      samples.push({
        x: geometry.center.x + (Math.cos(angle) * interiorRadius),
        y: geometry.center.y + (Math.sin(angle) * interiorRadius),
        inward_normal: { x: -Math.cos(angle), y: -Math.sin(angle) },
        outward_normal: { x: Math.cos(angle), y: Math.sin(angle) },
        boundary_fraction: boundaryFraction,
      });
    }
  }
  const hasRequiredSpacing = (values) => values.every((left, leftIndex) => (
    values.slice(leftIndex + 1).every((right) => (
      Math.hypot(left.x - right.x, left.y - right.y) + EPSILON >= spacing
    ))
  ));
  if (samples.length === sampleCount && hasRequiredSpacing(samples)) return samples;

  const xs = geometry.vertices.map((point) => point.x);
  const ys = geometry.vertices.map((point) => point.y);
  const gridStep = spacing * 0.45;
  const candidates = [...samples];
  let rowIndex = 0;
  for (
    let y = Math.min(...ys);
    y <= Math.max(...ys) + EPSILON;
    y += gridStep
  ) {
    const offsetX = rowIndex % 2 === 0 ? 0 : gridStep / 2;
    for (
      let x = Math.min(...xs) + offsetX;
      x <= Math.max(...xs) + EPSILON;
      x += gridStep
    ) {
      const constrained = constrainBubbleToArena(geometry, { x, y }, inset);
      if (Math.hypot(constrained.x - x, constrained.y - y) > 0.01) continue;
      const angle = Math.atan2(y - geometry.center.y, x - geometry.center.x);
      candidates.push({
        x,
        y,
        inward_normal: { x: -Math.cos(angle), y: -Math.sin(angle) },
        outward_normal: { x: Math.cos(angle), y: Math.sin(angle) },
        boundary_fraction: ((angle + (Math.PI / 2)) / (Math.PI * 2)) % 1,
      });
    }
    rowIndex += 1;
  }
  const uniqueCandidates = candidates.filter((candidate, index, values) => (
    values.findIndex((other) => Math.hypot(
      candidate.x - other.x,
      candidate.y - other.y,
    ) < 0.01) === index
  ));
  for (let startOffset = 0; startOffset < uniqueCandidates.length; startOffset += 1) {
    const startIndex = (
      Math.floor(normalizedRotation * uniqueCandidates.length) + startOffset
    ) % uniqueCandidates.length;
    const selected = [uniqueCandidates[startIndex]];
    while (selected.length < sampleCount) {
      let bestCandidate = null;
      let bestDistance = -1;
      for (const candidate of uniqueCandidates) {
        if (selected.includes(candidate)) continue;
        const distance = Math.min(...selected.map((chosen) => Math.hypot(
          candidate.x - chosen.x,
          candidate.y - chosen.y,
        )));
        if (distance > bestDistance) {
          bestDistance = distance;
          bestCandidate = candidate;
        }
      }
      if (!bestCandidate || bestDistance + EPSILON < spacing) break;
      selected.push(bestCandidate);
    }
    if (selected.length === sampleCount) return selected;
  }
  throw new Error(
    `Arena ${geometry.shape} cannot place ${sampleCount} bubbles at ${spacing}px spacing.`,
  );
}

export function constrainBubbleToArena(geometry, point, bodyRadius) {
  const radius = Math.max(0, Number(bodyRadius) || 0);
  if (geometry.shape === 'circle') {
    const dx = point.x - geometry.center.x;
    const dy = point.y - geometry.center.y;
    const distance = Math.hypot(dx, dy) || 1;
    const maximumDistance = Math.max(0, geometry.radius - radius);
    const clearance = maximumDistance - distance;
    if (clearance >= 0) {
      return { x: point.x, y: point.y, collided: false, contacts: [], clearance };
    }
    const outward = { x: dx / distance, y: dy / distance };
    return {
      x: geometry.center.x + (outward.x * maximumDistance),
      y: geometry.center.y + (outward.y * maximumDistance),
      collided: true,
      clearance: 0,
      contacts: [{
        outward_normal: outward,
        anchor: {
          x: geometry.center.x + (outward.x * geometry.radius),
          y: geometry.center.y + (outward.y * geometry.radius),
        },
      }],
    };
  }

  if (geometry.is_convex === false) {
    const corrected = { x: point.x, y: point.y };
    const contactsByEdge = new Map();
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const nearest = nearestPolygonBoundary(geometry, corrected);
      if (!nearest) break;
      const inside = pointIsInsidePolygon(corrected, geometry.vertices);
      const signedClearance = inside ? nearest.distance : -nearest.distance;
      if (signedClearance + EPSILON >= radius) break;
      const correction = radius - signedClearance;
      corrected.x += nearest.edge.inward_normal.x * correction;
      corrected.y += nearest.edge.inward_normal.y * correction;
      contactsByEdge.set(nearest.edgeIndex, nearest);
    }
    const nearest = nearestPolygonBoundary(geometry, corrected);
    const inside = pointIsInsidePolygon(corrected, geometry.vertices);
    const clearance = nearest && inside ? Math.max(0, nearest.distance - radius) : 0;
    const contacts = [...contactsByEdge.values()].map((contact) => ({
      outward_normal: {
        x: -contact.edge.inward_normal.x,
        y: -contact.edge.inward_normal.y,
      },
      anchor: contact.projected,
    }));
    return {
      ...corrected,
      collided: contacts.length > 0,
      contacts,
      clearance,
    };
  }

  const corrected = { x: point.x, y: point.y };
  const contactEdges = new Set();
  for (let iteration = 0; iteration < 4; iteration += 1) {
    let adjusted = false;
    for (let edgeIndex = 0; edgeIndex < geometry.edges.length; edgeIndex += 1) {
      const edge = geometry.edges[edgeIndex];
      const signedDistance = ((corrected.x - edge.start.x) * edge.inward_normal.x)
        + ((corrected.y - edge.start.y) * edge.inward_normal.y);
      if (signedDistance + EPSILON >= radius) continue;
      const correction = radius - signedDistance;
      corrected.x += edge.inward_normal.x * correction;
      corrected.y += edge.inward_normal.y * correction;
      contactEdges.add(edgeIndex);
      adjusted = true;
    }
    if (!adjusted) break;
  }
  const clearance = geometry.edges.reduce((minimum, edge) => {
    const signedDistance = ((corrected.x - edge.start.x) * edge.inward_normal.x)
      + ((corrected.y - edge.start.y) * edge.inward_normal.y);
    return Math.min(minimum, signedDistance - radius);
  }, Number.POSITIVE_INFINITY);
  const contacts = [...contactEdges].map((edgeIndex) => {
    const edge = geometry.edges[edgeIndex];
    return {
      outward_normal: { x: -edge.inward_normal.x, y: -edge.inward_normal.y },
      anchor: projectPointToEdge(corrected, edge),
    };
  });
  return {
    ...corrected,
    collided: contacts.length > 0,
    contacts,
    clearance: Math.max(0, clearance),
  };
}

export function buildBubbleSurvivalArenaSvgMarkup(geometry, {
  fill = '#03101b',
  stroke = '#67dcff',
} = {}) {
  if (geometry.shape === 'circle') {
    return [
      `<circle cx="${geometry.center.x}" cy="${geometry.center.y}" r="${geometry.radius + 5}" fill="${fill}" fill-opacity="0.36" stroke="#11263f" stroke-width="8"/>`,
      `<circle cx="${geometry.center.x}" cy="${geometry.center.y}" r="${geometry.radius + 2}" fill="none" stroke="${stroke}" stroke-width="11" opacity="0.16"/>`,
      `<circle cx="${geometry.center.x}" cy="${geometry.center.y}" r="${geometry.radius}" fill="none" stroke="${stroke}" stroke-width="3"/>`,
    ];
  }
  const points = geometry.vertices.map((point) => `${point.x},${point.y}`).join(' ');
  return [
    `<polygon points="${points}" fill="${fill}" fill-opacity="0.36" stroke="#11263f" stroke-width="8" stroke-linejoin="round"/>`,
    `<polygon points="${points}" fill="none" stroke="${stroke}" stroke-width="11" stroke-linejoin="round" opacity="0.16"/>`,
    `<polygon points="${points}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
  ];
}
