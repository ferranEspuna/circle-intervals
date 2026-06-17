import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';

const EPSILON = 1e-9;
const BASE_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'];

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
  const [intervals, setIntervals] = useState([
    { id: 1, center: 0.15, width: 0.1, color: BASE_COLORS[0] },
    { id: 2, center: 0.65, width: 0.15, color: BASE_COLORS[1] },
  ]);
  const [lambda, setLambda] = useState(3);
  const [hiddenMixedComboKeys, setHiddenMixedComboKeys] = useState([]);

  const svgRef = useRef(null);
  const [dragState, setDragState] = useState({ id: null, offset: 0 });

  // 1. Calculate A (wrapped segments with colors)
  const renderA = useMemo(() => {
    let result = [];
    intervals.forEach(i => {
      let s = i.center - i.width / 2;
      let e = i.center + i.width / 2;
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
        let s = (int1.center - int1.width / 2) + (int2.center - int2.width / 2);
        let e = (int1.center + int1.width / 2) + (int2.center + int2.width / 2);
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
      let s = lambda * (i.center - i.width / 2);
      let e = lambda * (i.center + i.width / 2);
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

      let sumStart = (combo.int1.center - combo.int1.width / 2) + (combo.int2.center - combo.int2.width / 2);
      let sumEnd = (combo.int1.center + combo.int1.width / 2) + (combo.int2.center + combo.int2.width / 2);
      let scaledStart = -lambda * (combo.int3.center - combo.int3.width / 2);
      let scaledEnd = -lambda * (combo.int3.center + combo.int3.width / 2);
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
  
  const scaleMax = 2;

  const addInterval = useCallback(() => {
    setIntervals(prev => [
      ...prev, 
      { id: Date.now(), center: 0.5, width: 0.1, color: BASE_COLORS[prev.length % BASE_COLORS.length] }
    ]);
  }, []);

  const removeInterval = useCallback((id) => {
    setIntervals(prev => prev.filter(i => i.id !== id));
  }, []);

  const updateInterval = useCallback((id, field, value) => {
    setIntervals(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
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
    
    // Calculate how far the click was from the interval's exact center
    let offset = angle - interval.center;
    // Normalize offset to be between -0.5 and 0.5
    if (offset > 0.5) offset -= 1;
    if (offset < -0.5) offset += 1;
    
    setDragState({ id: segId, offset });
  }, [intervals, getAngleFromEvent]);

  const handlePointerMove = useCallback((e, segId) => {
    if (dragState.id !== segId) return;
    
    const angle = getAngleFromEvent(e);
    let newCenter = angle - dragState.offset;
    newCenter = ((newCenter % 1) + 1) % 1; // Ensure wrap-around safely
    
    updateInterval(segId, 'center', newCenter);
  }, [dragState, getAngleFromEvent, updateInterval]);

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
      
      <div className="max-w-6xl w-full">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Circle Group Visualizer</h1>
          <p className="text-slate-600">
            Explore additive combinatorics on the circle group {"$\\mathbb{T} = \\mathbb{R}/\\mathbb{Z}$"}. Visualizing interval sets {"$A$"}, sumsets {"$A+A$"}, dilations {"$\\lambda A$"}, and mixed sets {"$A+A-\\lambda A$"}.
          </p>
        </header>

        <div className="flex flex-col lg:flex-row gap-8">
          
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
                <span className="font-bold text-sm text-slate-800">Set A</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Middle Ring:</div>
                <span className="font-bold text-sm text-slate-800">{lambda}A</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Third Ring:</div>
                <span className="font-bold text-sm text-slate-800">A + A</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm text-slate-500">Outer Ring:</div>
                <span className="font-bold text-sm text-slate-800">A + A - {lambda}A</span>
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
                {intervals.map((interval, index) => (
                  <div key={interval.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 relative group" style={{ borderLeftColor: interval.color, borderLeftWidth: '6px' }}>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <input 
                          type="color" 
                          value={interval.color}
                          onChange={(e) => updateInterval(interval.id, 'color', e.target.value)}
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
                          <label className="font-medium text-slate-700">Center Position</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            min="0" max="1"
                            value={Number(interval.center).toString()}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) updateInterval(interval.id, 'center', val);
                            }}
                            className="w-20 px-1 text-right border border-slate-200 rounded font-mono text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.01" 
                          value={interval.center}
                          onChange={(e) => updateInterval(interval.id, 'center', parseFloat(e.target.value))}
                          className="w-full accent-blue-500"
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
                              if (!isNaN(val)) updateInterval(interval.id, 'width', val);
                            }}
                            className="w-20 px-1 text-right border border-slate-200 rounded font-mono text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.001" 
                          value={interval.width}
                          onChange={(e) => updateInterval(interval.id, 'width', parseFloat(e.target.value))}
                          className="w-full accent-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                
                {intervals.length === 0 && (
                  <div className="text-center p-6 text-sm text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    No intervals. The set A is currently empty.
                  </div>
                )}
              </div>
            </div>

            {/* Lambda Multiplier */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="font-bold text-lg mb-4">Scalar Multiplier ({"$\\lambda$"})</h2>
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <label className="font-medium text-slate-700">Value of {"$\\lambda$"}</label>
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

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
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
            
          </div>
        </div>

        {/* Density Charts */}
        <div className="mt-8 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="font-bold text-lg text-slate-800 mb-6">Density Measurements</h2>
          
          {/* Base Set A Density */}
          <div className="mb-8">
            <div className="flex justify-between items-end mb-2">
              <h3 className="font-semibold text-sm text-slate-700">Density of Base Set A</h3>
              <span className="text-xs text-slate-500 font-mono font-bold">Range: [0, 1]</span>
            </div>
            
            <div className="relative pt-6 pb-2">
              {/* Tick Marks */}
              <div className="absolute top-0 left-0 right-0 bottom-2 pointer-events-none z-10">
                {Array.from({ length: 11 }, (_, i) => i / 10).map((tick) => (
                  <div 
                    key={tick}
                    className="absolute top-0 flex flex-col items-center h-full"
                    style={{ left: `${tick * 100}%`, transform: 'translateX(-50%)' }}
                  >
                    <span className="text-[10px] sm:text-xs font-bold text-slate-500 bg-white px-0.5 sm:px-1 mb-1">
                      {tick === 0 || tick === 1 ? tick : tick.toFixed(1)}
                    </span>
                    <div className="w-px flex-1 bg-slate-800 opacity-20 mix-blend-multiply"></div>
                  </div>
                ))}
              </div>
              
              <div className="h-10 bg-slate-100 rounded-lg overflow-hidden flex w-full relative border border-slate-200">
                {/* Set A Bar */}
                <div className="h-full flex relative shrink-0" style={{ width: `${measureA * 100}%` }}>
                  {measureA > 0 && disjointA.pieces.map((p, i) => (
                    <div key={i} className="h-full" style={{ width: `${(p.width / measureA) * 100}%`, backgroundColor: p.color }} />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white pointer-events-none" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    {measureA > 0.04 ? measureA.toFixed(2) : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Outer Rings Density */}
          <div>
            <div className="flex justify-between items-end mb-2">
              <h3 className="font-semibold text-sm text-slate-700">Density of Sumset & Dilate</h3>
              <span className="text-xs text-slate-500 font-mono font-bold">Range: [0, 2]</span>
            </div>
            
            <div className="relative pt-8 pb-2">
              {/* Tick Marks and Grid Lines */}
              <div className="absolute top-0 left-0 right-0 bottom-2 pointer-events-none z-10">
                {Array.from({ length: scaleMax + 1 }).map((_, i) => (
                  <div 
                    key={i}
                    className={`absolute top-0 flex flex-col items-center h-full ${i === 1 ? 'z-20' : ''}`}
                    style={{ left: `${(i / scaleMax) * 100}%`, transform: 'translateX(-50%)' }}
                  >
                    <span className={`text-xs font-bold bg-white px-1 mb-1 ${i === 1 ? 'text-red-600 ring-1 ring-red-200 rounded shadow-sm px-2 py-0.5' : 'text-slate-500'}`}>
                      {i}
                    </span>
                    <div className={`flex-1 mix-blend-multiply ${i === 1 ? 'w-0.5 bg-red-400 opacity-80' : 'w-px bg-slate-800 opacity-20'}`}></div>
                  </div>
                ))}
              </div>
              
              <div className="h-10 bg-slate-100 rounded-lg overflow-hidden flex w-full relative border border-slate-200">
                {/* A+A Bar */}
                <div 
                  className="h-full shrink-0 bg-violet-500 flex items-center justify-center text-xs font-bold text-white transition-all duration-300"
                  style={{ width: `${(measureAPlusA / scaleMax) * 100}%` }}
                  title={`Density of A+A: ${measureAPlusA.toFixed(4)}`}
                >
                  {(measureAPlusA / scaleMax) > 0.04 ? measureAPlusA.toFixed(2) : ''}
                </div>
                
                {/* Lambda A Bar */}
                <div 
                  className="h-full shrink-0 bg-emerald-500 flex items-center justify-center text-xs font-bold text-white transition-all duration-300"
                  style={{ width: `${(measureLambdaA / scaleMax) * 100}%` }}
                  title={`Density of ${lambda}A: ${measureLambdaA.toFixed(4)}`}
                >
                  {(measureLambdaA / scaleMax) > 0.04 ? measureLambdaA.toFixed(2) : ''}
                </div>
              </div>
            </div>
          </div>
            
          <div className="flex flex-wrap justify-center gap-6 mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-500 uppercase">|A| =</span>
              <span className="text-sm text-slate-800 font-bold">{measureA.toFixed(3)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-500 uppercase">|A + A| =</span>
              <span className="text-sm text-slate-800 font-bold">{measureAPlusA.toFixed(3)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-500 uppercase">|{lambda}A| =</span>
              <span className="text-sm text-slate-800 font-bold">{measureLambdaA.toFixed(3)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-500 uppercase">|A + A - {lambda}A| =</span>
              <span className="text-sm text-slate-800 font-bold">{measureAPlusAMinusLambdaA.toFixed(3)}</span>
            </div>
            <div className="flex items-center gap-2 border-l pl-6 border-slate-200">
              <span className="font-bold text-sm text-slate-500">Outer Rings Sum:</span>
              <span className="text-sm text-slate-800 font-bold">{(measureAPlusA + measureLambdaA).toFixed(3)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
