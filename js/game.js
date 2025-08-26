// --- Playback and Game Loop ---


/** --- PLAYBACK START LOGIC ---
// This function is the entry point for starting gameplay, whether from the beginning
// or from a specific point. Its main challenge is to correctly
// synchronize the game clock, the audio clock, and the real-world clock.
// It is built upon a "Contaminated Clock" model, which simplifies all downstream
// judging and animation logic by ensuring the main game clock (`curSongTime`)
// is always pre-compensated with the necessary offsets.
//
//  Three clocks are:
//
// 1. The Game Clock (Logical Time): This is the time the player sees, represented by the
//    playhead and used for judging notes. It's calculated using our `songTiming` engine
//    and is independent of the audio file's own timing.
//
// 2. The Audio Clock (Physical Time): This is the actual timestamp inside the MP3/OGG file.
//    This is what the Web Audio API's `songSource.start()` method cares about. Basically, 
//    it's a Logical Time plus offsets.
//
// 3. The Real-World Clock: This is `audioContext.currentTime`, the high-precision clock
//    of the browser itself, which we use as our master reference.
//
/**
 * --- PLAYBACK START LOGIC (CONTAMINATED CLOCK MODEL) ---
 *
 * THE CORE PHILOSOPHY:
 * The master game clock, `curSongTime`, is intentionally "contaminated" with all timing
 * offsets. It is calculated to always represent:
 *   `curSongTime` = `Pure Logical Time` + `Total Offset`
 *
 * BENEFITS OF THIS MODEL:
 * - Judging Is Simple: To judge a note, the logic is a clean `curSongTime - note.time`,
 *   without needing to add offsets at the moment of judgement.
 * - The Game Loop Is Clean: The loop works with a single, authoritative clock.
 *
 * REQUIREMENTS:
 * - Physical Audio must start at a
 *   pure, un-offset time (`physicalAudioOffset = logicalTimeOffset`).
 * - Input Must Be Pre-Compensated: Any code that initiates playback from a specific beat
 *   (like a click handler) must pre-adjust the beat to account for the offset this
 *   function will add. See `onCanvasClick()` for the required implementation.
 */
async function playSong(startFromBeat = 0) {
    if (allCharts.length === 0) return;
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
		// schedule a little into the future to avoid races
		const SLACK = 0.02; // 20 ms
		const scheduledStart = audioContext.currentTime + SLACK;
		
    stopSong();
		document.getElementById('songSelector').blur();
		document.getElementById('chartSelector').blur();
		document.getElementById('audioOffset').blur();
    document.getElementById('chartCanvas').scrollIntoView({ behavior: 'smooth' });
		userWantToPlay = false;
		
		// The pre-compensation logic in click handlers can produce a negative beat
    // if the click is near the start and chart has positive offset. So, we must handle this case.
		if (startFromBeat < 0) {
        startFromBeat = 0;
    }
		
		if (startFromBeat > 0) {
        lastStartBeat = startFromBeat;
        registerQuickStart(startFromBeat); // auto-assign into quickStarts if eligible
    }


    // Determine if this is a full playthrough for high score purposes.
    isFullSongPlay = (startFromBeat < firstNoteBeat);
		
		isJudge = isFullSongPlay; // if false than judging will beging after the first keypress
		
    if (isFullSongPlay) {
        speedDuringPlay = playbackRate;
        playheadDuringPlay = document.getElementById('showPlayhead').checked;
        assistDuringPlay = parseFloat(document.getElementById('assistVolume').value) > 0;
    }
    areControlsLocked = false;

    // --- Time Calculations ---
    
		const totalOffset = songInfo.offset + additionalOffset;
		
    let logicalTimeOffset = startFromBeat > 0 && songTiming ? songTiming.getTimeAtBeat(startFromBeat) : 0;
		
    let physicalAudioOffset = logicalTimeOffset; // Physical audio starts at the pure logical time.
		
    const initialGameClockTime = logicalTimeOffset + totalOffset;
    
		// This formula creates the "contaminated" `curSongTime` for the game loop.
    // `startTime` is a reference point in the past that allows our `gameLoop`
    // to calculate `curSongTime` correctly using the simple formula:
    // `curSongTime = (audioContext.currentTime - startTime) * playbackRate`.
    startTime = scheduledStart - (initialGameClockTime / playbackRate);
    
    // State should be reset based on the pure logical time.
    resetJudgingState(logicalTimeOffset);
		
		// Reset the assist clap scheduler state.
    const firstClapIndex = noteTimings.findIndex(time => time >= initialGameClockTime);
    if (firstClapIndex !== -1) {
        nextClapToScheduleIndex = firstClapIndex;
    } else {
        nextClapToScheduleIndex = 0;
    }
		
		// --- Audio Setup ---
    if (audioBuffer) {
				masterGainNode = audioContext.createGain();
				masterGainNode.connect(audioContext.destination);
        songSource = audioContext.createBufferSource();
        songSource.buffer = audioBuffer;
        songSource.playbackRate.value = playbackRate;
        songGainNode = audioContext.createGain();
        songGainNode.gain.value = Math.pow(parseFloat(document.getElementById('songVolume').value), 2);
        songSource.connect(songGainNode).connect(masterGainNode);
        
				// The first parameter is `when` (in absolute real-world time)
				// (0 is being shortcut of `now`), 
        // The second is `where` (offset within the audio buffer).
        songSource.start(scheduledStart, physicalAudioOffset);
    }
    
    isPlaying = true;
    gameLoop();
}

/**
 * Handles all teardown logic when a song stops, either by the user or by finishing.
 * This includes stopping audio, saving settings, and processing high scores.
 */
function stopSong() {
		saveSettings(); // save settings in local storage
		
    if (songSource) {
        try { songSource.stop(0); } catch(e) {}
        songSource.disconnect();
        songSource = null;
    }
    
    // Disconnect the master channel, silencing all scheduled sounds (like future claps)
    if (masterGainNode) {
        masterGainNode.disconnect();
        masterGainNode = null;
    }

    isPlaying = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    document.getElementById('speedControl').disabled = false; // Re-enable speed control
    document.getElementById('showPlayhead').disabled = false;
    document.getElementById('assistVolume').disabled = false;
    document.getElementById('clapSoundType').disabled = false;
    lastKnownColumnIndex = -1;
    forceShowPlayheadUntil = 0;

    clearOverlay();
		
		// Check if we should save a high score
		if (isFullSongPlay && curSongTime >= lastNoteTime) {
				saveHighScore();
				const key = getHighScoreKey(speedDuringPlay, playheadDuringPlay, assistDuringPlay);
        if (key) {
            sessionPlayHistory[key] = {
                misses: missCount,
                accuracy: parseFloat(document.getElementById('accuracyDisplay').textContent)
            };
        }
				recordRecentPlay(); // Also record that we played it recently
				saveLastPlayedDifficulty();
				
				// Mark song as played in this session and update the selector
				const songKey = `${songInfo.artist}-${songInfo.title}`;
				sessionPlayedSongs.add(songKey);
				
				const selector = document.getElementById('songSelector');
				const selectedOption = selector.options[selector.selectedIndex];
				if (selectedOption && !selectedOption.text.startsWith('🟢')) {
						selectedOption.text = `🟢 ${selectedOption.text.replace('🔵 ', '').replace('🔹 ', '')}`;
				}
		}
		
		isFullSongPlay = false; // Reset for the next run
}

// --- GAME LOOP HELPERS ---

/**
 * @param {number} currentTime is a curSongTime (logical playhead, which includes offsets).
 * @returns {boolean} True if the song should be stopped.
 */
function isSongFinished(currentTime) {
    const GRACE_AFTER_END = 2.0; // seconds to allow misses and animations
    const EPS = 0.050;           // 50 ms epsilon for float-rounding tolerance

    // totalOffset is how much the logical clock is shifted relative to the raw audio clock
    const totalOffset = (typeof songInfo !== 'undefined' ? (songInfo.offset || 0) : 0) + (typeof additionalOffset !== 'undefined' ? additionalOffset : 0);

    const hasRealAudio = (typeof audioBuffer !== 'undefined' && audioBuffer && audioBuffer.duration > 1);

    // compute audio's logical playtime (i.e. audio position) by removing the chart offsets
    const audioPlayTime = currentTime - totalOffset;

    // Compute the latest meaningful scheduled time from noteStates (consider hold endTime)
    let effectiveLast = (typeof lastNoteTime !== 'undefined' ? lastNoteTime : 0);
    if (Array.isArray(noteStates) && noteStates.length) {
        for (const n of noteStates) {
            if (!n) continue;
            if (n.state === 'irrelevant') continue;
            let t = n.time;
            if (n.type === 'hold') {
                if (typeof n.endTime !== 'undefined' && Number.isFinite(n.endTime)) {
                    t = n.endTime;
                } else {
                    // missing/Infinite tail -> do not extend to Infinity; fallback to lastNoteTime
                    t = effectiveLast;
                }
            }
            if (Number.isFinite(t)) effectiveLast = Math.max(effectiveLast, t);
        }
    }

    if (hasRealAudio) {
        // If audioPlayTime >= audioBuffer.duration, the audio really finished.
        // We use EPS to avoid tiny-rounding false positives.
        if (audioPlayTime >= audioBuffer.duration - EPS) {
            // But if there are pending notes scheduled *after* audio end, we should keep going until they finish.
            const pendingAfterAudio = Array.isArray(noteStates) && noteStates.some(
                n => n && n.state === 'pending' && Number.isFinite(n.time) && n.time > audioBuffer.duration + totalOffset - EPS
            );

            if (!pendingAfterAudio) {
                // No late notes — stop as soon as audio finished.
                return true;
            } else {
                // Late notes exist — run until those finish plus a grace period.
                const endBound = Math.max(audioBuffer.duration, effectiveLast - totalOffset);
                return currentTime > (endBound + totalOffset + GRACE_AFTER_END - EPS);
            }
        } else {
            // audio not ended yet
            return false;
        }
    } else {
        // No "real" audio (silent dummy). Finish after the last note + grace.
        return currentTime > (effectiveLast + GRACE_AFTER_END - EPS);
    }
}


/**
 * Locks UI controls during a full song playthrough after the first note passes.
 * @param {number} currentTime - The current `curSongTime`.
 */
function updateControlLocks(currentTime) {
    if (!areControlsLocked && isFullSongPlay && currentTime >= firstNoteTime) {
        document.getElementById('speedControl').disabled = true;
        document.getElementById('showPlayhead').disabled = true;
        document.getElementById('assistVolume').disabled = true;
        document.getElementById('clapSoundType').disabled = true;
        areControlsLocked = true;
    }
}

/**
 * Schedules assist claps to be played in the near future using a just-in-time approach.
 * @param {number} currentTime - The current `curSongTime`.
 */
function scheduleAssistClaps(currentTime) {
    const assistVolume = parseFloat(document.getElementById('assistVolume').value);
    if (assistVolume <= 0) return;

    const scheduleHorizon = currentTime + 0.1; // Schedule sounds 100ms in the future.
    while (nextClapToScheduleIndex < noteTimings.length && noteTimings[nextClapToScheduleIndex] < scheduleHorizon) {
        const time = noteTimings[nextClapToScheduleIndex];
        const scheduleTime = startTime + (time / playbackRate);
        playSound(assistClapBuffer, scheduleTime, assistVolume);
        nextClapToScheduleIndex++;
    }
}

/** // --- DYNAMIC ERROR FLASH LOGIC ---  (Not used. Was replaced by Hit Glows)
		// This system creates a responsive flash that reflects the player's performance
		// over a short "perception window," handling both single large errors and streams of small ones.
		//
		// It works in two parts:
		// 1. The Producer (processScoreEvent): When a note is judged, it calculates the event's
		//    "impact" (how much it hurt the score, scaled by its weight). It then adds this
		//    impact and a timestamp to a short-term list called 'impactHistory'.
		//
		// 2. The Consumer (this block in gameLoop): Every frame, this block:
		//    a. Sums the 'impact' of all events in the 'impactHistory' list that happened
		//       within the last half-second (the PERCEPTION_WINDOW_MS).
		//    b. Translates this 'cumulativeImpact' into a potential flash intensity ('newFlash').
		//    c. If this new intensity is greater than the flash that's currently fading out
		//       ('curFlash'), it sets a new, higher peak for the flash to fade from.
		//    d. It continuously calculates the fading animation, ensuring a smooth decay.
 * @returns {number} The calculated opacity for the flash (0 to 0.7).
 */
function updateGlobalFlash() {
		return 0; // Turns everything off
		
    const now = performance.now();
		const PERCEPTION_WINDOW_MS = 500;       // How far back we look.
		const CUMULATIVE_IMPACT_THRESHOLD = 80; // The sum of impact needed before a flash appears.
		const IMPACT_SENSITIVITY = 500;         // A divisor. Lower = more intense flash for the same error.

		// Prune history: Keep only the events within our perception window.
		impactHistory = impactHistory.filter(event => now - event.time < PERCEPTION_WINDOW_MS);
    const cumulativeImpact = impactHistory.reduce((sum, event) => sum + event.impact, 0);

		// Calculate the potential new flash intensity based on the current window.
    let newFlash = 0;
    if (cumulativeImpact > CUMULATIVE_IMPACT_THRESHOLD) {
        newFlash = Math.min(0.7, cumulativeImpact / IMPACT_SENSITIVITY);
    }

		// Re-trigger the flash if the new error is worse than the current fading flash.
    if (newFlash > curFlash) {
        maxFlash = newFlash;
        accuracyFlash.fadeStartTime = now;
    }

		// Run the fade logic every frame.
    const FADE_DURATION_MS = 5000;
    let currentFlashOpacity = 0;
    if (maxFlash > 0) {
        const elapsedTime = now - accuracyFlash.fadeStartTime;
				// Calculate the current opacity based on the last peak (maxFlash).
        currentFlashOpacity = Math.max(0, maxFlash * (1 - (elapsedTime / FADE_DURATION_MS)));
    }
    curFlash = currentFlashOpacity; // Update global for next frame's comparison
    return currentFlashOpacity;
}


// --- OVERLAY DRAWING HELPERS ---

function clearOverlay() {
    const overlayCanvas = document.getElementById('overlayCanvas');
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function drawPlayhead(currentBeat) {
    if (chartLayoutParams.measuresPerColumn === 0) return;
    const overlayCanvas = document.getElementById('overlayCanvas');
    const ctx = overlayCanvas.getContext('2d');

    const measureIndex = Math.floor(currentBeat / 4);
    const beatInMeasure = currentBeat % 4;
    const colIndex = Math.floor(measureIndex / chartLayoutParams.measuresPerColumn);
    const measureIndexInCol = measureIndex % chartLayoutParams.measuresPerColumn;

    const colXBase = colIndex * chartLayoutParams.columnWidth + chartLayoutParams.border;
    const measureYBase = chartLayoutParams.border + measureIndexInCol * (chartLayoutParams.measureHeight + chartLayoutParams.measureSpacing);
    const yCenter = measureYBase + (beatInMeasure / 4) * chartLayoutParams.measureHeight;

    // place the thin line slightly above the note center
    const offsetAboveNotes = 2; //CHART_CONSTANTS.NOTE_SIZE; // px
    const yLine = Math.round(yCenter - offsetAboveNotes);

    ctx.save();
    // thin center line
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(colXBase - 3, yLine);
    ctx.lineTo(colXBase + (chartLayoutParams.columnWidth - chartLayoutParams.padding) + 3, yLine);
    ctx.stroke();

    // left arrow ">" (triangle pointing right)
    const arrowSize = 8;
    const leftX = colXBase - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.beginPath();
    ctx.moveTo(leftX, yLine);
    ctx.lineTo(leftX + arrowSize, yLine - arrowSize);
    ctx.lineTo(leftX + arrowSize, yLine + arrowSize);
    ctx.closePath();
    ctx.fill();

    // right arrow "<" (triangle pointing left)
    const rightX = colXBase + (chartLayoutParams.columnWidth - chartLayoutParams.padding) + 10;
    ctx.beginPath();
    ctx.moveTo(rightX, yLine);
    ctx.lineTo(rightX - arrowSize, yLine - arrowSize);
    ctx.lineTo(rightX - arrowSize, yLine + arrowSize);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

/**
 * Draws the global accuracy flash on the overlay canvas if it is visible.
 * @param {CanvasRenderingContext2D} ctx - The overlay canvas context.
 * @param {number} flashOpacity - The current opacity of the flash.
 */
function drawGlobalFlash(ctx, flashOpacity) {
    if (flashOpacity > 0) {
        ctx.fillStyle = `rgba(${accuracyFlash.color}, ${flashOpacity})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
}

/**
 * Draws all active, fading hit-glow effects on the overlay canvas.
 * @param {CanvasRenderingContext2D} ctx - The overlay canvas context.
 */
function drawHitGlows(ctx) {
    const now = performance.now();
    for (let i = hitFeedbackEffects.length - 1; i >= 0; i--) {
        const effect = hitFeedbackEffects[i];
        const elapsedTime = now - effect.startTime;

        if (elapsedTime > effect.duration) {
            hitFeedbackEffects.splice(i, 1); // Remove effects that have finished fading
            continue;
        }

        const fadeProgress = elapsedTime / effect.duration;
        const currentOpacity = 0.7 * (1 - fadeProgress);
        const currentRadius = effect.maxRadius * (0.3 + (0.7 * fadeProgress));
        const currentX = effect.x + (effect.horizontalDrift * fadeProgress);

        if (currentOpacity > 0) {
            ctx.fillStyle = `rgba(${effect.color}, ${currentOpacity})`;
            ctx.beginPath();
            ctx.arc(currentX, effect.y, currentRadius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
		
		drawMistakeRecapEffect();
}

/**
 * Draws a permanent visual recap of a note judgement (miss or imperfect hit)
 * onto the underlay canvas. This creates a post-game "smudge" map of mistakes.
 */
function drawMistakeRecapEffect() {
    const ctx = document.getElementById('underlayCanvas').getContext('2d');
		
    const now = performance.now();
    for (let i = mistakeRecapEffects.length - 1; i >= 0; i--) {
        const effect = mistakeRecapEffects[i];
        const elapsedTime = now - effect.startTime;

        if (elapsedTime > effect.duration) {
            mistakeRecapEffects.splice(i, 1); // Remove finished effects
            continue;
        }

        const fadeProgress = elapsedTime / effect.duration;
				
        let r = effect.maxRadius;
				if (effect.horizontalDrift == 0) r *= (0.15 + (0.85 * fadeProgress));
				
        const currentX = effect.x + (effect.horizontalDrift * fadeProgress);

				ctx.fillStyle = effect.color;
				ctx.beginPath();
				ctx.arc(currentX, effect.y, r, 0, 2 * Math.PI);
				ctx.fill();
    }
}

/**
 * Draws the playback speed indicator if the rate is not 1.0x.
 * @param {CanvasRenderingContext2D} ctx - The overlay canvas context.
 */
function drawSpeedIndicator(ctx) {
    if (playbackRate === 1.0) return;
    ctx.save();
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`x${playbackRate.toFixed(1)}`, 10, 30);
    ctx.restore();
}

/**
 * Implements the "Smart Playhead" logic to decide if the playhead should be drawn
 * and triggers the drawing if necessary.
 * @param {CanvasRenderingContext2D} ctx - The overlay canvas context.
 * @param {number} currentTime - The current `curSongTime`.
 */
function handlePlayheadDrawing(currentTime) {
    const currentBeat = songTiming.getBeatAtTime(currentTime);

    // Force playhead to show briefly when switching to a new column
    if (chartLayoutParams.measuresPerColumn > 0) {
        const measureIndex = Math.floor(currentBeat / 4);
        const currentColumnIndex = Math.floor(measureIndex / chartLayoutParams.measuresPerColumn);
        if (currentColumnIndex > lastKnownColumnIndex) {
            forceShowPlayheadUntil = audioContext.currentTime + 0.5;
            lastKnownColumnIndex = currentColumnIndex;
        }
    }

    // Determine if the playhead should be visible this frame
    let shouldDrawPlayhead = document.getElementById('showPlayhead').checked;
    if (!shouldDrawPlayhead && audioContext.currentTime < forceShowPlayheadUntil) {
        shouldDrawPlayhead = true; // Forced by column switch
    }
    if (!shouldDrawPlayhead && noteTimings.length > 1) {
        const nextNoteIndex = noteTimings.findIndex(time => time > currentTime);
        if (nextNoteIndex !== -1) {
            const prevNoteIndex = nextNoteIndex - 1;
            if (prevNoteIndex >= 0) {
                // Also show playhead during long breaks (>= 2 seconds)
                if ((noteTimings[nextNoteIndex] - noteTimings[prevNoteIndex]) / playbackRate >= LONG_PAUSE) {
                    shouldDrawPlayhead = true;
                }
            } else {
                shouldDrawPlayhead = true; // In the intro before the first note
            }
						
						// before the first input if we started not from beggining
						if (!isJudge) shouldDrawPlayhead = true;
						
        } else {
            shouldDrawPlayhead = true; // In the outro after the last note
        }
    }

    if (shouldDrawPlayhead) {
        drawPlayhead(currentBeat);
    }
}

/**
 * Orchestrates all drawing on the overlay canvas.
 * @param {number} currentTime - The current `curSongTime`.
 * @param {number} flashOpacity - The calculated opacity for the global flash.
 */
function drawOverlay(currentTime, flashOpacity, accuracy) {
    const overlayCanvas = document.getElementById('overlayCanvas');
    const overlayCtx = overlayCanvas.getContext('2d');
    clearOverlay();
		
		AM.draw(overlayCanvas, overlayCtx, curAccuracy, bestScore);
		
    drawGlobalFlash(overlayCtx, flashOpacity);
		
    drawHitGlows(overlayCtx);
		
    drawSpeedIndicator(overlayCtx);
		
    handlePlayheadDrawing(currentTime);
}


/** --- MAIN GAME LOOP ---
// This function is the "heartbeat" of the application while a song is playing. It is
// called on every animation frame (typically 60 times per second) via requestAnimationFrame.
//
// ITS CORE RESPONSIBILITIES:
// - Calculate the master song time (`curSongTime`) based on the audio clock. This is the
//   driving force for all other logic.
// - Continuously check for missed notes (`handleMisses`).
// - Schedule just-in-time audio events (like assist claps) for the near future.
// - Drive all dynamic visual updates on the overlay canvas, including the playhead,
//   global flash, local hit glows.
// - Lock/unlock controls based on gameplay state (e.g., during a high-score run).
// */
function gameLoop() {
    if (!isPlaying) return;

    // 1. Calculate the master song time for this frame.
    curSongTime = (audioContext.currentTime - startTime) * playbackRate;

    // 2. Check for game-ending conditions.
    if (isSongFinished(curSongTime)) {
        stopSong();
        return;
    }

    // 3. Handle core game logic.
    handleMisses();
    updateControlLocks(curSongTime);
    scheduleAssistClaps(curSongTime);

    // 4. Calculate visual effect states.
    const flashOpacity = updateGlobalFlash(); // (global flash is not used anymore though)

    // 5. Draw all dynamic elements to the overlay.
    drawOverlay(curSongTime, flashOpacity);

    // 6. Request the next frame.
    animationFrameId = requestAnimationFrame(gameLoop);
}

function onPlaybackRateChange(newRate) {
    playbackRate = newRate;
    if (songSource) songSource.playbackRate.value = playbackRate;

    // Reset calibration samples when auto-calibrating
    if (autoCalibrate) {
        hitErrors = [];
        dynamicInputOffset = 70;
        updateJudgementUI();
    } else if (fixedInputOffset !== null) {
        dynamicInputOffset = fixedInputOffset;
        updateJudgementUI();
    }
}


