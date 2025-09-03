/** Chart specific functions 
  *
  * Parsing .sm, .scc files
  * Simplify BPMs for chart visualisation
  * Initialize new chart
  */


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
    
    // Remove/clear lines that are skipped by negative stops or warps (this updates measures in-place)
    removeSkippedNotes(measures);
    
    // chart hash for remembering high scores
    chartHash = cyrb128(JSON.stringify(measures));
    
    noteBeats = getNoteBeats(measures);
    firstNoteBeat = noteBeats.length > 0 ? noteBeats[0] : 0;
    noteTimings = noteBeats.map(beat => songTiming.getTimeAtBeat(beat)); 
    firstNoteTime = noteTimings.length > 0 ? noteTimings[0] : 0;
    lastNoteTime = noteTimings.length > 0 ? noteTimings[noteTimings.length - 1] : 0;
    
    // Clear quick-starts
    lastStartBeat = 0;
    if (typeof quickStarts !== 'undefined') {
        quickStarts.fill(null);
        if (typeof updateQuickStartsDisplay === 'function') updateQuickStartsDisplay();
    }
    
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

/**
 * Remove (replace with '0000') notes in measures that are skipped by negative STOPs or WARPS.
 * This is run *after* songTiming = createUnifiedTiming(...) and *before* getNoteBeats(measures).
 *
 * - preserves measure subdivision counts (we replace lines with '0000' rather than removing lines)
 * - handles multiple stops/warps
 */
function removeSkippedNotes(measures) {
    if (!songTiming || !songInfo) return;

    // Defensive local copies
    const bpms = songInfo.bpms || [];
    const stops = songInfo.stops || [];
    const warps = songInfo.warps || [];

    // 1) Build a timing with negative stops zeroed to compute removed spans for negative STOPs
    const stopsNoNeg = stops.map(s => ({ beat: s.beat, duration: s.duration < 0 ? 0 : s.duration }));
    const timingNoNeg = createUnifiedTiming(bpms, stopsNoNeg, warps || []);

    // Small epsilon for numeric noise
    const EPS_SKIP = 1e-3;
    // Helper to mark beats in (beatA, beatB] as skipped: replace lines with '0000'
    function markBeatRangeSkipped(beatA, beatB) {
        if (!(beatB > beatA + 1e-12)) return;
        for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
            const measure = measures[measureIndex];
            const linesCount = measure.length;
            if (linesCount === 0) continue;
            for (let lineIndex = 0; lineIndex < linesCount; lineIndex++) {
                const beat = measureIndex * 4 + (lineIndex / linesCount) * 4;
                if (beat > beatA && beat <= beatB) {
                    // Replace the line with a no-note line preserving subdivision count.
                    measure[lineIndex] = '0000';
                }
            }
        }
    }

    // 2) Process negative STOPs: compute how many seconds were removed and map that
    //    to a beat range in timingNoNeg, then mark those beats as skipped.
    if (stops && stops.length) {
        for (const stop of stops) {
            if (!stop || typeof stop.duration === 'undefined') continue;
            if (stop.duration >= 0) continue; // only negative stops here

            const stopBeat = stop.beat;
            // time at stopBeat in real timeline and no-neg timeline
            const tWith = songTiming.getTimeAtBeat(stopBeat);
            const tNo = timingNoNeg.getTimeAtBeat(stopBeat);
            const delta = tNo - tWith;
            if (delta <= EPS_SKIP) continue;

            // targetTime in no-neg timeline marks end of removed chunk
            const targetTime = tNo + delta;
            // find beat in no-neg timeline that corresponds to targetTime
            const beatEnd = timingNoNeg.getBeatAtTime(targetTime);

            markBeatRangeSkipped(stopBeat, beatEnd);
        }
    }

    // 3) Process WARPS: warp at beat -> skip (beat, beat+length]
    if (warps && warps.length) {
        for (const warp of warps) {
            if (!warp || typeof warp.beat === 'undefined' || typeof warp.length === 'undefined') continue;
            const warpBeat = warp.beat;
            const warpLen = warp.length;
            if (!(warpLen > 1e-9)) continue;
            const beatEnd = warpBeat + warpLen;
            markBeatRangeSkipped(warpBeat, beatEnd);
        }
    }
}


function simplifyBpmsForChart(sortedBPMs) {
    if (noteBeats.length === 0 || sortedBPMs.length <= 1) return sortedBPMs.length > 0 ? sortedBPMs : [{beat: 0, bpm: 60}];
    const simplifiedBpms = [];
    if (sortedBPMs[0].beat > 0) {
        simplifiedBpms.push({ beat: 0, bpm: sortedBPMs[0].bpm });
    }
    simplifiedBpms.push(sortedBPMs[0]);
    let lastBpm = sortedBPMs[0].bpm;
    for (let i = 0; i < noteBeats.length - 1; i++) {
        const startBeat = noteBeats[i];
        const endBeat = noteBeats[i + 1];
        const timeAtStart = songTiming.getTimeAtBeat(startBeat);
        const timeAtEnd = songTiming.getTimeAtBeat(endBeat);
        const timeDelta = timeAtEnd - timeAtStart;
        const beatDelta = endBeat - startBeat;
        if (timeDelta > 0.001 && beatDelta > 0) {
            const effectiveBpm = (beatDelta / timeDelta) * 60;
            if (Math.abs(effectiveBpm - lastBpm) > 0.5) {
                simplifiedBpms.push({ beat: startBeat, bpm: effectiveBpm });
                lastBpm = effectiveBpm;
            }
        }
    }
    return simplifiedBpms;
}

function getNoteBeats(measures) {
    const noteBeats = new Set();
    measures.forEach((measure, measureIndex) => {
        const notesInMeasure = measure.length;
        if (notesInMeasure === 0) return;
        measure.forEach((line, lineIndex) => {
            if (line.includes('1') || line.includes('2') || line.includes('4')) {
                const beat = measureIndex * 4 + (lineIndex / notesInMeasure) * 4;
                noteBeats.add(beat);
            }
        });
    });
    return Array.from(noteBeats).sort((a, b) => a - b);
}


// Parsing   *************************************************

function parseChartFile(fileContent) {
    const allBlocks = fileContent.split(/#NOTES:|#NOTEDATA:/);
    const metadataBlock = allBlocks[0];
    songInfo = parseMetadata(metadataBlock);
    const parsedCharts = [];
    for (let i = 1; i < allBlocks.length; i++) {
        const currentBlock = allBlocks[i];
        const smParts = currentBlock.trim().split(':');
        if (smParts.length >= 6 && smParts[0].trim() === 'dance-single') {
            parsedCharts.push({ type: 'dance-single', difficulty: smParts[2].trim() || 'Unknown', meter: smParts[3].trim() || '?', notes: smParts.slice(5).join(':').split(';')[0].trim() });
            continue;
        }
        const precedingBlock = allBlocks[i - 1];
        const typeMatch = precedingBlock.match(/#STEPSTYPE:(.*?);/s);
        if (typeMatch && typeMatch[1].trim() === 'dance-single') {
            const diffMatch = precedingBlock.match(/#DIFFICULTY:(.*?);/s);
            const meterMatch = precedingBlock.match(/#METER:(.*?);/s);
            parsedCharts.push({ type: 'dance-single', difficulty: diffMatch ? diffMatch[1].trim() : 'Unknown', meter: meterMatch ? meterMatch[1].trim() : '?', notes: currentBlock.split(';')[0].trim() });
        }
    }
    return parsedCharts;
}

function parseMetadata(metadataBlock) {
    const STOP_OFFSET = 0.01; // small beat nudge so notes on same beat are processed before stops

    const info = { title: '', artist: '', offset: 0, bpms: [], stops: [], warps: [] }; 
    let titleMatch = metadataBlock.match(/#TITLE:(.*?);/);
    if (titleMatch) info.title = titleMatch[1].trim();
    titleMatch = metadataBlock.match(/#TITLETRANSLIT:(.*?);/);
    if (titleMatch && titleMatch[1].trim().length > 0) info.title = titleMatch[1].trim();

    let artistMatch = metadataBlock.match(/#ARTIST:(.*?);/);
    if (artistMatch) info.artist = artistMatch[1].trim();
    artistMatch = metadataBlock.match(/#ARTISTTRANSLIT:(.*?);/);
    if (artistMatch && artistMatch[1].trim().length > 0) info.artist = artistMatch[1].trim();
    
    const offsetMatch = metadataBlock.match(/#OFFSET:(.*?);/);
    if (offsetMatch) info.offset = parseFloat(offsetMatch[1].trim());

    const bpmsMatch = metadataBlock.match(/#BPMS:(.*?);/s);
    if (bpmsMatch) {
        info.bpms = bpmsMatch[1].trim().split(',').map(entry => {
            const parts = entry.trim().split('=');
            return parts.length === 2 ? { beat: parseFloat(parts[0]), bpm: parseFloat(parts[1]) } : null;
        }).filter(Boolean);
    }
    const stopsMatch = metadataBlock.match(/#STOPS:(.*?);/s);
    if (stopsMatch && stopsMatch[1].trim().length > 0) {
        info.stops = stopsMatch[1].trim().split(',').map(entry => {
            const parts = entry.trim().split('=');
            if (parts.length === 2) {
                // THE FIX: Add a tiny offset to the beat to ensure stops
                // are processed AFTER notes on the same beat.
                const beat = parseFloat(parts[0]) + STOP_OFFSET;
                const duration = parseFloat(parts[1]);
                return { beat, duration };
            }
            return null;
        }).filter(Boolean);
    }
    const warpsMatch = metadataBlock.match(/#WARPS:(.*?);/s);
    if (warpsMatch && warpsMatch[1].trim().length > 0) {
        info.warps = warpsMatch[1].trim().split(',').map(entry => {
            const parts = entry.trim().split('=');
            // We do the same for warps, just in case.
            if (parts.length === 2) {
                const beat = parseFloat(parts[0]) + Number.EPSILON;
                const length = parseFloat(parts[1]);
                return { beat, length };
            }
            return null;
        }).filter(Boolean);
    }
    
    info.bpms.sort((a, b) => a.beat - b.beat);
    info.stops.sort((a, b) => a.beat - b.beat);
    info.warps.sort((a, b) => a.beat - b.beat);
    return info;
}
