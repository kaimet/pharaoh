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
    /*
    if (bpmsForProcessing.length > 0) {
        const lastBpm = bpmsForProcessing[bpmsForProcessing.length - 1];
        bpmsForProcessing.push({ beat: 99999, bpm: lastBpm.bpm }); // some dirty fix
    }
    */
    simplifiedBpms = simplifyBpmsForChart(bpmsForProcessing);
    
    drawChart();
    
    displayBestScore();
    updateJudgementDisplayFromHistory();
}

/**
 * Remove (replace with '0000') notes in measures that are skipped by WARPS or negative STOPs.
 * Run AFTER: songTiming = createUnifiedTiming(...)
 * Run BEFORE: getNoteBeats(measures)
 *
 * - preserves measure subdivision counts (replace lines with '0000' rather than removing lines)
 * - handles multiple stops/warps
 */
function removeSkippedNotes(measures) {
    if (!songTiming || !songInfo) return;

    // Defensive local copies
    const bpms  = songInfo.bpms  || [];
    const stops = songInfo.stops || [];
    const warps = songInfo.warps || [];

    // Build a monotonic timing for converting seconds -> beats:
    // zero out negative stops only; keep positive stops and warps intact.
    const negStops = stops.filter(s => s && s.duration < 0);
    const timingNoNeg = negStops.length > 0
        ? createUnifiedTiming(
            bpms,
            stops.map(s => (s && s.duration < 0) ? { beat: s.beat, duration: 0 } : s),
            warps
          )
        : songTiming; // if no negative stops, reuse main timing

    const EPS = 1e-9;

    // Collect skip intervals as [startBeat, endBeat], then merge
    const intervals = [];

    // WARPS: skip (beat, beat+length]
    for (const warp of warps) {
        if (!warp || typeof warp.beat !== 'number' || typeof warp.length !== 'number') continue;
        if (warp.length > EPS) {
            intervals.push([warp.beat, warp.beat + warp.length]);
        }
    }

    // Negative STOPs: remove dt seconds from the timeline at that beat.
    // Convert dt to a beat span in the monotonic (no-negative-stops) timing.
    for (const stop of negStops) {
        if (!stop || typeof stop.beat !== 'number' || typeof stop.duration !== 'number') continue;
        const dt = -stop.duration; // seconds removed; positive
        if (dt <= EPS) continue;

        // Pre-event time at that beat in no-negative-stops timing
        const t0 = timingNoNeg.getTimeAtBeat(stop.beat);
        const bEnd = timingNoNeg.getBeatAtTime(t0 + dt);

        if (bEnd > stop.beat + EPS) {
            intervals.push([stop.beat, bEnd]);
        }
    }

    // Merge overlapping/adjacent intervals to minimize work
    intervals.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const merged = [];
    for (const [s, e] of intervals) {
        if (!merged.length || s > merged[merged.length - 1][1] + EPS) {
            merged.push([s, e]);
        } else {
            if (e > merged[merged.length - 1][1]) merged[merged.length - 1][1] = e;
        }
    }

    // Apply skips: replace any line whose beat lies in any merged interval (s, e] with '0000'
    for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
        const measure = measures[measureIndex];
        const linesCount = measure.length;
        if (linesCount === 0) continue;

        for (let lineIndex = 0; lineIndex < linesCount; lineIndex++) {
            const beat = measureIndex * 4 + (lineIndex / linesCount) * 4;

            // Membership test: (s, e]
            for (const [s, e] of merged) {
                if (beat > s + EPS && beat <= e + EPS) {
                    measure[lineIndex] = '0000';
                    break;
                }
            }
        }
    }
}

function simplifyBpmsForChart(sortedBPMs) {
    // Require at least 2 note beats to compute any effective bpm
    if (noteBeats.length <= 1) {
        return sortedBPMs.length > 0 ? sortedBPMs : [{ beat: 0, bpm: 60 }];
    }

    // Ensure sortedBPMs has one initial value
    const first = sortedBPMs.length > 0 ? sortedBPMs[0] : { beat: 0, bpm: 60 };

    const simplified = [];
    if (first.beat > 0) simplified.push({ beat: 0, bpm: first.bpm });
    simplified.push({ beat: first.beat, bpm: first.bpm });

    let lastBpm = first.bpm;

    for (let i = 0; i < noteBeats.length - 1; i++) {
        const startBeat = noteBeats[i];
        const endBeat   = noteBeats[i + 1];

        const t0 = songTiming.getTimeAtBeat(startBeat);
        const t1 = songTiming.getTimeAtBeat(endBeat);

        const dt = t1 - t0;
        const db = endBeat - startBeat;

        if (db > 0 && dt > 0.001) {
            const effectiveBpm = (db / dt) * 60;
            if (Math.abs(effectiveBpm - lastBpm) > 0.5) {
                simplified.push({ beat: startBeat, bpm: effectiveBpm });
                lastBpm = effectiveBpm;
            }
        }
    }
    return simplified;
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
    const info = { title: '', artist: '', offset: 0, bpms: [], stops: [], warps: [] };

    let m = metadataBlock.match(/#TITLE:(.*?);/);
    if (m) info.title = m[1].trim();
    m = metadataBlock.match(/#TITLETRANSLIT:(.*?);/);
    if (m && m[1].trim().length > 0) info.title = m[1].trim();

    m = metadataBlock.match(/#ARTIST:(.*?);/);
    if (m) info.artist = m[1].trim();
    m = metadataBlock.match(/#ARTISTTRANSLIT:(.*?);/);
    if (m && m[1].trim().length > 0) info.artist = m[1].trim();

    m = metadataBlock.match(/#OFFSET:(.*?);/);
    if (m) info.offset = parseFloat(m[1].trim());

    const bpmsMatch = metadataBlock.match(/#BPMS:(.*?);/s);
    if (bpmsMatch) {
        info.bpms = bpmsMatch[1].trim().split(',').map(entry => {
            const [beatStr, bpmStr] = entry.trim().split('=');
            return (beatStr && bpmStr) ? { beat: parseFloat(beatStr), bpm: parseFloat(bpmStr) } : null;
        }).filter(Boolean);
    }

    const stopsMatch = metadataBlock.match(/#STOPS:(.*?);/s);
    if (stopsMatch && stopsMatch[1].trim().length > 0) {
        info.stops = stopsMatch[1].trim().split(',').map(entry => {
            const [beatStr, durStr] = entry.trim().split('=');
            return (beatStr && durStr) ? { beat: parseFloat(beatStr), duration: parseFloat(durStr) } : null;
        }).filter(Boolean);
    }

    const warpsMatch = metadataBlock.match(/#WARPS:(.*?);/s);
    if (warpsMatch && warpsMatch[1].trim().length > 0) {
        info.warps = warpsMatch[1].trim().split(',').map(entry => {
            const [beatStr, lenStr] = entry.trim().split('=');
            return (beatStr && lenStr) ? { beat: parseFloat(beatStr), length: parseFloat(lenStr) } : null;
        }).filter(Boolean);
    }

    info.bpms.sort((a, b) => a.beat - b.beat);
    info.stops.sort((a, b) => a.beat - b.beat);
    info.warps.sort((a, b) => a.beat - b.beat);
    return info;
}

