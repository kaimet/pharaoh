// --- Judging System ---

const playerTime = () => curSongTime - (dynamicInputOffset * playbackRate) / 1000;


const AM = AccuracyMeter(); 
//AM.init(); not needed if we call setModes()
// these are lower boundaries for accuracy modes. These accuracies will be at the bottom of the canvas
AM.SetModes(90, 94, 96.5, 98); // builds the 4-mode table and resets internal state


/** --- JUDGING SYSTEM OVERVIEW ---
// The judging system determines player performance. It's built on a few core concepts:
//
// 1. Note States: Every note in the chart is given a state ('pending', 'hit', 'missed', etc.)
//    stored in the `noteStates` array. Gameplay is the process of changing these states.
//
// 2. Timing Windows: A player's input is judged based on its temporal distance from a note's
//    actual time. Small windows (e.g., PERFECT_WINDOW_MS) are used for high scores,
//    while a larger window (MISS_WINDOW_MS) determines if the note was hit at all.
//
// 3. Auto-Calibration (dynamicInputOffset): The game continuously tracks the player's raw
//    hit errors (how physically early/late they are). The average of these errors becomes
//    the `dynamicInputOffset`, which automatically compensates for hardware latency or a
//    player's natural timing tendencies. This offset is used when calculating accuracy.
//
// 4. Weighted Scoring: Not all notes are equal. Tap notes and hold heads have a higher
//    impact on the final score percentage than hold note releases, as defined by their respective
//    WEIGHT constants.
*/
function resetJudgingState(startTime) {
    clearUnderlay();
		
		noteStates = [];
    hitErrors = [];
		hitFeedbackEffects = [];
		mistakeRecapEffects = [];
    totalWeightedScore = 0;
    totalWeight = 0;
		curAccuracy = 100;
    missCount = 0;
		consMisses = 0;
    if (autoCalibrate) {
				dynamicInputOffset = 70; // reasonable default
		} else if (fixedInputOffset !== null) {
				dynamicInputOffset = fixedInputOffset;
		} else {
				dynamicInputOffset = 70;
		}

    keysHeld = { 0: false, 1: false, 2: false, 3: false };
    recentNoteScores = [];
    accuracyFlash.opacity = 0;
		
		AM.reset();


    const pendingHolds = {};

    measures.forEach((measure, measureIndex) => {
        const notesInMeasure = measure.length;
        if (notesInMeasure === 0) return;

        measure.forEach((line, lineIndex) => {
            const beat = measureIndex * 4 + (lineIndex / notesInMeasure) * 4;
            const time = songTiming.getTimeAtBeat(beat);
						const totalOffset = songInfo.offset + additionalOffset;
						const minJudgeTime = startTime + totalOffset;

            for (let i = 0; i < 4; i++) {
                const noteType = line[i];
                const state = time > minJudgeTime ? 'pending' : 'irrelevant';

                if (noteType === '1') { // Tap note
                    noteStates.push({ beat, time, lane: i, state, type: 'tap' });
                } else if (noteType === '2' || noteType === '4') { // Hold Head or Roll Head
                    // Create the note object once
                    const holdNote = { beat, time, lane: i, state, type: 'hold' };
                    // Add it to the main list
                    noteStates.push(holdNote);
                    // And store a reference to it
                    pendingHolds[i] = holdNote;
                } else if (noteType === '3') { // Hold Tail
                    if (pendingHolds[i]) {
                        // Find the original note object using the reference...
                        // ...and UPDATE it with the end time.
                        pendingHolds[i].endBeat = beat;
                        pendingHolds[i].endTime = time;
                        pendingHolds[i] = null; // Clear the reference
                    }
                }
            }
        });
    });
    
    // Handle holds at the very end of a song that have no '3' tail note
    for(const lane in pendingHolds) {
        if(pendingHolds[lane]) {
            pendingHolds[lane].endTime = Infinity;
        }
    }

    noteStates.sort((a, b) => a.time - b.time);
		
		// Find the time of the first note that will actually be judged.
    firstJudgableNoteTime = Infinity; 
    for (const note of noteStates) {
        if (note.state === 'pending') {
            firstJudgableNoteTime = note.time - missWindow() / 1000;
            break; 
        }
    }
		
    updateJudgementUI();
    document.getElementById('judgementDisplay').style.display = 'flex';
}

// --- USER INPUT  ---

function handleKeyPressDuringPlay(e) {
    if (!isPlaying) return;
		
		const lane = keybinds[e.code];
		// If the pressed key is not an assigned gameplay key,
		// prevent its default browser action (like scrolling or focusing the next element on Tab)
		if (lane === undefined) {
				e.preventDefault();
				return;
		}

		// Set key as held, preventing re-triggering logic
		if (keysHeld[lane]) return;
		keysHeld[lane] = true;

		
		const userVolume = parseFloat(document.getElementById('userVolume').value);
		//playSound(assistClapBuffer, 0, userVolume);  // doesn't useful because of input delay 


		// --- CALIBRATION MODE ---
		// If the current time is before the first real note, we are in CALIBRATION mode.
		// This means beats that quantized to 8th notes are used for adjusting input offset
		if (playerTime() < firstJudgableNoteTime) {
				
				// Step 1: Find the target beat based on player's perceived time (intent).
				const pTime = playerTime(); 
				const currentBeat = songTiming.getBeatAtTime(pTime);
				const quantization = 0.5; // 8th notes

				// Step 2: Identify the two closest potential targets (the beat before and after).
				const previousTargetBeat = Math.floor(currentBeat / quantization) * quantization;
				const nextTargetBeat = previousTargetBeat + quantization;

				// Step 3: Get the real-world time in seconds for both potential targets.
				const timeOfPreviousBeat = songTiming.getTimeAtBeat(previousTargetBeat);
				const timeOfNextBeat = songTiming.getTimeAtBeat(nextTargetBeat);
				
				// Step 4: Find which of the two targets the player's tap was actually closer to.
				const diffToPrevious = Math.abs(pTime - timeOfPreviousBeat);
				const diffToNext = Math.abs(pTime - timeOfNextBeat);
				
				const targetTime = (diffToPrevious < diffToNext) ? timeOfPreviousBeat : timeOfNextBeat;
				
				// Step 5: Calculate the raw, physical error against the chosen target.
				// We use curSongTime here because it's the physical timestamp of the key press.
				const rawError = ((curSongTime - targetTime) * 1000) / playbackRate;

				// Step 6: Update the calibration offset if the tap was reasonable.
				if (rawError > -20 && rawError < 150) { 
						// --- keep previous behavior when autoCalibrate is ON, otherwise keep a fixed offset ---
						if (autoCalibrate) {
								hitErrors.push(rawError);
								dynamicInputOffset = hitErrors.reduce((a, b) => a + b, 0) / hitErrors.length;
						} else if (fixedInputOffset !== null) {
								// keep locked value
								dynamicInputOffset = fixedInputOffset;
						}
						// refresh UI
						updateJudgementUI();
				}

		} else {   // --- NORMAL JUDGING MODE ---

// Strict Mode is like this: if user tap the wrong note and there are notes in other lanes
// and we are withing their miss window, than we mark those notes as misses.
// The logic is: if we playing a musical instrument and actually producing sound 
// than such wrong note clearly would be a misstake. Although in such analogy it would be
// a misstake even if there are no notes in other lanes but I'll let it slide.
// Basically, this mode prevents you from swiftly correct your mistake.
				const strictMode = true;
				
				// start judjing after the first keypress 
				// (it would be set to true already if we started before the first note) 
				isJudge = true; 
				
				let closestNote = null;
				let minDiff = Infinity;

				for(const note of noteStates) {
						if (note.lane === lane && note.state === 'pending') {
								const diff = Math.abs(playerTime() - note.time);
								if (diff < minDiff) {
										minDiff = diff;
										closestNote = note;
								}
						}
				}

				if (closestNote && minDiff <= (missWindow() / 1000)) {
						const rawError = ((curSongTime - closestNote.time) * 1000) / playbackRate;
						
						// --- keep previous behavior when autoCalibrate is ON, otherwise keep a fixed offset ---
						if (autoCalibrate) {
								hitErrors.push(rawError);
								dynamicInputOffset = hitErrors.reduce((a, b) => a + b, 0) / hitErrors.length;
						} else if (fixedInputOffset !== null) {
								// keep locked value
								dynamicInputOffset = fixedInputOffset;
						}
						
						const calibratedError = rawError - dynamicInputOffset;
						
						const accuracy = calculateAccuracy(Math.abs(calibratedError), perfectWindow(), missWindow());
						processScoreEvent(accuracy, TAP_NOTE_WEIGHT);
						SetHitGlowEffect(closestNote, accuracy, calibratedError);
						
						totalWeightedScore += accuracy * TAP_NOTE_WEIGHT;
						totalWeight += TAP_NOTE_WEIGHT;

						if (closestNote.type === 'tap') {
								closestNote.state = 'hit';
						} else if (closestNote.type === 'hold') {
								closestNote.state = 'active';
						}

						updateJudgementUI();

				} else if (strictMode) {
						// --- Strict Mode Logic ---
						// If the key press did not hit a note in its own lane, check for notes
						// in other lanes that are currently active and penalize them.
						const pTime = playerTime();
						let notesMissedInOtherLanes = false;

						for (const note of noteStates) {
								// Check for a pending note in a DIFFERENT lane that is within the miss window
								if (note.state === 'pending' && note.lane !== lane && Math.abs(pTime - note.time) < (missWindow() / 1000)) {
										note.state = 'missed';
										missCount++;
										notesMissedInOtherLanes = true;

										// Apply scoring penalties, mirroring the logic from handleMisses()
										if (note.type === 'hold') {
												processScoreEvent(0, TAP_NOTE_WEIGHT);
												processScoreEvent(0, HOLD_RELEASE_WEIGHT);
												SetHitGlowEffect(note, 0, 0);
												SetHitGlowEffect(note, 0, 0, false);
												totalWeight += TAP_NOTE_WEIGHT + HOLD_RELEASE_WEIGHT;
										} else {
												processScoreEvent(0, TAP_NOTE_WEIGHT);
												SetHitGlowEffect(note, 0, 0);
												totalWeight += TAP_NOTE_WEIGHT;
										}
								}
						}

						if (notesMissedInOtherLanes) {
								updateJudgementUI();
						}
				}
		}
}

function handleKeyRelease(e) {
    if (e.repeat) return;
    const lane = keybinds[e.code];
    if (lane === undefined || !isPlaying) return;

    keysHeld[lane] = false;

    // Find if we were in the middle of an active hold on this lane
    let activeHold = null;
    for (const note of noteStates) {
        if (note.lane === lane && note.state === 'active') {
            activeHold = note;
            break;
        }
    }

    if (activeHold) {
        const pTime = playerTime();

        // LOGIC: Was the hold dropped before the valid release window even started?
        if (activeHold.endTime && pTime < activeHold.endTime - (holdMissWindow() / 1000)) {
            // This is a dropped hold. Judge as a miss.
            activeHold.state = 'missed_release';
            //missCount++; - doesn't count as a miss
            processScoreEvent(0, HOLD_RELEASE_WEIGHT); 
						SetHitGlowEffect(activeHold, 0, 0, false);
            totalWeight += HOLD_RELEASE_WEIGHT;
        } else {
            // Otherwise, we are within the release window. Judge it normally.
            const rawError = ((curSongTime - activeHold.endTime) * 1000) / playbackRate;
            const calibratedError = rawError - dynamicInputOffset;
            
            // Mark the entire hold note as complete.
            activeHold.state = 'hit';
             // Get the base 0-100 score for the release
            const accuracy = calculateAccuracy(Math.abs(calibratedError), holdPerfectWindow(), holdMissWindow());
            processScoreEvent(accuracy, HOLD_RELEASE_WEIGHT);
						SetHitGlowEffect(activeHold, accuracy, calibratedError, false);
						// Add the weighted score and the hold's specific weight to our totals
            totalWeightedScore += accuracy * HOLD_RELEASE_WEIGHT;
            totalWeight += HOLD_RELEASE_WEIGHT;
        }
        updateJudgementUI();
    }
}

function handleMisses() {
    let missesFound = false;
    const pTime = playerTime();

    for(const note of noteStates) {
        // Scenario 1: Missed a tap note or a hold head entirely
        if(note.state === 'pending' && pTime > note.time + (missWindow() / 1000)) {
            if (!isJudge) {
								note.state = 'irrelevant';
								return;
						}
						
						note.state = 'missed';
            missCount++;
            missesFound = true;

            // If we missed a hold's head, we also automatically miss its release.
            // This means we must add BOTH weights to the total and process TWO score events.
            if (note.type === 'hold') {
                processScoreEvent(0, TAP_NOTE_WEIGHT);     
                processScoreEvent(0, HOLD_RELEASE_WEIGHT);   
								SetHitGlowEffect(note, 0, 0);  
								SetHitGlowEffect(note, 0, 0, false);
                totalWeight += TAP_NOTE_WEIGHT;
                totalWeight += HOLD_RELEASE_WEIGHT;
            } else {
                processScoreEvent(0, TAP_NOTE_WEIGHT);     
								SetHitGlowEffect(note, 0, 0);  
                totalWeight += TAP_NOTE_WEIGHT;
            }
        }

        // Scenario 2: Held a note for too long and missed the release window.
        if (note.type === 'hold' && note.state === 'active' && pTime > note.endTime + (holdMissWindow() / 1000)) {
						note.state = 'missed_release';
						processScoreEvent(0, HOLD_RELEASE_WEIGHT);   
						SetHitGlowEffect(note, 0, 0, false);
						totalWeight += HOLD_RELEASE_WEIGHT;
						missesFound = true;
        }
    }
		
    if (missesFound) updateJudgementUI();
}

function calculateAccuracy(calibratedErrorMs, perfectW, missW) {
    if (calibratedErrorMs <= perfectW) return 100;
    if (calibratedErrorMs >= missW) return 0;
    // Linear interpolation between perfect and miss window
    return 100 * (1 - (calibratedErrorMs - perfectW) / (missW - perfectW));
}

function updateJudgementUI() {
    // weighted average
    curAccuracy = totalWeight > 0 ? totalWeightedScore / totalWeight : 100;
		
    document.getElementById('accuracyDisplay').textContent = curAccuracy.toFixed(2);
    document.getElementById('missesDisplay').textContent = missCount;
    document.getElementById('offsetDisplay').textContent = dynamicInputOffset.toFixed(0);
		
		AM.note(curAccuracy); // we call it right after curAccuracy is calculated
}

function processScoreEvent(score, weight) {
    // Calculate the player's recent WEIGHTED performance baseline.
    let recentWeightedAverage = 93;
    if (recentNoteScores.length > 0) {
        let weightedSum = 0;
        let weightSum = 0;
        recentNoteScores.forEach(event => {
            weightedSum += event.score * event.weight;
            weightSum += event.weight;
        });
        if (weightSum > 0) {
            recentWeightedAverage = weightedSum / weightSum;
        }
    }
    
    // Add the new event to our long-term accuracy history.
    recentNoteScores.push({ score, weight });
    if (recentNoteScores.length > SCORE_HISTORY_LENGTH) {
        recentNoteScores.shift();
    }
    
    // Calculate the 'impact' and add it to the short-term history for flash processing.
    const deviation = recentWeightedAverage - score;
    const impact = deviation * weight;
    
    // Only track negative impacts (errors) for flashing.
    if (impact > 0) {
        impactHistory.push({ impact, time: performance.now() });
    }

}

function SetHitGlowEffect(note, accuracy, error, tap = true) {
		// if more then 5 misses one after another, that's most likely coz user's not playing
		if (accuracy === 0) { 
				consMisses++;
				if (consMisses > 5) return;  
		} else {
				consMisses = 0;
		}
		
		const beat = tap ? note.beat : note.endBeat;
		const coords = getCoordinatesFromBeat(beat, note.lane);
		if (coords) {
				let color = '0, 0, 0'; // 			Black for misses
				if (accuracy === 100) { //
						color = '0, 150, 0'; // 		Green for Marvelous
				} else if (accuracy > 80) { //
						color = '0, 180, 180';   // Cyan for > 80%
				} else if (accuracy > 50) { //
						color = '77, 00, 210'; // 	Blue for > 50%
				} else if (accuracy > 0) { //
						color = '200, 0, 0'; //			Red for < 50%
				}

				const r = (tap ? 30 : 15) * (accuracy == 0 ? 1.2 : 1);
				const dur = 2500; //(accuracy == 0 ? 9000 : 2500);
				const drift = error * (tap ? 1.5 : 0.5)
				                    * (AM._state().currentModeIndex < 3 ? 1 : 3);//amplify precision on finest mode
				
				hitFeedbackEffects.push({
						x: coords.x,
						y: coords.y,
						startTime: performance.now(),
						color: color,
						maxRadius: r,
						duration: dur,
						horizontalDrift: drift
				});
				
				if (accuracy === 100) { // additional periferal glow for marvelous
						hitFeedbackEffects.push({
								x: coords.x,
								y: coords.y,
								startTime: performance.now(),
								color: '255, 255, 0',
								maxRadius: r * 1.2,
								duration: dur,
								horizontalDrift: drift
						});
				}
				
				SetMistakeRecapEffect(accuracy, error, coords, tap);
		}
}

function SetMistakeRecapEffect(accuracy, error, coords, tap = true) {
    if (accuracy == 100) return;
		
		const color = accuracy == 0 ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 0, 0, 0.02)';
		let r = accuracy == 0 ? 15 : CHART_CONSTANTS.NOTE_SIZE / 2;
		if (!tap) r /= 2;
		let drift = accuracy == 0 ? 0: error * 0.15;
		if (!tap) drift /= 2;
		
		mistakeRecapEffects.push({
				x: coords.x,
				y: coords.y,
				startTime: performance.now(),
				color: color,
				maxRadius: r,
				duration: 2000,
				horizontalDrift: drift
		});
}


