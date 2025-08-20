-------- from ui.js file -----------

/**
 * --- CLICK-TO-PLAY HANDLER ---
 * This function acts as a bridge between the visual, offset-unaware canvas
 * and the offset-aware timing engine of `playSong`.
 *
 * The `playSong` function uses a "Contaminated Clock" model for simplicity in the judging
 * logic. This means that if you give it a beat, playback will actually
 * start at a time corresponding to that beat PLUS the total timing offset. If we were to
 * pass a pure beat directly from the canvas, playback would start earlier or later 
 * (depending on audio offset) than where the user clicked.
 *
 * So, we perform an inverse transformation to "pre-compensate" the beat with negative offsets.
 */
    const canvasContainer = document.getElementById('canvasContainer');
    canvasContainer.addEventListener('click', (event) => {
        if (isLoadingSong) return;
				
				const rect = event.target.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

				const totalOffset = songInfo.offset + additionalOffset;
				// Get the pure beat from the visual coordinates
        let targetBeat = getBeatFromCoordinates(x, y);
				// The inverse transformation
				const targetTime = songTiming.getTimeAtBeat(targetBeat);
				targetBeat = songTiming.getBeatAtTime(targetTime - totalOffset);
				
        if (targetBeat !== null) {
            playSong(targetBeat); // Call playSong with the pre-compensated beat
        }
    });
		
		
------- from keypress.js file -------------


/**
 * Play/Stop shortcut handlers (Enter, Backquote, Escape)
 */
function handlePlayStopShortcuts(e) {
    if (e.code === 'Enter') {
        if (isLoadingSong) {
					userWantToPlay = true; // playback will start when song is loaded
					return;
				}
        e.preventDefault();
        playSong();
        return true;
    }
    if (e.code === 'Backquote') {
        if (isLoadingSong) return;
        e.preventDefault();
        playSong(lastStartBeat);
        return true;
    }
    if (e.code === 'Escape') {
        e.preventDefault();
        stopSong();
        return true;
    }
    return false;
}


-----  from chart.js file  --------------


function initChart() {
    if (allCharts.length === 0) return;
    const selector = document.getElementById('chartSelector');
    const selectedChart = allCharts[parseInt(selector.value)];

    chartMeter = parseInt(selectedChart.meter, 10);
    lastSelectedDifficulty = chartMeter;
    
    stopSong(); // after lastSelectedDifficulty is set because stopSong calls saveSettings
		
    // Create the unified timing object for this chart
    songTiming = createUnifiedTiming(songInfo.bpms, songInfo.stops, songInfo.warps);
    
    const notesData = selectedChart.notes.replace(/\/\/.*/g, '');
    measures = notesData
			.split(',')
			.map(m =>
				m
					.split('\n')
					.map(line => line.trim())        // << strip spaces on each line
					.filter(line => line.length > 0) // ignore empty lines
			);
    chartHash = cyrb128(JSON.stringify(measures));
    noteBeats = getNoteBeats(measures);
		firstNoteBeat = noteBeats.length > 0 ? noteBeats[0] : 0;
    noteTimings = noteBeats.map(beat => songTiming.getTimeAtBeat(beat)); 
		firstNoteTime = noteTimings.length > 0 ? noteTimings[0] : 0;
		lastNoteTime = noteTimings.length > 0 ? noteTimings[noteTimings.length - 1] : 0;
		lastStartBeat = 0;
    
    let bpmsForProcessing = [...songInfo.bpms];
    if (bpmsForProcessing.length > 0) {
        const lastBpm = bpmsForProcessing[bpmsForProcessing.length - 1];
        bpmsForProcessing.push({ beat: 99999, bpm: lastBpm.bpm }); // some dirty fix
    }
    simplifiedBpms = simplifyBpmsForChart(bpmsForProcessing);
		
    drawChart();
		
		displayBestScore();
		updateJudgementDisplayFromHistory();
}


---------------  from game.js file  ------------------


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
function playSong(startFromBeat = 0) {
    if (allCharts.length === 0) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    stopSong();
		document.getElementById('songSelector').blur();
		document.getElementById('chartSelector').blur();
		document.getElementById('audioOffset').blur();
    document.getElementById('judgementDisplay').scrollIntoView({ behavior: 'smooth' });
		userWantToPlay = false;
		
		// The pre-compensation logic in click handlers can produce a negative beat
    // if the click is near the start and chart has positive offset. So, we must handle this case.
		if (startFromBeat < 0) {
        startFromBeat = 0;
    }
		
		if (startFromBeat > 0) lastStartBeat = startFromBeat;

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
    startTime = audioContext.currentTime - (initialGameClockTime / playbackRate);
    
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
        songSource.start(0, physicalAudioOffset);
    }
    
    isPlaying = true;
    gameLoop();
}


