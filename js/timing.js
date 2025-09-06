// --- CORE TIMING ---


/** --- UNIFIED TIMING ENGINE ---
// HOW IT WORKS:
// This function takes all bpms, stops, and warps and builds a master timeline.
// This timeline is an array of events, each mapping a specific beat to a specific
// second in the song's audio. It correctly accounts for the time dilations caused
// by BPM changes and the time gaps caused by stops.
 *
 * UNIFIED TIMING ENGINE
 * Calculates a master timing map and returns an object containing two functions:
 * - getTimeAtBeat(beat):  Converts a beat into a song-second.
 * - getBeatAtTime(time):   Converts a song-second into a beat.
 * This ensures all parts of the player use one source of truth for timing.
 */
function createUnifiedTiming(bpms, stops, warps) {
    const EPS = 1e-9;

    // Same-beat processing order:
    // 1) BPM (defines tempo from this beat forward)
    // 2) STOP (adds absolute time while beat stays)
    // 3) WARP (jumps beat forward at constant time)
    // Notes at that beat are always evaluated at the pre-event time (see getTimeAtBeat).
    const typePriority = { 'BPM': 0, 'STOP': 1, 'WARP': 2 };

    // Build event list (keep original index for stable tiebreak)
    let idx = 0;
    const events = [
        ...bpms.map(e => ({ beat: e.beat, value: e.bpm,  type: 'BPM',  idx: idx++ })),
        ...stops.map(e => ({ beat: e.beat, value: e.duration, type: 'STOP', idx: idx++ })),
        ...warps.map(e => ({ beat: e.beat, value: e.length,   type: 'WARP', idx: idx++ }))
    ];

    // Sort: beat ascending; then typePriority; then stable index
    events.sort((a, b) => {
        if (Math.abs(a.beat - b.beat) > EPS) return a.beat - b.beat;
        const pa = (typePriority[a.type] ?? 99);
        const pb = (typePriority[b.type] ?? 99);
        if (pa !== pb) return pa - pb;
        return a.idx - b.idx;
    });

    // Build timeline with raw beats (no clustering). Each entry means:
    // from this entry to the next, time is linear with the entry bpm (unless it's a plateau).
    const initialBpm = bpms[0]?.bpm ?? 60;
    const timeline = [{ beat: 0, time: 0, bpm: initialBpm }];
    let last = timeline[0];

    for (const ev of events) {
        if (ev.beat + EPS < last.beat) continue; // guard; should not happen with sort

        // Time at this event's beat using the PREVIOUS segment's bpm
        const beatDelta = ev.beat - last.beat;
        const newTime = last.time + (beatDelta * 60) / last.bpm;

        let nextBeat = ev.beat;
        let nextTime = newTime;
        let nextBpm  = last.bpm;

        if (ev.type === 'BPM') {
            // BPM change is instantaneous at this beat; notes at this beat still use newTime computed above
            nextBpm = ev.value;
            timeline.push({ beat: ev.beat, time: newTime, bpm: nextBpm });

        } else if (ev.type === 'STOP') {
            // Plateau: two entries at same beat; notes at this beat should map to the first one (pre-stop time)
            timeline.push({ beat: ev.beat, time: newTime,          bpm: last.bpm });
            nextTime = newTime + ev.value;
            timeline.push({ beat: ev.beat, time: nextTime,         bpm: last.bpm });

        } else if (ev.type === 'WARP') {
            // Jump forward in beat at constant time (could follow a STOP at the same beat)
            const warpedBeat = ev.beat + ev.value;
            timeline.push({ beat: ev.beat,     time: newTime, bpm: last.bpm });
            timeline.push({ beat: warpedBeat,  time: newTime, bpm: last.bpm });
            nextBeat = warpedBeat;
        }

        last = { beat: nextBeat, time: nextTime, bpm: nextBpm };
    }

    // Coalesce exact duplicate pairs (same beat and time) that can arise when STOP and WARP share a beat.
    // Keep the first occurrence to preserve "first entry at beat" semantics.
    for (let i = 1; i < timeline.length; ) {
        const a = timeline[i - 1], b = timeline[i];
        if (Math.abs(a.beat - b.beat) <= EPS && Math.abs(a.time - b.time) <= EPS) {
            timeline.splice(i, 1);
        } else {
            i++;
        }
    }

    return {
        getTimeAtBeat(beat) {
            // Find the last timeline entry with beat <= target (linear scan is OK; binary search if desired)
            let i = 0;
            for (let j = 1; j < timeline.length; j++) {
                if (timeline[j].beat - beat > EPS) break;
                i = j;
            }

            // If multiple entries share this beat (STOP plateau start/end), back up to the first.
            while (i > 0 && Math.abs(timeline[i - 1].beat - beat) <= EPS && Math.abs(timeline[i].beat - beat) <= EPS) {
                i--;
            }

            const seg = timeline[i];
            const beatDelta = beat - seg.beat;
            return seg.time + (beatDelta * 60) / seg.bpm;
        },

        getBeatAtTime(time) {
            // Find the last timeline entry with time <= target
            let i = 0;
            for (let j = 1; j < timeline.length; j++) {
                if (timeline[j].time - time > EPS) break;
                i = j;
            }

            const seg = timeline[i];
            const next = timeline[i + 1];

            // If we're inside a STOP plateau (next has same beat but later time), beat doesn't advance
            if (next && Math.abs(next.beat - seg.beat) <= EPS && next.time - time > EPS) {
                return seg.beat;
            }

            // Otherwise linear within the segment
            const dt = time - seg.time;
            return seg.beat + (dt * seg.bpm) / 60;
        },

        _debug_timeline: timeline
    };
}
