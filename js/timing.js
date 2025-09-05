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
    // Only collapse true FP noise, never intentional offsets like +0.01
    const GROUP_EPS = 1e-6;

    // Build raw events list
    const events = [
        ...bpms.map(e => ({ beat: e.beat, value: e.bpm, type: 'BPM' })),
        ...stops.map(e => ({ beat: e.beat, value: e.duration, type: 'STOP' })),
        ...warps.map(e => ({ beat: e.beat, value: e.length, type: 'WARP' }))
    ];

    // Sort by raw beat first (stable), so clustering will scan in order
    events.sort((a, b) => {
        if (Math.abs(a.beat - b.beat) > EPS) return a.beat - b.beat;
        return a.type.localeCompare(b.type);
    });

    // Cluster neighboring beats into groupBeat representatives (for ordering only)
    let lastGroupRep = null;
    for (const ev of events) {
        if (lastGroupRep === null || ev.beat - lastGroupRep > GROUP_EPS) {
            lastGroupRep = ev.beat;
        }
        ev.groupBeat = lastGroupRep;
    }

    // Deterministic type priority for same logical beat ordering
    const typePriority = { 'BPM': 0, 'STOP': 1, 'WARP': 2 };

    // Order by groupBeat, then by typePriority, then by raw beat for stability
    events.sort((a, b) => {
        if (Math.abs(a.groupBeat - b.groupBeat) > EPS) return a.groupBeat - b.groupBeat;
        const pa = (typePriority[a.type] ?? 99);
        const pb = (typePriority[b.type] ?? 99);
        if (pa !== pb) return pa - pb;
        return a.beat - b.beat;
    });

    // Build timeline using RAW beat for math (preserve parser's intentional offsets)
    const initialBpm = bpms[0]?.bpm ?? 60;
    const timeline = [{ beat: 0, time: 0, bpm: initialBpm }];
    let lastEvent = timeline[0];

    for (const event of events) {
        const beatForMath = event.beat; // <-- key change: use raw beat, not groupBeat

        // allow equal-beat events; skip only if event is strictly before last
        if (beatForMath + EPS < lastEvent.beat) continue;

        const beatDelta = beatForMath - lastEvent.beat;
        const timeDelta = (beatDelta * 60) / lastEvent.bpm;
        const newTime = lastEvent.time + timeDelta;

        let newBpm = lastEvent.bpm;
        let timeAfterEvent = newTime;
        let lastBeatForNext = beatForMath;

        if (event.type === 'BPM') {
            newBpm = event.value;
            timeline.push({ beat: beatForMath, time: newTime, bpm: newBpm });
        } else if (event.type === 'STOP') {
            // Represent a STOP as a plateau: two entries at the same beat
            timeline.push({ beat: beatForMath, time: newTime, bpm: lastEvent.bpm });
            timeAfterEvent = newTime + event.value;
            timeline.push({ beat: beatForMath, time: timeAfterEvent, bpm: lastEvent.bpm });
        } else if (event.type === 'WARP') {
            // Warp: jump forward in beat at constant time
            const warpedBeat = beatForMath + event.value;
            timeline.push({ beat: beatForMath, time: newTime, bpm: lastEvent.bpm });
            timeline.push({ beat: warpedBeat, time: newTime, bpm: lastEvent.bpm });
            lastBeatForNext = warpedBeat;
        }

        lastEvent = { beat: lastBeatForNext, time: timeAfterEvent, bpm: newBpm };
    }

    return {
        getTimeAtBeat: function(beat) {
            let segmentIndex = 0;
            for (let i = 1; i < timeline.length; i++) {
                if (timeline[i].beat - beat > EPS) break;
                segmentIndex = i;
            }

            // If we landed exactly on a STOP plateau (duplicate beat entries),
            // step back to the first entry at that beat so notes-at-beat happen before the stop.
            while (
                segmentIndex > 0 &&
                Math.abs(timeline[segmentIndex].beat - beat) <= EPS &&
                Math.abs(timeline[segmentIndex - 1].beat - beat) <= EPS
            ) {
                segmentIndex--;
            }

            const segment = timeline[segmentIndex];
            const beatDelta = beat - segment.beat;
            return segment.time + (beatDelta * 60) / segment.bpm;
        },

        getBeatAtTime: function(time) {
            let segmentIndex = 0;
            for (let i = 1; i < timeline.length; i++) {
                if (timeline[i].time > time) break;
                segmentIndex = i;
            }

            const segment = timeline[segmentIndex];
            const nextSegment = timeline[segmentIndex + 1];

            // If next segment has same beat => STOP; playhead doesn't move
            if (nextSegment && Math.abs(nextSegment.beat - segment.beat) <= EPS) {
                return segment.beat;
            }

            const timeDelta = time - segment.time;
            return segment.beat + (timeDelta * segment.bpm) / 60;
        },

        // For debugging
        _debug_timeline: timeline
    };
}

