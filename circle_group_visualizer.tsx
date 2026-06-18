import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const EPSILON = 1e-9;
const BASE_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];
const INITIAL_INTERVALS = [
  { id: 1, start: 0.1, width: 0.1, color: BASE_COLORS[0] },
  { id: 2, start: 0.575, width: 0.15, color: BASE_COLORS[1] },
];

function hexToRgb(hex) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r, g, b) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}

function blendMultipleColors(hexColors) {
  if (!hexColors || hexColors.length === 0) return '#000000';
  if (hexColors.length === 1) return hexColors[0];
  let rSum = 0, gSum = 0, bSum = 0;
  hexColors.forEach(hex => {
    let [r, g, b] = hexToRgb(hex);
    rSum += r; gSum += g; bSum += b;
  });
  let count = hexColors.length;
  return rgbToHex(Math.round(rSum/count), Math.round(gSum/count), Math.round(bSum/count));
}

function InlineMath({ children, className = '' }) {
  const html = katex.renderToString(String(children), {
    throwOnError: false,
    strict: false,
  });

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Helper to convert angles to Cartesian coordinates for SVG
function polarToCartesian(cx, cy, r, angleInTurns) {
  // 0 turns = top, 0.25 = right, 0.5 = bottom, 0.75 = left
  const angleInRadians = (angleInTurns - 0.25) * 2 * Math.PI;
  return {
    x: cx + (r * Math.cos(angleInRadians)),
    y: cy + (r * Math.sin(angleInRadians))
  };
}

// Splits an interval [s, e] into segments strictly within [0, 1]
function getWrappedSegments(s, e) {
  let segments = [];
  if (s > e) {
    let temp = s; s = e; e = temp;
  }
  let L = e - s;
  if (L <= 0) return [];

  let startInt = Math.floor(s);
  let endInt = Math.floor(e);

  if (startInt === endInt) {
    segments.push([s - startInt, e - startInt]);
  } else {
    segments.push([s - startInt, 1]);
    for (let i = startInt + 1; i < endInt; i++) {
      segments.push([0, 1]);
    }
    if (e - endInt > EPSILON) {
      segments.push([0, e - endInt]);
    }
  }
  return segments;
}

// Calculates the true Lebesgue measure (density) of a set of wrapped segments
function calculateMeasure(segments) {
  if (!segments || segments.length === 0) return 0;
  let sorted = [...segments].sort((a, b) => a.start - b.start);
  let merged = [];
  let current = { start: sorted[0].start, end: sorted[0].end };
  
  for (let i = 1; i < sorted.length; i++) {
    let seg = sorted[i];
    if (seg.start <= current.end + EPSILON) {
      current.end = Math.max(current.end, seg.end);
    } else {
      merged.push(current);
      current = { start: seg.start, end: seg.end };
    }
  }
  merged.push(current);
  
  let measure = merged.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
  return Math.min(Math.max(measure, 0), 1);
}

// Calculates disjoint intervals and their blended colors
function getDisjointSegments(segments) {
  if (!segments || segments.length === 0) return { measure: 0, pieces: [] };

  let endpoints = new Set();
  segments.forEach(seg => {
    endpoints.add(seg.start);
    endpoints.add(seg.end);
  });
  let pts = Array.from(endpoints).sort((a, b) => a - b);

  let pieces = [];
  let totalMeasure = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    let p1 = pts[i];
    let p2 = pts[i + 1];
    let mid = (p1 + p2) / 2;
    if (p2 - p1 < EPSILON) continue;

    let activeColors = [];
    segments.forEach(seg => {
      if (seg.start - EPSILON <= mid && mid <= seg.end + EPSILON) {
        activeColors.push(seg.color);
      }
    });

    if (activeColors.length > 0) {
      let w = p2 - p1;
      pieces.push({ width: w, color: blendMultipleColors(activeColors) });
      totalMeasure += w;
    }
  }

  let mergedPieces = [];
  if (pieces.length > 0) {
    let current = { ...pieces[0] };
    for (let i = 1; i < pieces.length; i++) {
      if (pieces[i].color === current.color) {
        current.width += pieces[i].width;
      } else {
        mergedPieces.push(current);
        current = { ...pieces[i] };
      }
    }
    mergedPieces.push(current);
  }

  return { measure: Math.min(totalMeasure, 1), pieces: mergedPieces };
}

function normalizeTurn(value) {
  return ((value % 1) + 1) % 1;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function circularDistance(a, b) {
  const diff = Math.abs(normalizeTurn(a) - normalizeTurn(b));
  return Math.min(diff, 1 - diff);
}

function signedCircularDelta(value, origin) {
  let delta = normalizeTurn(value) - normalizeTurn(origin);
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function intervalSegments(start, width) {
  if (width <= EPSILON) return [];
  return getWrappedSegments(start, start + Math.min(width, 1));
}

function intervalsOverlapOnCircle(startA, widthA, startB, widthB) {
  if (widthA <= EPSILON || widthB <= EPSILON) return false;

  const segmentsA = intervalSegments(startA, widthA);
  const segmentsB = intervalSegments(startB, widthB);
  return segmentsA.some(a => (
    segmentsB.some(b => Math.max(a[0], b[0]) < Math.min(a[1], b[1]) - EPSILON)
  ));
}

function isStartAllowed(start, width, otherIntervals) {
  return !otherIntervals.some(other => (
    intervalsOverlapOnCircle(start, width, other.start, other.width)
  ));
}

function getForbiddenStartSegments(width, otherIntervals) {
  if (width <= EPSILON) return [];

  const rawSegments = [];
  for (const other of otherIntervals) {
    if (other.width <= EPSILON) continue;

    const forbiddenLength = width + other.width;
    if (forbiddenLength >= 1 - EPSILON) {
      return [{ start: 0, end: 1 }];
    }

    const start = normalizeTurn(other.start - width);
    const end = start + forbiddenLength;
    if (end <= 1 + EPSILON) {
      rawSegments.push({ start, end: Math.min(end, 1) });
    } else {
      rawSegments.push({ start, end: 1 });
      rawSegments.push({ start: 0, end: end - 1 });
    }
  }

  if (rawSegments.length === 0) return [];

  const sorted = rawSegments.sort((a, b) => a.start - b.start);
  const merged = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const segment = sorted[i];
    if (segment.start <= current.end + EPSILON) {
      current.end = Math.max(current.end, segment.end);
    } else {
      merged.push(current);
      current = { ...segment };
    }
  }
  merged.push(current);
  return merged;
}

function forbiddenStartBackground(forbiddenSegments) {
  const allowedColor = '#dbeafe';
  const forbiddenColor = 'rgba(248, 113, 113, 0.5)';

  if (!forbiddenSegments || forbiddenSegments.length === 0) return allowedColor;
  if (forbiddenSegments.length === 1 && forbiddenSegments[0].start <= EPSILON && forbiddenSegments[0].end >= 1 - EPSILON) {
    return forbiddenColor;
  }

  const stops = [];
  let cursor = 0;
  forbiddenSegments.forEach(segment => {
    const start = clamp(segment.start, 0, 1);
    const end = clamp(segment.end, 0, 1);
    if (start > cursor + EPSILON) {
      stops.push(`${allowedColor} ${cursor * 100}%`, `${allowedColor} ${start * 100}%`);
    }
    stops.push(`${forbiddenColor} ${start * 100}%`, `${forbiddenColor} ${end * 100}%`);
    cursor = Math.max(cursor, end);
  });

  if (cursor < 1 - EPSILON) {
    stops.push(`${allowedColor} ${cursor * 100}%`, `${allowedColor} 100%`);
  }

  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function maxValueBackground(maxValue) {
  const allowedColor = '#dbeafe';
  const forbiddenColor = 'rgba(248, 113, 113, 0.5)';
  const cutoff = clamp(maxValue, 0, 1) * 100;

  if (cutoff >= 100 - EPSILON) return allowedColor;
  if (cutoff <= EPSILON) return forbiddenColor;
  return `linear-gradient(to right, ${allowedColor} 0%, ${allowedColor} ${cutoff}%, ${forbiddenColor} ${cutoff}%, ${forbiddenColor} 100%)`;
}

function snapStartToAllowed(desiredStart, width, otherIntervals, fallbackStart) {
  const desired = normalizeTurn(desiredStart);
  if (width <= EPSILON || isStartAllowed(desired, width, otherIntervals)) return desired;
  if (width + otherIntervals.reduce((sum, interval) => sum + interval.width, 0) > 1 + EPSILON) {
    return normalizeTurn(fallbackStart);
  }

  const candidates = [];
  otherIntervals.forEach(other => {
    candidates.push(normalizeTurn(other.start + other.width));
    candidates.push(normalizeTurn(other.start - width));
  });

  let bestStart = normalizeTurn(fallbackStart);
  let bestDistance = Infinity;
  candidates.forEach(candidate => {
    if (!isStartAllowed(candidate, width, otherIntervals)) return;
    const distance = circularDistance(candidate, desired);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = candidate;
    }
  });

  return bestStart;
}

function getClockwiseOrderFromAnchor(intervals, anchorId = intervals[0]?.id) {
  const anchor = intervals.find(interval => interval.id === anchorId) || intervals[0];
  if (!anchor) return [];

  const anchorStart = normalizeTurn(anchor.start);
  return [...intervals].sort((a, b) => {
    if (a.id === anchor.id) return -1;
    if (b.id === anchor.id) return 1;
    return normalizeTurn(a.start - anchorStart) - normalizeTurn(b.start - anchorStart);
  });
}

function packIntervalsConsecutively(intervals, anchorId = intervals[0]?.id) {
  const ordered = getClockwiseOrderFromAnchor(intervals, anchorId);
  if (ordered.length === 0) return intervals;

  const packedById = new Map();
  let currentStart = normalizeTurn(ordered[0].start);
  ordered.forEach(interval => {
    packedById.set(interval.id, { ...interval, start: normalizeTurn(currentStart) });
    currentStart += interval.width;
  });

  return intervals.map(interval => packedById.get(interval.id) || interval);
}

function packIntervalsClockwise(intervals, anchorId = intervals[0]?.id) {
  if (intervals.length <= 1) {
    return intervals.map(interval => ({ ...interval, start: normalizeTurn(interval.start) }));
  }

  const totalWidth = intervals.reduce((sum, interval) => sum + interval.width, 0);
  if (totalWidth > 1 + EPSILON) return intervals;

  const anchor = intervals.find(interval => interval.id === anchorId) || intervals[0];
  const anchorStart = normalizeTurn(anchor.start);
  const ordered = getClockwiseOrderFromAnchor(intervals, anchorId);

  const packedById = new Map();
  let currentEnd = anchorStart;
  ordered.forEach((interval, index) => {
    let liftedStart = index === 0 ? anchorStart : anchorStart + normalizeTurn(interval.start - anchorStart);
    if (index > 0 && liftedStart < currentEnd - EPSILON) {
      liftedStart = currentEnd;
    }

    packedById.set(interval.id, { ...interval, start: normalizeTurn(liftedStart) });
    currentEnd = liftedStart + interval.width;
  });

  if (currentEnd > anchorStart + 1 + EPSILON) {
    return packIntervalsConsecutively(intervals, anchorId);
  }

  return intervals.map(interval => packedById.get(interval.id) || interval);
}

function scaleIntervalsToTotal(intervals, targetTotal) {
  if (intervals.length === 0) return intervals;

  const total = intervals.reduce((sum, interval) => sum + interval.width, 0);
  if (targetTotal <= EPSILON) {
    return intervals.map(interval => ({ ...interval, width: 0 }));
  }

  if (total <= EPSILON) {
    const equalWidth = targetTotal / intervals.length;
    return intervals.map(interval => ({ ...interval, width: equalWidth }));
  }

  const scale = targetTotal / total;
  return intervals.map(interval => ({ ...interval, width: interval.width * scale }));
}

function balanceWidthsToTarget(intervals, targetTotal, preferredIndex = 0) {
  if (intervals.length === 0) return intervals;

  const balanced = intervals.map(interval => ({ ...interval, width: Math.max(0, interval.width) }));
  let diff = targetTotal - balanced.reduce((sum, interval) => sum + interval.width, 0);
  const preferred = ((preferredIndex % balanced.length) + balanced.length) % balanced.length;

  if (diff > EPSILON) {
    balanced[preferred].width += diff;
  } else if (diff < -EPSILON) {
    let remaining = -diff;
    for (let step = 0; step < balanced.length && remaining > EPSILON; step++) {
      const index = (preferred + step) % balanced.length;
      const reduction = Math.min(balanced[index].width, remaining);
      balanced[index].width -= reduction;
      remaining -= reduction;
    }
  }

  return balanced;
}

function resizeWithFixedTotal(intervals, intervalIndex, requestedWidth, targetTotal) {
  if (intervals.length === 0) return intervals;

  const next = intervals.map(interval => ({ ...interval }));
  const index = ((intervalIndex % next.length) + next.length) % next.length;
  const nextIndex = (index + 1) % next.length;

  if (next.length === 1) {
    next[index].width = targetTotal;
    return next;
  }

  const currentWidth = next[index].width;
  const desiredWidth = clamp(requestedWidth, 0, targetTotal);
  let delta = desiredWidth - currentWidth;
  next[index].width = desiredWidth;

  if (delta > EPSILON) {
    let remaining = delta;
    for (let step = 1; step < next.length && remaining > EPSILON; step++) {
      const donorIndex = (index + step) % next.length;
      const reduction = Math.min(next[donorIndex].width, remaining);
      next[donorIndex].width -= reduction;
      remaining -= reduction;
    }

    if (remaining > EPSILON) {
      next[index].width = Math.max(0, next[index].width - remaining);
    }
  } else if (delta < -EPSILON) {
    next[nextIndex].width += -delta;
  }

  return balanceWidthsToTarget(next, targetTotal, nextIndex);
}

function resizeWithinMaxTotal(intervals, intervalIndex, requestedWidth, maxTotal = 1) {
  if (intervals.length === 0) return intervals;

  const next = intervals.map(interval => ({ ...interval }));
  const index = ((intervalIndex % next.length) + next.length) % next.length;
  const desiredWidth = clamp(requestedWidth, 0, maxTotal);
  const otherWidth = next.reduce((sum, interval, i) => i === index ? sum : sum + interval.width, 0);
  let overflow = desiredWidth + otherWidth - maxTotal;

  next[index].width = desiredWidth;

  if (overflow > EPSILON) {
    for (let step = 1; step < next.length && overflow > EPSILON; step++) {
      const donorIndex = (index + step) % next.length;
      const reduction = Math.min(next[donorIndex].width, overflow);
      next[donorIndex].width -= reduction;
      overflow -= reduction;
    }

    if (overflow > EPSILON) {
      next[index].width = Math.max(0, next[index].width - overflow);
    }
  }

  return next;
}

function getDefaultSetup() {
  const intervals = INITIAL_INTERVALS.map(interval => ({ ...interval }));
  const targetTotalLength = intervals.reduce((sum, interval) => sum + interval.width, 0);

  return {
    intervals,
    lambda: 3,
    hiddenMixedComboKeys: [],
    fixTotalLength: false,
    targetTotalLength,
  };
}

function encodeShareState(state) {
  const json = JSON.stringify(state);
  const bytes = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) => (
    String.fromCharCode(parseInt(hex, 16))
  ));

  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeShareState(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = atob(padded);
  const escaped = Array.from(bytes, char => (
    `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
  )).join('');

  return JSON.parse(decodeURIComponent(escaped));
}

function normalizeSharedIntervals(rawIntervals) {
  if (!Array.isArray(rawIntervals)) {
    return getDefaultSetup().intervals;
  }

  if (rawIntervals.length === 0) return [];

  const usedIds = new Set();
  let intervals = rawIntervals.map((raw, index) => {
    let id = Number(raw?.id);
    if (!Number.isFinite(id) || usedIds.has(id)) {
      id = index + 1;
      while (usedIds.has(id)) id += 1;
    }
    usedIds.add(id);

    const fallbackColor = BASE_COLORS[index % BASE_COLORS.length];
    const color = typeof raw?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)
      ? raw.color
      : fallbackColor;

    return {
      id,
      start: normalizeTurn(Number(raw?.start) || 0),
      width: clamp(Number(raw?.width) || 0, 0, 1),
      color,
    };
  });

  const total = intervals.reduce((sum, interval) => sum + interval.width, 0);
  if (total > 1 + EPSILON) {
    intervals = scaleIntervalsToTotal(intervals, 1);
  }

  return packIntervalsClockwise(intervals, intervals[0]?.id);
}

function normalizeSharedSetup(shared, defaults = getDefaultSetup()) {
  if (!shared || typeof shared !== 'object' || Array.isArray(shared)) {
    throw new Error('Invalid state');
  }

  let intervals = normalizeSharedIntervals(shared?.intervals);
  const lambda = Number.isFinite(Number(shared?.lambda)) ? Number(shared.lambda) : defaults.lambda;
  const fixTotalLength = shared?.fixTotalLength === true;
  let targetTotalLength = clamp(
    Number(shared?.targetTotalLength),
    0,
    1
  );

  if (!Number.isFinite(targetTotalLength)) {
    targetTotalLength = intervals.reduce((sum, interval) => sum + interval.width, 0);
  }

  if (fixTotalLength) {
    intervals = packIntervalsClockwise(scaleIntervalsToTotal(intervals, targetTotalLength), intervals[0]?.id);
  } else {
    targetTotalLength = intervals.reduce((sum, interval) => sum + interval.width, 0);
  }

  const hiddenMixedComboKeys = Array.isArray(shared?.hiddenMixedComboKeys)
    ? shared.hiddenMixedComboKeys.filter(key => typeof key === 'string')
    : [];

  return {
    intervals,
    lambda,
    hiddenMixedComboKeys,
    fixTotalLength,
    targetTotalLength,
  };
}

function readSetupFromUrl() {
  const defaults = getDefaultSetup();

  if (typeof window === 'undefined') return defaults;

  const rawState = new URLSearchParams(window.location.search).get('state');
  if (!rawState) return defaults;

  try {
    const shared = decodeShareState(rawState);
    return normalizeSharedSetup(shared, defaults);
  } catch {
    return defaults;
  }
}

function buildShareUrl(state) {
  if (typeof window === 'undefined') return '';

  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('state', encodeShareState(state));
  return url.toString();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for local/dev contexts where clipboard permission is denied.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

// Reusable component to draw an arc on the circle
function Arc({ r, start, end, color, className, style, ...rest }) {
  const mergedStyle = { mixBlendMode: 'multiply', ...style };
  const baseClasses = "opacity-60 transition-opacity duration-75";
  const finalClassName = className ? `${baseClasses} ${className}` : baseClasses;

  if (end - start >= 0.999) {
    return <circle cx="0" cy="0" r={r} stroke={color} strokeWidth="16" fill="none" className={finalClassName} style={mergedStyle} {...rest} />;
  }

  const pStart = polarToCartesian(0, 0, r, start);
  const pEnd = polarToCartesian(0, 0, r, end);
  
  // 1 if angle > 180 deg, 0 otherwise
  const largeArcFlag = end - start <= 0.5 ? "0" : "1";
  
  // sweepFlag is 1 for clockwise
  const d = `M ${pStart.x} ${pStart.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${pEnd.x} ${pEnd.y}`;

  return <path d={d} stroke={color} strokeWidth="16" fill="none" strokeLinecap="butt" className={finalClassName} style={mergedStyle} {...rest} />;
}

export default function App() {
  const [initialSetup] = useState(() => readSetupFromUrl());
  const [intervals, setIntervals] = useState(initialSetup.intervals);
  const [lambda, setLambda] = useState(initialSetup.lambda);
  const [hiddenMixedComboKeys, setHiddenMixedComboKeys] = useState(initialSetup.hiddenMixedComboKeys);
  const [fixTotalLength, setFixTotalLength] = useState(initialSetup.fixTotalLength);
  const [targetTotalLength, setTargetTotalLength] = useState(initialSetup.targetTotalLength);
  const [copyStatus, setCopyStatus] = useState('idle');
  const [jsonInput, setJsonInput] = useState('');
  const [jsonStatus, setJsonStatus] = useState('idle');

  const svgRef = useRef(null);
  const [dragState, setDragState] = useState({ id: null, offset: 0 });

  // 1. Calculate A (wrapped segments with colors)
  const renderA = useMemo(() => {
    let result = [];
    intervals.forEach(i => {
      let s = i.start;
      let e = i.start + i.width;
      getWrappedSegments(s, e).forEach(seg => {
        result.push({ id: i.id, start: seg[0], end: seg[1], color: i.color });
      });
    });
    return result;
  }, [intervals]);

  // 2. Calculate A + A (blended colors)
  const renderAPlusA = useMemo(() => {
    let result = [];
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i; j < intervals.length; j++) {
        let int1 = intervals[i];
        let int2 = intervals[j];
        let s = int1.start + int2.start;
        let e = (int1.start + int1.width) + (int2.start + int2.width);
        let blendedColor = blendMultipleColors([int1.color, int2.color]);
        getWrappedSegments(s, e).forEach(seg => {
          result.push({ start: seg[0], end: seg[1], color: blendedColor });
        });
      }
    }
    return result;
  }, [intervals]);

  // 3. Calculate lambda * A
  const renderLambdaA = useMemo(() => {
    let result = [];
    intervals.forEach(i => {
      let s = lambda * i.start;
      let e = lambda * (i.start + i.width);
      getWrappedSegments(s, e).forEach(seg => {
        result.push({ start: seg[0], end: seg[1], color: i.color });
      });
    });
    return result;
  }, [intervals, lambda]);

  const mixedCombinations = useMemo(() => {
    let result = [];
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i; j < intervals.length; j++) {
        for (let k = 0; k < intervals.length; k++) {
          let int1 = intervals[i];
          let int2 = intervals[j];
          let int3 = intervals[k];
          const labels = intervals.length <= 2 ? ['I', 'J'] : intervals.map((_, index) => `A${index + 1}`);
          result.push({
            key: `${int1.id}:${int2.id}:${int3.id}`,
            label: `${labels[i]} + ${labels[j]} - ${lambda}${labels[k]}`,
            int1,
            int2,
            int3,
            color: blendMultipleColors([int1.color, int2.color, int3.color]),
          });
        }
      }
    }
    return result;
  }, [intervals, lambda]);

  const canFilterMixedCombinations = intervals.length >= 1 && intervals.length <= 2;

  // 4. Calculate A + A - lambda * A (blended colors)
  const renderAPlusAMinusLambdaA = useMemo(() => {
    let result = [];
    const hiddenKeys = new Set(hiddenMixedComboKeys);
    mixedCombinations.forEach(combo => {
      if (canFilterMixedCombinations && hiddenKeys.has(combo.key)) return;

      let sumStart = combo.int1.start + combo.int2.start;
      let sumEnd = (combo.int1.start + combo.int1.width) + (combo.int2.start + combo.int2.width);
      let scaledStart = -lambda * combo.int3.start;
      let scaledEnd = -lambda * (combo.int3.start + combo.int3.width);
      let s = sumStart + Math.min(scaledStart, scaledEnd);
      let e = sumEnd + Math.max(scaledStart, scaledEnd);
      getWrappedSegments(s, e).forEach(seg => {
        result.push({ start: seg[0], end: seg[1], color: combo.color });
      });
    });
    return result;
  }, [mixedCombinations, canFilterMixedCombinations, hiddenMixedComboKeys, lambda]);

  const disjointA = useMemo(() => getDisjointSegments(renderA), [renderA]);
  const measureA = disjointA.measure;
  
  const measureAPlusA = useMemo(() => calculateMeasure(renderAPlusA), [renderAPlusA]);
  const measureLambdaA = useMemo(() => calculateMeasure(renderLambdaA), [renderLambdaA]);
  const measureAPlusAMinusLambdaA = useMemo(() => calculateMeasure(renderAPlusAMinusLambdaA), [renderAPlusAMinusLambdaA]);
  
  const totalIntervalLength = useMemo(() => (
    intervals.reduce((sum, interval) => sum + interval.width, 0)
  ), [intervals]);
  const displayedTotalLength = fixTotalLength ? targetTotalLength : totalIntervalLength;

  useEffect(() => {
    if (!fixTotalLength) {
      setTargetTotalLength(totalIntervalLength);
    }
  }, [fixTotalLength, totalIntervalLength]);

  const shareState = useMemo(() => ({
    v: 1,
    intervals: intervals.map(interval => ({
      id: interval.id,
      start: Number(interval.start.toFixed(6)),
      width: Number(interval.width.toFixed(6)),
      color: interval.color,
    })),
    lambda,
    fixTotalLength,
    targetTotalLength: Number(displayedTotalLength.toFixed(6)),
    hiddenMixedComboKeys,
  }), [intervals, lambda, fixTotalLength, displayedTotalLength, hiddenMixedComboKeys]);

  const shareUrl = useMemo(() => buildShareUrl(shareState), [shareState]);
  const currentStateJson = useMemo(() => JSON.stringify(shareState, null, 2), [shareState]);

  const applySetup = useCallback((setup) => {
    setIntervals(setup.intervals);
    setLambda(setup.lambda);
    setHiddenMixedComboKeys(setup.hiddenMixedComboKeys);
    setFixTotalLength(setup.fixTotalLength);
    setTargetTotalLength(setup.targetTotalLength);
    setDragState({ id: null, offset: 0 });
  }, []);

  const handleCopyShareLink = useCallback(async () => {
    if (!shareUrl) return;

    try {
      await copyText(shareUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
    window.setTimeout(() => setCopyStatus('idle'), 1600);
  }, [shareUrl]);

  const handleCopyStateJson = useCallback(async () => {
    try {
      await copyText(currentStateJson);
      setJsonStatus('copied');
    } catch {
      setJsonStatus('copy-failed');
    }
    window.setTimeout(() => setJsonStatus('idle'), 1600);
  }, [currentStateJson]);

  const handleImportStateJson = useCallback(() => {
    try {
      const setup = normalizeSharedSetup(JSON.parse(jsonInput));
      applySetup(setup);
      setJsonStatus('imported');
    } catch {
      setJsonStatus('invalid');
    }
    window.setTimeout(() => setJsonStatus('idle'), 2200);
  }, [applySetup, jsonInput]);

  const addInterval = useCallback(() => {
    setIntervals(prev => {
      const usedLength = prev.reduce((sum, interval) => sum + interval.width, 0);
      const width = fixTotalLength ? 0 : Math.min(0.1, Math.max(0, 1 - usedLength));
      const newInterval = {
        id: Date.now(),
        start: 0.5,
        width,
        color: BASE_COLORS[prev.length % BASE_COLORS.length],
      };
      newInterval.start = snapStartToAllowed(newInterval.start, newInterval.width, prev, 0);
      return packIntervalsClockwise([...prev, newInterval], newInterval.id);
    });
  }, [fixTotalLength]);

  const removeInterval = useCallback((id) => {
    setIntervals(prev => {
      const next = prev.filter(i => i.id !== id);
      if (!fixTotalLength) return next;
      return packIntervalsClockwise(scaleIntervalsToTotal(next, targetTotalLength), next[0]?.id);
    });
  }, [fixTotalLength, targetTotalLength]);

  const updateIntervalColor = useCallback((id, value) => {
    setIntervals(prev => prev.map(i => i.id === id ? { ...i, color: value } : i));
  }, []);

  const moveIntervalStart = useCallback((id, requestedStart) => {
    setIntervals(prev => {
      const interval = prev.find(i => i.id === id);
      if (!interval) return prev;

      const others = prev.filter(i => i.id !== id);
      const snappedStart = snapStartToAllowed(requestedStart, interval.width, others, interval.start);
      return prev.map(i => i.id === id ? { ...i, start: snappedStart } : i);
    });
  }, []);

  const changeIntervalWidth = useCallback((id, requestedWidth) => {
    setIntervals(prev => {
      const intervalIndex = prev.findIndex(i => i.id === id);
      if (intervalIndex === -1) return prev;

      const requested = clamp(requestedWidth, 0, 1);
      let next;

      if (fixTotalLength) {
        next = resizeWithFixedTotal(prev, intervalIndex, requested, targetTotalLength);
      } else {
        next = resizeWithinMaxTotal(prev, intervalIndex, requested, 1);
      }

      return packIntervalsClockwise(next, id);
    });
  }, [fixTotalLength, targetTotalLength]);

  const handleFixTotalLengthChange = useCallback((checked) => {
    setFixTotalLength(checked);
    if (checked) {
      setIntervals(prev => packIntervalsClockwise(scaleIntervalsToTotal(prev, targetTotalLength), prev[0]?.id));
    }
  }, [targetTotalLength]);

  const handleTargetTotalLengthChange = useCallback((value) => {
    const nextTarget = clamp(value, 0, 1);
    setTargetTotalLength(nextTarget);
    setIntervals(prev => packIntervalsClockwise(scaleIntervalsToTotal(prev, nextTarget), prev[0]?.id));
  }, []);

  const toggleMixedCombination = useCallback((key) => {
    setHiddenMixedComboKeys(prev => (
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]
    ));
  }, []);

  // Pointer interaction for dragging intervals directly on the SVG
  const getAngleFromEvent = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const angleInRadians = Math.atan2(dy, dx);
    let angleInTurns = (angleInRadians / (2 * Math.PI)) + 0.25;
    return (angleInTurns + 1) % 1; // Map strictly to [0, 1)
  }, []);

  const handlePointerDown = useCallback((e, segId) => {
    e.target.setPointerCapture(e.pointerId);
    const angle = getAngleFromEvent(e);
    const interval = intervals.find(i => i.id === segId);
    if (!interval) return;
    
    const offset = signedCircularDelta(angle, interval.start);
    setDragState({ id: segId, offset });
  }, [intervals, getAngleFromEvent]);

  const handlePointerMove = useCallback((e, segId) => {
    if (dragState.id !== segId) return;
    
    const angle = getAngleFromEvent(e);
    moveIntervalStart(segId, angle - dragState.offset);
  }, [dragState, getAngleFromEvent, moveIntervalStart]);

  const handlePointerUp = useCallback((e) => {
    e.target.releasePointerCapture(e.pointerId);
    setDragState({ id: null, offset: 0 });
  }, []);

  const RADIUS_A = 60;
  const RADIUS_LAMBDA = 100;
  const RADIUS_PLUS = 140;
  const RADIUS_MIXED = 180;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8 flex flex-col items-center">
      
      <div className="max-w-[1600px] w-full">
        <header className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">Circle Group Visualizer</h1>
              <p className="text-slate-600">
                Explore additive combinatorics on the circle group <InlineMath>{'\\mathbb{T} = \\mathbb{R}/\\mathbb{Z}'}</InlineMath>. Visualizing interval sets <InlineMath>{'A'}</InlineMath>, sumsets <InlineMath>{'A+A'}</InlineMath>, dilations <InlineMath>{'\\lambda A'}</InlineMath>, and mixed sets <InlineMath>{'A+A-\\lambda A'}</InlineMath>.
              </p>
            </div>
            <button
              onClick={handleCopyShareLink}
              className="shrink-0 bg-slate-900 hover:bg-slate-700 text-white px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-bold"
              title="Copy shareable setup link"
            >
              {copyStatus === 'copied' ? <Check size={16} /> : <Copy size={16} />}
              {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy Failed' : 'Copy current state link'}
            </button>
          </div>
        </header>

        <div className="flex flex-col xl:flex-row gap-8 items-start">
          <div className="flex flex-col lg:flex-row gap-8 flex-1 min-w-0 w-full">
          
          {/* Canvas Section */}
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col items-center justify-center min-h-[500px]">
            <svg ref={svgRef} viewBox="-250 -250 500 500" className="w-full max-w-[500px] h-auto overflow-visible touch-none">
              
              {/* Grid & Axes */}
              {[0, 0.25, 0.5, 0.75].map(turn => {
                const p1 = polarToCartesian(0, 0, 40, turn);
                const p2 = polarToCartesian(0, 0, 220, turn);
                return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#e2e8f0" strokeWidth="2" strokeDasharray="4 4" key={`axis-${turn}`} />
              })}
              
              <text x="0" y="-235" textAnchor="middle" className="text-sm font-semibold fill-slate-400">0</text>
              <text x="235" y="0" textAnchor="start" alignmentBaseline="middle" className="text-sm font-semibold fill-slate-400">1/4</text>
              <text x="0" y="235" textAnchor="middle" alignmentBaseline="hanging" className="text-sm font-semibold fill-slate-400">1/2</text>
              <text x="-235" y="0" textAnchor="end" alignmentBaseline="middle" className="text-sm font-semibold fill-slate-400">3/4</text>

              {/* Background Tracks */}
              <circle cx="0" cy="0" r={RADIUS_A} stroke="#f1f5f9" strokeWidth="16" fill="none" />
              <circle cx="0" cy="0" r={RADIUS_LAMBDA} stroke="#f1f5f9" strokeWidth="16" fill="none" />
              <circle cx="0" cy="0" r={RADIUS_PLUS} stroke="#f1f5f9" strokeWidth="16" fill="none" />
              <circle cx="0" cy="0" r={RADIUS_MIXED} stroke="#f1f5f9" strokeWidth="16" fill="none" />

              {/* Plotted Arcs */}
              {renderA.map((seg, i) => (
                <Arc 
                  key={`A-${i}`} 
                  r={RADIUS_A} 
                  start={seg.start} 
                  end={seg.end} 
                  color={seg.color}
                  className={dragState.id === seg.id ? "opacity-100 cursor-grabbing" : "hover:opacity-100 cursor-grab"}
                  onPointerDown={(e) => handlePointerDown(e, seg.id)}
                  onPointerMove={(e) => handlePointerMove(e, seg.id)}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{ touchAction: 'none' }}
                />
              ))}
              {renderLambdaA.map((seg, i) => (
                <Arc key={`L-${i}`} r={RADIUS_LAMBDA} start={seg.start} end={seg.end} color={seg.color} />
              ))}
              {renderAPlusA.map((seg, i) => (
                <Arc key={`P-${i}`} r={RADIUS_PLUS} start={seg.start} end={seg.end} color={seg.color} />
              ))}
              {renderAPlusAMinusLambdaA.map((seg, i) => (
                <Arc key={`M-${i}`} r={RADIUS_MIXED} start={seg.start} end={seg.end} color={seg.color} />
              ))}
            </svg>

            {/* Legend inside canvas area */}
            <div className="mt-8 flex flex-wrap justify-center gap-6">
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Inner Ring:</div>
                <span className="font-bold text-sm text-slate-800">Set A.</span>
                <span className="font-bold text-sm text-slate-500 font-mono">{measureA.toFixed(3)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Middle Ring:</div>
                <span className="font-bold text-sm text-slate-800">{lambda}A.</span>
                <span className="font-bold text-sm text-slate-500 font-mono">{measureLambdaA.toFixed(3)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Third Ring:</div>
                <span className="font-bold text-sm text-slate-800">A + A.</span>
                <span className="font-bold text-sm text-slate-500 font-mono">{measureAPlusA.toFixed(3)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Outer Ring:</div>
                <span className="font-bold text-sm text-slate-800">A + A - {lambda}A.</span>
                <span className="font-bold text-sm text-slate-500 font-mono">{measureAPlusAMinusLambdaA.toFixed(3)}</span>
              </div>
            </div>
          </div>

          {/* Controls Section */}
          <div className="w-full lg:w-[400px] flex flex-col gap-6">
            
            {/* Set A Intervals */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold text-lg">Define Intervals (Set A)</h2>
                <button 
                  onClick={addInterval}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-1.5 rounded-lg transition-colors flex items-center text-sm font-medium"
                >
                  <Plus size={16} /> <span className="ml-1 pr-1">Add</span>
                </button>
              </div>

              <div className="space-y-4">
                {intervals.map((interval, index) => {
                  const otherIntervals = intervals.filter(i => i.id !== interval.id);
                  const forbiddenSegments = getForbiddenStartSegments(interval.width, otherIntervals);
                  const startBackground = forbiddenStartBackground(forbiddenSegments);
                  const widthBackground = fixTotalLength ? maxValueBackground(targetTotalLength) : undefined;

                  return (
                    <div key={interval.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 relative group" style={{ borderLeftColor: interval.color, borderLeftWidth: '6px' }}>
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <input 
                            type="color" 
                            value={interval.color}
                            onChange={(e) => updateIntervalColor(interval.id, e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer p-0 border border-slate-200 bg-white"
                            title="Pick interval color"
                          />
                          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Interval {index + 1}</h3>
                        </div>
                        <button 
                          onClick={() => removeInterval(interval.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                          title="Remove interval"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <label className="font-medium text-slate-700">Start Position</label>
                            <input 
                              type="number" 
                              step="0.01" 
                              min="0" max="1"
                              value={Number(interval.start).toString()}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val)) moveIntervalStart(interval.id, val);
                              }}
                              className="w-20 px-1 text-right border border-slate-200 rounded font-mono text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={interval.start}
                            onChange={(e) => moveIntervalStart(interval.id, parseFloat(e.target.value))}
                            className="interval-start-range w-full"
                            style={{ background: startBackground }}
                          />
                        </div>
                        
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <label className="font-medium text-slate-700">Width</label>
                            <input 
                              type="number" 
                              step="0.001" 
                              min="0" max="1"
                              value={Number(interval.width).toString()}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val)) changeIntervalWidth(interval.id, val);
                              }}
                              className="w-20 px-1 text-right border border-slate-200 rounded font-mono text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <input 
                            type="range" min="0" max="1" step="0.001" 
                            value={interval.width}
                            onChange={(e) => changeIntervalWidth(interval.id, parseFloat(e.target.value))}
                            className={fixTotalLength ? "interval-start-range w-full" : "w-full accent-blue-500"}
                            style={widthBackground ? { background: widthBackground } : undefined}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {intervals.length === 0 && (
                  <div className="text-center p-6 text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    No intervals. The set A is currently empty.
                  </div>
                )}
              </div>
            </div>

            {/* Total Length Constraint */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="font-bold text-lg">Total Length</h2>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fixTotalLength}
                    onChange={(e) => handleFixTotalLengthChange(e.target.checked)}
                    className="h-4 w-4 accent-blue-500"
                  />
                  Fixed
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm mb-1">
                  <label className="font-medium text-slate-700">Total</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    max="1"
                    value={Number(displayedTotalLength).toString()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) handleTargetTotalLengthChange(val);
                    }}
                    className="w-20 px-1 text-right border border-slate-200 rounded font-mono text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={displayedTotalLength}
                  onChange={(e) => handleTargetTotalLengthChange(parseFloat(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs font-bold text-slate-500">
                  <span>Current</span>
                  <span className={fixTotalLength ? 'text-blue-600 font-mono' : 'font-mono'}>
                    {totalIntervalLength.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>

          </div>
          </div>

          <div className="w-full xl:w-[420px] xl:shrink-0 flex flex-col gap-6">
            {/* Lambda Multiplier */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="font-bold text-lg mb-4">Scalar Multiplier (<InlineMath>{'\\lambda'}</InlineMath>)</h2>
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <label className="font-medium text-slate-700">Value of <InlineMath>{'\\lambda'}</InlineMath></label>
                  <span className="text-emerald-600 font-bold font-mono">{lambda}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setLambda(l => l - 1)}
                    className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors font-bold text-lg"
                  >
                    -
                  </button>
                  <input 
                    type="number" step="1" 
                    value={lambda}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setLambda(isNaN(val) ? 0 : val);
                    }}
                    className="w-full text-center text-lg font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg h-10 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button 
                    onClick={() => setLambda(l => l + 1)}
                    className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors font-bold text-lg"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {canFilterMixedCombinations && (
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-4 gap-3">
                  <h2 className="font-bold text-lg">Mixed Ring Terms</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setHiddenMixedComboKeys([])}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors text-xs font-bold"
                    >
                      All
                    </button>
                    <button
                      onClick={() => setHiddenMixedComboKeys(mixedCombinations.map(combo => combo.key))}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors text-xs font-bold"
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-2 gap-2">
                  {mixedCombinations.map(combo => (
                    <label
                      key={combo.key}
                      className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenMixedComboKeys.includes(combo.key)}
                        onChange={() => toggleMixedCombination(combo.key)}
                        className="h-4 w-4 accent-sky-500"
                      />
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: combo.color }} />
                      <span className="text-sm font-bold text-slate-700 font-mono">{combo.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h2 className="font-bold text-lg">State JSON</h2>
                <button
                  onClick={handleCopyStateJson}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-bold"
                >
                  {jsonStatus === 'copied' ? <Check size={16} /> : <Copy size={16} />}
                  {jsonStatus === 'copied' ? 'Copied' : jsonStatus === 'copy-failed' ? 'Copy Failed' : 'Copy current JSON'}
                </button>
              </div>

              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder="Paste state JSON"
                spellCheck="false"
                className="w-full min-h-40 resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  onClick={handleImportStateJson}
                  disabled={!jsonInput.trim()}
                  className="bg-slate-900 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg transition-colors text-sm font-bold"
                >
                  Import JSON
                </button>
                <div className="min-h-5 text-right text-xs font-bold">
                  {jsonStatus === 'imported' && <span className="text-emerald-600">Imported</span>}
                  {jsonStatus === 'invalid' && <span className="text-red-500">Invalid JSON</span>}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
