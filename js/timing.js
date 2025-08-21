// --- CORE TIMING ---


/** --- UNIFIED TIMING ENGINE ---
// HOW IT WORKS:
// This function takes all bpms, stops, and warps and builds a master timeline.
// This timeline is an array of events, each mapping a specific beat to a specific
// second in the song's audio. It correctly accounts for the time dilations caused
// by BPM changes and the time gaps caused by stops.
//
// THE OUTPUT:
// It returns an object containing two methods: getTimeAtBeat() and getBeatAtTime().
// These two functions become the absolute "single source of truth" for all timing-related
// calculations in the entire application, from judging to drawing.
//
 *
 * UNIFIED TIMING ENGINE
 * Calculates a master timing map and returns an object containing two functions:
 * - getTimeAtBeat(beat):  Converts a beat into a song-second.
 * - getBeatAtTime(time):   Converts a song-second into a beat.
 * This ensures all parts of the player use one source of truth for timing.
 */
function createUnifiedTiming(bpms, stops, warps) {
    const EPS = 1e-9;
    // This must match (or be slightly bigger than) the offset you add in parser.
    // If you use stopBeat += 0.01 in parser, set PARSE_OFFSET = 0.01.
    const PARSE_OFFSET = 0.01;
    const GROUP_EPS = PARSE_OFFSET * 1.5; // cluster beats within this distance

    // Build raw events list
    const events = [
        ...bpms.map(e => ({ beat: e.beat, value: e.bpm, type: 'BPM' })),
        ...stops.map(e => ({ beat: e.beat, value: e.duration, type: 'STOP' })),
        ...warps.map(e => ({ beat: e.beat, value: e.length, type: 'WARP' }))
    ];

    // Sort by raw beat first (stable), so clustering will scan in order
    events.sort((a, b) => {
        if (Math.abs(a.beat - b.beat) > EPS) return a.beat - b.beat;
        // tie-break raw type to keep deterministic order before clustering
        return a.type.localeCompare(b.type);
    });

    // Cluster neighboring beats into groupBeat representatives
    let lastGroupRep = null;
    for (const ev of events) {
        if (lastGroupRep === null || ev.beat - lastGroupRep > GROUP_EPS) {
            lastGroupRep = ev.beat;
        }
        // assign cluster representative (groupBeat)
        ev.groupBeat = lastGroupRep;
    }

    // Deterministic type priority for same logical beat ordering
    const typePriority = { 'BPM': 0, 'STOP': 1, 'WARP': 2 };

    // Now sort by groupBeat, then by typePriority, then by raw beat for stability
    events.sort((a, b) => {
        if (Math.abs(a.groupBeat - b.groupBeat) > EPS) return a.groupBeat - b.groupBeat;
        const pa = (typePriority[a.type] || 99);
        const pb = (typePriority[b.type] || 99);
        if (pa !== pb) return pa - pb;
        return a.beat - b.beat;
    });

    // Build timeline using groupBeat for math
    const initialBpm = bpms[0]?.bpm ?? 60;
    const timeline = [{ beat: 0, time: 0, bpm: initialBpm }];
    let lastEvent = timeline[0];

    for (const event of events) {
        const eventBeatForMath = event.groupBeat;

        // allow equal-group events; skip only if event is strictly before last
        if (eventBeatForMath + EPS < lastEvent.beat) continue;

        const beatDelta = eventBeatForMath - lastEvent.beat;
        const timeDelta = (beatDelta * 60) / lastEvent.bpm;
        const newTime = lastEvent.time + timeDelta;

        let newBpm = lastEvent.bpm;
        let timeAfterEvent = newTime;
        let lastBeatForNext = eventBeatForMath;

        if (event.type === 'BPM') {
            newBpm = event.value;
            timeline.push({ beat: eventBeatForMath, time: newTime, bpm: newBpm });
            lastBeatForNext = eventBeatForMath;
        } else if (event.type === 'STOP') {
            timeline.push({ beat: eventBeatForMath, time: newTime, bpm: lastEvent.bpm });
            timeAfterEvent = newTime + event.value;
            timeline.push({ beat: eventBeatForMath, time: timeAfterEvent, bpm: lastEvent.bpm });
            lastBeatForNext = eventBeatForMath;
        } else if (event.type === 'WARP') {
            const warpedGroupBeat = eventBeatForMath + event.value;
            timeline.push({ beat: eventBeatForMath, time: newTime, bpm: lastEvent.bpm });
            timeline.push({ beat: warpedGroupBeat, time: newTime, bpm: lastEvent.bpm });
            lastBeatForNext = warpedGroupBeat;
        }

        lastEvent = { beat: lastBeatForNext, time: timeAfterEvent, bpm: newBpm };
    }

    return {
        getTimeAtBeat: function(beat) {
            let segment = timeline[0];
            for (let i = 1; i < timeline.length; i++) {
                if (timeline[i].beat > beat) break;
                segment = timeline[i];
            }
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
            if (nextSegment && nextSegment.beat === segment.beat) {
                return segment.beat;
            }

            const timeDelta = time - segment.time;
            return segment.beat + (timeDelta * segment.bpm) / 60;
        },

        // For debugging
        _debug_timeline: timeline
    };
}
