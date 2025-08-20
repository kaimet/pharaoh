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
    const EPS = 1e-9; // small guard for floating point
		
    const events = [
        ...bpms.map(e => ({ beat: e.beat, value: e.bpm, type: 'BPM' })),
        ...stops.map(e => ({ beat: e.beat, value: e.duration, type: 'STOP' })),
        ...warps.map(e => ({ beat: e.beat, value: e.length, type: 'WARP' }))
    ];

    // Deterministic type priority for same-beat ordering
    const typePriority = { 'BPM': 0, 'STOP': 1, 'WARP': 2 };

    // Sort by beat then by type priority (stable)
    events.sort((a, b) => {
        if (Math.abs(a.beat - b.beat) > EPS) return a.beat - b.beat;
        return (typePriority[a.type] || 99) - (typePriority[b.type] || 99);
    });

    // initial timeline
    const initialBpm = bpms[0]?.bpm ?? 60;
    const timeline = [{ beat: 0, time: 0, bpm: initialBpm }];
    let lastEvent = timeline[0];

    for (const event of events) {
        // allow equal-beat events to be processed
				if (event.beat + EPS < lastEvent.beat) continue;

				// Calculate time elapsed since the last event
				const beatDelta = event.beat - lastEvent.beat;
				const timeDelta = (beatDelta * 60) / lastEvent.bpm;
				const newTime = lastEvent.time + timeDelta;
				
				let newBpm = lastEvent.bpm;
				let timeAfterEvent = newTime;

				// decide which beat we should treat as "current" for the next iteration
				// (for WARP it must be the warped beat, for STOP/BPM it's the event beat)
				let lastBeatForNext = event.beat;

				if (event.type === 'BPM') {
						newBpm = event.value;
						timeline.push({ beat: event.beat, time: newTime, bpm: newBpm });
						lastBeatForNext = event.beat;
				}
				else if (event.type === 'STOP') {
            // STOP: time pauses at the beat; create pre-stop and post-stop entries
            timeline.push({ beat: event.beat, time: newTime, bpm: lastEvent.bpm });
            timeAfterEvent = newTime + event.value;
            timeline.push({ beat: event.beat, time: timeAfterEvent, bpm: lastEvent.bpm });
            lastBeatForNext = event.beat;
				}
				else if (event.type === 'WARP') {
						const warpedBeat = event.beat + event.value;
						// Add an event marking the time at the start of the warp
						timeline.push({ beat: event.beat, time: newTime, bpm: lastEvent.bpm });
						// Add another event at the same time but at the new beat
						timeline.push({ beat: warpedBeat, time: newTime, bpm: lastEvent.bpm });
						// continue from the warped beat
						lastBeatForNext = warpedBeat; 
				}
				lastEvent = { beat: lastBeatForNext, time: timeAfterEvent, bpm: newBpm };
		}
		//console.log(timeline);

    // Returned object with our two functions
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
            // Find the index of the segment we are currently in.
            for (let i = 1; i < timeline.length; i++) {
                if (timeline[i].time > time) break;
                segmentIndex = i;
            }

            const segment = timeline[segmentIndex];
            const nextSegment = timeline[segmentIndex + 1];

            // Check if we are inside a stop.
            // A stop is defined by the next timeline event having the same beat.
            if (nextSegment && nextSegment.beat === segment.beat) {
                // If so, we are in a stop. The playhead must not move.
                return segment.beat;
            }
            
            // Otherwise, we are in a normal musical section. Calculate as before.
            const timeDelta = time - segment.time;
            return segment.beat + (timeDelta * segment.bpm) / 60;
        }
    };
}
