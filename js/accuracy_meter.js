/**
================================================================================
Accuracy Meter 
================================================================================

 * ---------------------
 * Draws a horizontal accuracy bar that zooms in as player accuracy improves.
 * It suppose to motivate players to keep accuracy high.
 *
 *  - Default mode: lower bound ~90%.
 *  - Higher precision modes shrink the visible window (e.g. 93%, 96%, etc.)
 *    so the bar stays in view only if accuracy is very high.
 *

Public API (usage)
------------------
- `AM = AccuracyMeter()`                   // create module instance
- `AM.init(options)`                        // optional configuration, then resets
- `AM.SetModes(90, 95, 97.5)`               // helper to set targetMin modes quickly
- `AM.reset()`                              // reset state at song start / retry
- `AM.note(curAccuracy)`                    // call once *per judged note* AFTER updating curAccuracy
- `AM.draw(canvas, ctx, curAccuracy, bestScore?)`  // call once per frame when rendering


Quick example configuration
---------------------------
AM.init({
  minSamplesToConsider: 50,
  ewmaEntryN: 80,         // conservative entry
  ewmaExitN: 20,          // faster exit
  transitionMs: 2000,
  minSecondsBetweenUpgrades: 10,
  immediateDowngradeOnOffscreen: true
});
AM.SetModes(90, 95, 97.5);
AM.reset();

*/

function AccuracyMeter() {
  // ----------------- Defaults / configuration -----------------
  const DEFAULT = {
    // Ordered modes from least precise -> most precise.
    // - entryThreshold = EWMA required to consider entering this mode
    // - recoverThreshold = lowest curAccuracy required entering this mode
    ACC_MODES: [
      { name: 'normal',    targetMin: 90.0,  entryThreshold: -Infinity, recoverThreshold: -Infinity },
      { name: 'mid',       targetMin: 95.0,  entryThreshold: 95.5,    recoverThreshold: 95.0 },
      { name: 'precision', targetMin: 97.5,  entryThreshold: 97.8,    recoverThreshold: 97.0 }
    ],
    baseWidth: 20,                 // thickness when in normal mode
    transitionMs: 2000,            // duration of smooth transition
    minSamplesToConsider: 40,      // minimum samples before upgrades considered
    minSecondsBetweenUpgrades: 10,  // seconds to wait between successive upgrades (default 10s)
    // EWMA asymmetry: choose slower alpha for entry (stable), faster alpha for exit (reactive)
    ewmaEntryN: 80,                // effective window size for entry (smaller alpha)
    ewmaExitN: 20,                 // effective window size for exit  (larger alpha)
    // Immediate downgrade behavior: when settled in a higher mode and the drawn bar WOULD be off-screen
    // do we snap back immediately? (true = immediate snap; false = smooth transition back)
    immediateDowngradeOnOffscreen: false,
    // debug logging (false)
    debug: false
  };

  // ----------------- State -----------------
  let cfg = Object.assign({}, DEFAULT);
  let ACC_MODES = cfg.ACC_MODES;

  // derived
  let NORMAL_MODE = null; // filled in init
  let ACCURACY_ZOOM_SCALE_BASE = 1.0;

  // EWMA state
  let ewmaAccuracy = null;
  let totalSamplesSeen = 0;

  // Mode indices & zoom state
  let currentModeIndex = 0;  // settled mode index (only updated when a transition finishes)
  let pendingModeIndex = 0;  // where we're transitioning to (equals current when idle)
  
  // last upgrade timestamp in ms (performance.now()); -Infinity means no upgrade yet
  let lastUpgradeTime = -Infinity;

  // rendering / transition state (accuracyZoom)
  let accuracyZoom = {
    // these values are in percent (e.g. 90..97.5)
    currentMin: 90,
    currentWidth: cfg.baseWidth,
    startMin: 90,
    targetMin: 90,
    startWidth: cfg.baseWidth,
    targetWidth: cfg.baseWidth,
    startTime: 0,
    duration: cfg.transitionMs
  };

  // precomputed alphas
  let ALPHA_ENTRY = 2 / (cfg.ewmaEntryN + 1);
  let ALPHA_EXIT  = 2 / (cfg.ewmaExitN + 1);

  // simple helpers
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  // debug logger
  function dlog(...args) { if (cfg.debug) console.log('[AccuracyMeter]', ...args); }

  // ----------------- Public API -----------------
  function init(options) {
    if (options) {
      cfg = Object.assign({}, DEFAULT, options);
      // shallow-merge modes if provided
      if (options.ACC_MODES) cfg.ACC_MODES = options.ACC_MODES;
    }
    ACC_MODES = cfg.ACC_MODES;
    NORMAL_MODE = ACC_MODES[0];
    ACCURACY_ZOOM_SCALE_BASE = (100 - NORMAL_MODE.targetMin); // used in computeZoomScaleForTarget
    ALPHA_ENTRY = 2 / (cfg.ewmaEntryN + 1);
    ALPHA_EXIT  = 2 / (cfg.ewmaExitN  + 1);

    // reset state
    reset();
  }

  function reset() {
    ewmaAccuracy = null;
    totalSamplesSeen = 0;
    currentModeIndex = 0;
    pendingModeIndex = 0;
    lastUpgradeTime = performance.now();// first minSecondsBetweenUpgrades without upgrade 

    accuracyZoom.currentMin = NORMAL_MODE.targetMin;
    accuracyZoom.currentWidth = cfg.baseWidth;
    accuracyZoom.startMin = accuracyZoom.currentMin;
    accuracyZoom.startWidth = accuracyZoom.currentWidth;
    accuracyZoom.targetMin = accuracyZoom.currentMin;
    accuracyZoom.targetWidth = accuracyZoom.currentWidth;
    accuracyZoom.startTime = 0;
    accuracyZoom.duration = cfg.transitionMs;

    dlog('reset');
  }

  // Call this on each judged note (pass the same curAccuracy value you will use when drawing).
  function note(curAccuracy) {
    // update counters
    totalSamplesSeen++;

    // EWMA update, asymmetric: if current sample moves ewma up, use entry alpha (slow),
    // else use exit alpha (reactive)
    if (ewmaAccuracy === null) {
      ewmaAccuracy = curAccuracy;
    } else {
      // decide alpha based on whether the sample would increase or decrease the EWMA
      const alpha = (curAccuracy >= ewmaAccuracy) ? ALPHA_ENTRY : ALPHA_EXIT;
      ewmaAccuracy = alpha * curAccuracy + (1 - alpha) * ewmaAccuracy;
    }

    dlog('note', totalSamplesSeen, 'cur', curAccuracy.toFixed(2), 'ewma', ewmaAccuracy.toFixed(3),
         'mode', ACC_MODES[currentModeIndex].name, 'pending', ACC_MODES[pendingModeIndex].name);

    // Evaluate mode decisions driven by curAccuracy (displayed accuracy)
    evaluateModesUsingCur(curAccuracy);
  }

  // Start a transition to a mode index (clamped). immediate=true snaps instantly.
  function requestMode(index, immediate = false) {
    index = Math.max(0, Math.min(ACC_MODES.length - 1, index));
    pendingModeIndex = index;
    const mode = ACC_MODES[index];
    const zoomScale = computeZoomScaleForTarget(mode.targetMin);
    const targetWidth = cfg.baseWidth * zoomScale;

    startAccuracyZoomTransition(mode.targetMin, targetWidth, immediate);

    if (immediate) {
      // commit settled mode index on immediate snap
      currentModeIndex = index;
      pendingModeIndex = index;
    }
    dlog('requestMode', index, mode.name, 'immediate', immediate);
  }

  // Compute zoom scale so visual thickness matches the numeric shrink relative to normal mode
  function computeZoomScaleForTarget(targetMin) {
    // Prevent divide by zero if targetMin == 100 (not expected)
    const denom = (100 - targetMin) || 1e-6;
    const base = (100 - NORMAL_MODE.targetMin) || 1e-6;
    return base / denom;
  }

  // The main evaluator: decides upgrades (smooth) and immediate downgrades
  function evaluateModesUsingCur(curAccuracy) {
    // 1) Immediate downgrade if we're settled in a higher mode and curAccuracy falls below that mode's targetMin.
    const settledModeMin = ACC_MODES[currentModeIndex].targetMin;
    if (currentModeIndex > 0 && curAccuracy < settledModeMin) {
      // find highest lower mode that still contains curAccuracy
      let newIndex = currentModeIndex;
      while (newIndex > 0 && curAccuracy < ACC_MODES[newIndex].targetMin) newIndex--;
      if (newIndex !== currentModeIndex) {
        // immediate or smooth? by preference we use immediate if configured
        const imm = !!cfg.immediateDowngradeOnOffscreen;
        requestMode(newIndex, imm);
        dlog('downgrade immediate', newIndex, ACC_MODES[newIndex].name);
      }
      return;
    }

    // 2) If not settled in a higher mode, consider upgrading one step up if conditions met
    const nextIndex = currentModeIndex + 1;
    if (nextIndex < ACC_MODES.length) {
      const next = ACC_MODES[nextIndex];
      if (totalSamplesSeen >= cfg.minSamplesToConsider
          && ewmaAccuracy !== null
          && ewmaAccuracy >= next.entryThreshold
          && curAccuracy >= next.recoverThreshold) {
            
        // time-based gate
        const now = performance.now();
        if (now - lastUpgradeTime < (cfg.minSecondsBetweenUpgrades * 1000)) {
          return; // skip upgrade attempt for now
        }
        
        // start smooth transition to next mode
        requestMode(nextIndex, /*immediate=*/false);
        dlog('upgrade requested to', nextIndex, next.name);
        return;
      }
    }

    // Otherwise: do not force a revert or interrupt ongoing transitions - let them finish.
  }

  // Transition helper: starts a smooth transition (or immediate snap)
  function startAccuracyZoomTransition(targetMin, targetWidth, immediate = false) {
    const now = performance.now();

    // no-op if already targeting same and not immediate
    if (!immediate && accuracyZoom.targetMin === targetMin && accuracyZoom.targetWidth === targetWidth) return;

    if (immediate) {
      // snap to the target (commit values)
      accuracyZoom.currentMin = targetMin;
      accuracyZoom.currentWidth = targetWidth;
      accuracyZoom.startMin = targetMin;
      accuracyZoom.startWidth = targetWidth;
      accuracyZoom.targetMin = targetMin;
      accuracyZoom.targetWidth = targetWidth;
      accuracyZoom.startTime = 0;
      // set duration in case caller inspects it
      accuracyZoom.duration = cfg.transitionMs;
      dlog('startAccuracyZoomTransition(snap) to', targetMin, 'width', targetWidth);
      return;
    }

    // if a transition is already in progress, advance to current interpolated value to avoid jumps
    if (accuracyZoom.startTime && accuracyZoom.startTime > 0) {
      const elapsed = now - accuracyZoom.startTime;
      const t = Math.min(1, elapsed / (accuracyZoom.duration || cfg.transitionMs));
      const prog = smoothstep(t);
      accuracyZoom.currentMin = lerp(accuracyZoom.startMin, accuracyZoom.targetMin, prog);
      accuracyZoom.currentWidth = lerp(accuracyZoom.startWidth, accuracyZoom.targetWidth, prog);
    }

    // begin new transition from current snapshot
    accuracyZoom.startMin = accuracyZoom.currentMin;
    accuracyZoom.startWidth = accuracyZoom.currentWidth;
    accuracyZoom.targetMin = targetMin;
    accuracyZoom.targetWidth = targetWidth;
    accuracyZoom.startTime = now;
    accuracyZoom.duration = cfg.transitionMs;
    dlog('startAccuracyZoomTransition(smooth) to', targetMin, 'width', targetWidth, 'duration', accuracyZoom.duration);
  }

  // Drawing function: call every frame; it advances interpolation and draws the bar (no clamping).
  // canvas, ctx: canvas element and its 2D context
  // accuracy: current displayed accuracy (curAccuracy)
  // bestScore (optional): if you want to draw a best score marker
  function draw(canvas, ctx, accuracy, bestScore = null) {
    ctx.save();

    // Advance any active zoom transition
    const now = performance.now();
    if (accuracyZoom.startTime && accuracyZoom.startTime > 0) {
      const elapsed = now - accuracyZoom.startTime;
      const t = Math.min(1, elapsed / (accuracyZoom.duration || cfg.transitionMs));
      const eased = smoothstep(t);
      accuracyZoom.currentMin = lerp(accuracyZoom.startMin, accuracyZoom.targetMin, eased);
      accuracyZoom.currentWidth = lerp(accuracyZoom.startWidth, accuracyZoom.targetWidth, eased);

      if (t >= 1) {
        // finalize transition and commit pending mode as settled
        accuracyZoom.startTime = 0;
        accuracyZoom.startMin = accuracyZoom.currentMin;
        accuracyZoom.startWidth = accuracyZoom.currentWidth;
        currentModeIndex = pendingModeIndex;
        lastUpgradeTime = performance.now();   // cooldown starts after transition finished
        dlog('transition finished, currentMode=', ACC_MODES[currentModeIndex].name);
      }
    } else {
      // ensure fields exist
      accuracyZoom.currentMin = accuracyZoom.currentMin || NORMAL_MODE.targetMin;
      accuracyZoom.currentWidth = accuracyZoom.currentWidth || cfg.baseWidth;
    }

    const minAccuracy = accuracyZoom.currentMin;
    const meterWidth = accuracyZoom.currentWidth;

    const range = 100 - minAccuracy || 1;
    
    // --- Grid lines during zoom transitions  ---
    (function drawAutoStepGrid() {
      if (!(accuracyZoom.startTime && accuracyZoom.startTime > 0)) return; // only during transitions

      const DESIRED_LINES = 40; // aim for ~40 lines at densest moment
      const marginAcc = 1.0;
      const rgb = [144, 144, 144];
      const lineWidth = 1;

      // compute densest accuracy range between transition endpoints (startMin->targetMin)
      const startMin = (typeof accuracyZoom.startMin === 'number') ? accuracyZoom.startMin : accuracyZoom.currentMin;
      const targetMin = (typeof accuracyZoom.targetMin === 'number') ? accuracyZoom.targetMin : accuracyZoom.currentMin;
      const startRange = 100 - startMin;
      const targetRange = 100 - targetMin;
      const densestRange = Math.max(startRange, targetRange, 0.0001);

      // compute step so densestRange / step ≈ DESIRED_LINES
      let step = densestRange / DESIRED_LINES;
      // clamp step to sensible floor/ceiling (avoid too tiny or too huge steps)
      step = Math.max(0.01, Math.min(step, 5.0)); // between 0.01 and 5 accuracy units
      step = 0.2;

      // compute drawing bounds
      let startAcc = Math.max(0, minAccuracy - marginAcc);
      let endAcc = Math.min(100 + marginAcc, 100 + marginAcc);
      let startK = Math.floor(startAcc / step);
      let endK = Math.ceil(endAcc / step);

      // transparency depends on lines density
      const alpha = ((startMin + targetMin) / 2 - 90) * 0.05 + 0.3; // (0.32..0.66) 
      
      // draw lines
      ctx.save();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
      ctx.beginPath();

      const pixelMargin = 20;
      for (let k = startK; k <= endK; k++) {
        const a = k * step;
        const ratio = (a - minAccuracy) / (range || 1);
        const yFloat = canvas.height * (1 - ratio);
        if (yFloat < -pixelMargin || yFloat > canvas.height + pixelMargin) continue;
        const y = yFloat; //Math.round(yFloat) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
      }

      ctx.stroke();
      ctx.restore();
    })();


    
    const ratio = (accuracy - minAccuracy) / range; // can be <0 or >1 -> off-screen
    const centerY = canvas.height * (1 - ratio);
    const topY = centerY - (meterWidth / 2);

    // draw the bar (transparent fill)
    ctx.fillStyle = `${ACC_MODES[currentModeIndex].color}5`;
    ctx.fillRect(0, topY, canvas.width, meterWidth);
    
    // draw ewma bar
    //if (DEV_MODE) drawEWMA(canvas, ctx, accuracy, minAccuracy, range);

    // bestScore marker 
    if (typeof bestScore !== 'undefined' && bestScore !== null) {
      const bRatio = (bestScore - minAccuracy) / range;
      const bCenterY = canvas.height * (1 - bRatio);
      const bTop = bCenterY - (meterWidth / 2);
      ctx.strokeStyle = `${ACC_MODES[currentModeIndex].color}b`;
      ctx.lineWidth = 3;
      ctx.setLineDash([5]);
      ctx.strokeRect(0, bTop, canvas.width, meterWidth);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
  
  // qwma bar visualization (for debug)
  function drawEWMA(canvas, ctx, accuracy, minAccuracy, range) {
    if (ewmaAccuracy == null) return;
    
    const ewmaRatio = (ewmaAccuracy - minAccuracy) / range;
    const ewmaCenterY = canvas.height * (1 - ewmaRatio);
    const ewmaTopY = ewmaCenterY - (5 / 2); // 5px thickness
    ctx.fillStyle = 'rgba(200, 0, 255, 0.5)'; // less transparent, same hue
    ctx.fillRect(0, ewmaTopY, canvas.width, 5);
    
    // --- Draw dashed "next-upgrade" line (gray if upgrade is impossible now) ---
    const nextIndex = Math.min(currentModeIndex + 1, ACC_MODES.length - 1);
    if (nextIndex > currentModeIndex) {
      const next = ACC_MODES[nextIndex];
      const entryThreshold = next.entryThreshold;
      if (isFinite(entryThreshold)) { // skip if -Infinity etc
        const entryRatio = (entryThreshold - minAccuracy) / range;
        const entryCenterY = canvas.height * (1 - entryRatio);
        const entryTop = entryCenterY; // 1px line centered at this Y

        // Decide whether upgrade is currently possible (match the same conditions used by the evaluator)
        const now = performance.now();
        const enoughSamples = (typeof totalSamplesSeen === 'number') ? (totalSamplesSeen >= cfg.minSamplesToConsider) : true;
        const ewmaOK = (typeof ewmaAccuracy === 'number') ? (ewmaAccuracy >= entryThreshold) : false;
        const recoverOK = (typeof accuracy === 'number') ? (accuracy >= next.recoverThreshold) : false;

        // cooldown check: support time-based cooldown (minSecondsBetweenUpgrades) if configured,
        // otherwise fall back to note-based cooldown (minNotesBetweenUpgrades) if present.
        let cooldownOK = true;
        if (typeof cfg.minSecondsBetweenUpgrades === 'number' && typeof lastUpgradeTime === 'number') {
          cooldownOK = (now - lastUpgradeTime) >= (cfg.minSecondsBetweenUpgrades * 1000);
        } else if (typeof cfg.minNotesBetweenUpgrades === 'number' && typeof lastUpgradeSample === 'number') {
          cooldownOK = (totalSamplesSeen - lastUpgradeSample) >= cfg.minNotesBetweenUpgrades;
        }

        const upgradePossible = enoughSamples /*&& ewmaOK && recoverOK*/ && cooldownOK;

        // Color: purple when possible, gray when not
        const strokeColor = upgradePossible ? 'rgba(200, 0, 255, 0.9)' : 'rgba(128,128,128,0.7)';

        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(0, entryTop + 0.5);
        ctx.lineTo(canvas.width, entryTop + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

  }
  
  function SetModes(...args) {
  // accept array or variadic args
  let mins = args.length === 1 && Array.isArray(args[0]) ? args[0].slice() : Array.from(args);

  // sanitize: convert to numbers, filter invalid, clamp 0..100
  mins = mins
    .map(v => Number(v))
    .filter(v => Number.isFinite(v))
    .map(v => Math.max(0, Math.min(100, v)));

  if (mins.length === 0) {
    console.warn('[AccuracyMeter] SetModes: no valid mode mins provided');
    return;
  }

  // sort ascending so modes go from least precise -> most precise
  mins.sort((a, b) => a - b);
  
  const colors = [ '#777',
                 '#a5c',
                 '#4b5',
                 '#77f'
                 ];
  
  // build ACC_MODES array: first mode is "normal" with -Infinity thresholds
  const modes = mins.map((targetMin, idx) => {
    if (idx === 0) {
      return {
        name: `mode_${targetMin}`,
        targetMin: targetMin,
        entryThreshold: -Infinity,
        recoverThreshold: -Infinity,
        color: colors[0],
      };
    } else {
      const entryThreshold = targetMin + (100 - targetMin) * 0.02; // 94.12  96.57  98.04
      const recoverThreshold = entryThreshold;
      return {
        name: `mode_${targetMin}`,
        targetMin: targetMin,
        entryThreshold: entryThreshold,
        recoverThreshold: recoverThreshold,
        color: colors[idx],
      };
    }
  });

  // Re-initialize the module with the new modes (other cfg fields keep defaults unless you pass them)
  init({ ACC_MODES: modes });
  dlog('SetModes applied', modes);
}

  // Expose a small API
  return {
    init,
    reset,
    note,      // call per judged note (pass curAccuracy)
    draw,      // call every frame to draw the meter with given curAccuracy (and optional bestScore)
    SetModes,  // wrapper of init, setting modes with lower limits as parameters
    // also expose some internal state for debugging if needed:
    _state: () => ({
      cfg, ACC_MODES, ewmaAccuracy, totalSamplesSeen, currentModeIndex, pendingModeIndex, accuracyZoom
    })
  };
}
