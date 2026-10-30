const EPSILON = 1e-9;

export function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'bubble-survival')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return (dx * dx) + (dy * dy);
}

function pointToSegmentDistanceSquared(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared <= EPSILON) return distanceSquared(point, start);
  const t = clamp(
    (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSquared,
    0,
    1,
  );
  return distanceSquared(point, { x: start.x + (t * dx), y: start.y + (t * dy) });
}

function orientation(a, b, c) {
  return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

export function segmentToSegmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistanceSquared(a, c, d),
    pointToSegmentDistanceSquared(b, c, d),
    pointToSegmentDistanceSquared(c, a, b),
    pointToSegmentDistanceSquared(d, a, b),
  );
}

export function movingCircleIntersectsSegment(previousCenter, center, radius, start, end) {
  return segmentToSegmentDistanceSquared(previousCenter, center, start, end) <= radius * radius;
}

function resolveDefeatedBodyScale(bubble, time, config) {
  if (bubble.alive || !Number.isFinite(bubble.defeated_at)) return 1;
  const elapsed = Math.max(0, time - bubble.defeated_at);
  if (elapsed <= config.defeat_pop_seconds) {
    if (config.defeat_pop_seconds <= EPSILON) return config.defeat_pop_scale;
    return 1 + ((config.defeat_pop_scale - 1) * (elapsed / config.defeat_pop_seconds));
  }
  const shrinkElapsed = elapsed - config.defeat_pop_seconds;
  return Math.max(0, config.defeat_pop_scale * (1 - (shrinkElapsed / config.defeat_shrink_seconds)));
}

function isPhysicsActive(bubble, time, defeatDespawnSeconds) {
  return bubble.alive || (
    Number.isFinite(bubble.defeated_at)
    && time - bubble.defeated_at <= defeatDespawnSeconds + EPSILON
  );
}

function snapshotState(time, bubbles, tails, events, defeatDespawnSeconds) {
  const livingIds = new Set(bubbles.filter((bubble) => bubble.alive).map((bubble) => bubble.id));
  const renderableBubbles = bubbles.filter((bubble) => (
    bubble.alive
    || (
      Number.isFinite(bubble.defeated_at)
      && time - bubble.defeated_at <= defeatDespawnSeconds + EPSILON
    )
  ));
  return {
    time: Math.round(time * 1000) / 1000,
    bubbles: renderableBubbles.map((bubble) => ({
      id: bubble.id,
      x: Math.round(bubble.x * 1000) / 1000,
      y: Math.round(bubble.y * 1000) / 1000,
      vx: Math.round(bubble.vx * 1000) / 1000,
      vy: Math.round(bubble.vy * 1000) / 1000,
      tail_count: tails.filter((tail) => tail.owner_id === bubble.id).length,
      is_defeated: !bubble.alive,
      defeated_at: Number.isFinite(bubble.defeated_at)
        ? Math.round(bubble.defeated_at * 1000) / 1000
        : null,
    })),
    tails: tails.filter((tail) => livingIds.has(tail.owner_id)).map((tail) => ({
      id: tail.id,
      owner_id: tail.owner_id,
      anchor_x: Math.round(tail.anchor_x * 1000) / 1000,
      anchor_y: Math.round(tail.anchor_y * 1000) / 1000,
    })),
    events: events.map((event) => ({ ...event })),
  };
}

function resolveBubbleCollision(left, right, leftRadius, rightRadius, restitution) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const distance = Math.hypot(dx, dy);
  const minimumDistance = leftRadius + rightRadius;
  if (distance >= minimumDistance || distance <= EPSILON) return false;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minimumDistance - distance;
  left.x -= nx * overlap * 0.5;
  left.y -= ny * overlap * 0.5;
  right.x += nx * overlap * 0.5;
  right.y += ny * overlap * 0.5;

  const relativeNormalVelocity = ((right.vx - left.vx) * nx) + ((right.vy - left.vy) * ny);
  if (relativeNormalVelocity >= 0) return true;
  const impulse = -((1 + restitution) * relativeNormalVelocity) / 2;
  left.vx -= impulse * nx;
  left.vy -= impulse * ny;
  right.vx += impulse * nx;
  right.vy += impulse * ny;
  return true;
}

function createInitialState(subjects, config, seed) {
  const random = createSeededRandom(seed);
  const count = subjects.length;
  const startRadius = config.arena_radius - config.bubble_radius - config.start_inset;
  const bubbles = subjects.map((subject, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count);
    const variation = ((random() * 2) - 1) * config.initial_angle_variation_radians;
    const inwardAngle = angle + Math.PI + variation;
    return {
      id: String(subject.id || index),
      subject_index: index,
      x: config.center_x + (Math.cos(angle) * startRadius),
      y: config.center_y + (Math.sin(angle) * startRadius),
      previous_x: 0,
      previous_y: 0,
      vx: Math.cos(inwardAngle) * config.initial_speed,
      vy: Math.sin(inwardAngle) * config.initial_speed,
      wall_contact: false,
      alive: true,
      defeated_at: null,
    };
  });
  const tails = bubbles.flatMap((bubble, index) => {
    const dx = bubble.x - config.center_x;
    const dy = bubble.y - config.center_y;
    const angle = Math.atan2(dy, dx);
    return Array.from({ length: config.initial_tail_count }, (_unused, tailIndex) => {
      const centeredIndex = tailIndex - ((config.initial_tail_count - 1) / 2);
      const anchorAngle = angle + (centeredIndex * config.initial_tail_anchor_spread_radians);
      return {
        id: `tail-${index}-${tailIndex}`,
        owner_id: bubble.id,
        anchor_x: config.center_x + (Math.cos(anchorAngle) * config.arena_radius),
        anchor_y: config.center_y + (Math.sin(anchorAngle) * config.arena_radius),
      };
    });
  });
  for (let leftIndex = 0; leftIndex < bubbles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bubbles.length; rightIndex += 1) {
      if (distanceSquared(bubbles[leftIndex], bubbles[rightIndex]) < (config.bubble_radius * 2) ** 2) {
        throw new Error('Bubble Survival initial layout contains overlapping bubbles.');
      }
    }
  }
  return { bubbles, tails, nextTailId: tails.length };
}

function normalizeSimulationConfig(raw = {}) {
  return {
    center_x: Number(raw.center_x ?? 270),
    center_y: Number(raw.center_y ?? 450),
    arena_radius: Number(raw.arena_radius ?? 230),
    bubble_radius: Number(raw.bubble_radius ?? 25.2),
    start_inset: Number(raw.start_inset ?? 5),
    initial_tail_count: Math.max(1, Math.round(Number(raw.initial_tail_count ?? 3))),
    initial_tail_anchor_spread_radians: Number(raw.initial_tail_anchor_spread_degrees ?? 7) * Math.PI / 180,
    defeat_pop_scale: Math.max(1, Number(raw.defeat_pop_scale ?? 1.2)),
    defeat_pop_seconds: Math.max(0, Number(raw.defeat_pop_seconds ?? 0.1)),
    defeat_shrink_seconds: Math.max(0.05, Number(raw.defeat_shrink_seconds ?? 0.577)),
    initial_speed: Number(raw.initial_speed ?? 92.5),
    initial_angle_variation_radians: Number(raw.initial_angle_variation_degrees ?? 0) * Math.PI / 180,
    restitution: clamp(Number(raw.collision_restitution ?? 0.98), 0, 1),
    fixed_step_seconds: Number(raw.fixed_step_seconds ?? (1 / 120)),
    sample_fps: Number(raw.sample_fps ?? 30),
    maximum_seconds: Number(raw.maximum_seconds ?? 40),
    stagnation_seconds: Number(raw.stagnation_seconds ?? 10),
    speed_up_interval_seconds: Number(raw.speed_up_interval_seconds ?? 7),
    speed_up_multiplier: Number(raw.speed_up_multiplier ?? 1.18),
  };
}

export function simulateBubbleSurvival({ subjects, seed, config: rawConfig = {} }) {
  if (!Array.isArray(subjects) || subjects.length < 2) {
    throw new Error('Bubble Survival requires at least two subjects.');
  }
  const config = normalizeSimulationConfig(rawConfig);
  const { bubbles, tails: initialTails, nextTailId: initialNextTailId } = createInitialState(subjects, config, seed);
  let tails = initialTails;
  let nextTailId = initialNextTailId;
  let time = 0;
  let nextSampleTime = 1 / config.sample_fps;
  let lastEliminationTime = 0;
  let nextSpeedUpTime = config.speed_up_interval_seconds;
  const defeatDespawnSeconds = config.defeat_pop_seconds + config.defeat_shrink_seconds;
  const frames = [snapshotState(0, bubbles, tails, [], defeatDespawnSeconds)];
  const eventLog = [];

  while (time <= config.maximum_seconds + EPSILON) {
    const stepEvents = [];
    for (const bubble of bubbles) {
      if (!isPhysicsActive(bubble, time, defeatDespawnSeconds)) continue;
      bubble.previous_x = bubble.x;
      bubble.previous_y = bubble.y;
      bubble.x += bubble.vx * config.fixed_step_seconds;
      bubble.y += bubble.vy * config.fixed_step_seconds;

      const dx = bubble.x - config.center_x;
      const dy = bubble.y - config.center_y;
      const distance = Math.hypot(dx, dy) || 1;
      const bodyRadius = config.bubble_radius * resolveDefeatedBodyScale(bubble, time, config);
      const maximumCenterDistance = config.arena_radius - bodyRadius;
      if (distance > maximumCenterDistance) {
        const nx = dx / distance;
        const ny = dy / distance;
        bubble.x = config.center_x + (nx * maximumCenterDistance);
        bubble.y = config.center_y + (ny * maximumCenterDistance);
        const normalVelocity = (bubble.vx * nx) + (bubble.vy * ny);
        if (normalVelocity > 0) {
          bubble.vx -= (1 + config.restitution) * normalVelocity * nx;
          bubble.vy -= (1 + config.restitution) * normalVelocity * ny;
        }
        if (bubble.alive && !bubble.wall_contact) {
          const tail = {
            id: `tail-${nextTailId}`,
            owner_id: bubble.id,
            anchor_x: config.center_x + (nx * config.arena_radius),
            anchor_y: config.center_y + (ny * config.arena_radius),
          };
          nextTailId += 1;
          tails.push(tail);
          stepEvents.push({ type: 'tail_created', bubble_id: bubble.id, tail_id: tail.id });
        }
        bubble.wall_contact = true;
      } else if (distance < maximumCenterDistance - 0.5) {
        bubble.wall_contact = false;
      }
    }

    const living = bubbles.filter((bubble) => bubble.alive);
    const activeBodies = bubbles.filter((bubble) => isPhysicsActive(bubble, time, defeatDespawnSeconds));
    for (let leftIndex = 0; leftIndex < living.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < living.length; rightIndex += 1) {
        const left = living[leftIndex];
        const right = living[rightIndex];
        if (resolveBubbleCollision(
          left,
          right,
          config.bubble_radius,
          config.bubble_radius,
          config.restitution,
        )) {
          stepEvents.push({ type: 'bubble_collision', bubble_ids: [left.id, right.id] });
        }
      }
    }

    const bubbleById = new Map(bubbles.map((bubble) => [bubble.id, bubble]));
    const destroyedTailIds = new Set();
    for (const attacker of activeBodies) {
      const previousCenter = { x: attacker.previous_x, y: attacker.previous_y };
      const center = { x: attacker.x, y: attacker.y };
      const attackerRadius = config.bubble_radius * resolveDefeatedBodyScale(attacker, time, config);
      for (const tail of tails) {
        if (tail.owner_id === attacker.id || destroyedTailIds.has(tail.id)) continue;
        const owner = bubbleById.get(tail.owner_id);
        if (!owner?.alive) continue;
        if (movingCircleIntersectsSegment(
          previousCenter,
          center,
          attackerRadius,
          { x: tail.anchor_x, y: tail.anchor_y },
          { x: owner.x, y: owner.y },
        )) {
          destroyedTailIds.add(tail.id);
          const event = {
            type: 'tail_destroyed',
            attacker_id: attacker.id,
            attacker_is_defeated: !attacker.alive,
            owner_id: tail.owner_id,
            tail_id: tail.id,
          };
          stepEvents.push(event);
          eventLog.push({ time: Math.round(time * 1000) / 1000, ...event });
        }
      }
    }
    if (destroyedTailIds.size > 0) {
      tails = tails.filter((tail) => !destroyedTailIds.has(tail.id));
      for (const bubble of living) {
        if (!tails.some((tail) => tail.owner_id === bubble.id)) {
          bubble.alive = false;
          bubble.defeated_at = time;
          lastEliminationTime = time;
          const event = { type: 'eliminated', bubble_id: bubble.id };
          stepEvents.push(event);
          eventLog.push({ time: Math.round(time * 1000) / 1000, ...event });
        }
      }
    }

    if (time + EPSILON >= nextSpeedUpTime) {
      for (const bubble of bubbles) {
        if (!bubble.alive) continue;
        bubble.vx *= config.speed_up_multiplier;
        bubble.vy *= config.speed_up_multiplier;
      }
      nextSpeedUpTime += config.speed_up_interval_seconds;
      stepEvents.push({ type: 'speed_up' });
    }

    if (time + EPSILON >= nextSampleTime) {
      frames.push(snapshotState(time, bubbles, tails, stepEvents, defeatDespawnSeconds));
      nextSampleTime += 1 / config.sample_fps;
    }

    const survivors = bubbles.filter((bubble) => bubble.alive);
    if (survivors.length <= 1) {
      frames.push(snapshotState(time, bubbles, tails, stepEvents, defeatDespawnSeconds));
      return {
        outcome: survivors.length === 1 ? 'winner' : 'draw',
        winner_id: survivors[0]?.id || null,
        duration_seconds: Math.round(time * 1000) / 1000,
        frames,
        events: eventLog,
        config,
      };
    }

    if (time - lastEliminationTime >= config.stagnation_seconds && time >= config.maximum_seconds * 0.75) {
      return {
        outcome: 'stalled',
        winner_id: null,
        duration_seconds: Math.round(time * 1000) / 1000,
        frames,
        events: eventLog,
        config,
      };
    }
    time += config.fixed_step_seconds;
  }

  return {
    outcome: 'timeout',
    winner_id: null,
    duration_seconds: config.maximum_seconds,
    frames,
    events: eventLog,
    config,
  };
}
