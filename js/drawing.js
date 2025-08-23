/** --- CHART DRAWING & LAYOUT LOGIC ---
//*/


const CHART_CONSTANTS = {
    NOTE_SIZE: 9,
    PADDING: 32,
    BASE_COLUMN_WIDTH: 40,
    TARGET_DENSITY: 20, // Target notes per column for layout calculation
    BORDER: 6,
    LANE_COUNT: 4,
    NOTE_TYPES: {
        NONE: '0',
        TAP: '1',
        HOLD_START: '2',
        HOLD_END: '3',
        ROLL_START: '4',
    }
};

/**
 * Calculates the dynamic layout of the chart based on note density and screen size.
 * This is a "pure" function: its output depends only on its inputs, making it predictable.
 * @param {Array} measures - The array of all measures in the chart.
 * @param {number} availableWidth - The available screen width for the chart.
 * @param {number} topOffset - The vertical space taken up by elements above the chart.
 * @returns {object} A layout configuration object.
 */
function calculateChartLayout(measures, availableWidth, topOffset) {
    const { BASE_COLUMN_WIDTH, PADDING, TARGET_DENSITY, BORDER } = CHART_CONSTANTS;
    const COLUMN_WIDTH = BASE_COLUMN_WIDTH + PADDING;

    let totalNoteEvents = 0;
    measures.forEach(measure => measure.forEach(line => {
        if (line.includes(CHART_CONSTANTS.NOTE_TYPES.TAP) || line.includes(CHART_CONSTANTS.NOTE_TYPES.HOLD_START) || line.includes(CHART_CONSTANTS.NOTE_TYPES.ROLL_START)) {
            totalNoteEvents++;
        }
    }));

    const maxColumns = Math.max(1, Math.floor(availableWidth / COLUMN_WIDTH));
    const columnsForDensity = Math.max(1, Math.ceil(totalNoteEvents / TARGET_DENSITY));
    const finalColumnCount = Math.min(maxColumns, columnsForDensity);
    const measuresPerColumn = Math.max(1, Math.ceil(measures.length / finalColumnCount));

    // spacing between measures (previous code had hardcoded 2px)
    const MEASURE_SPACING = 0;

    const targetHeight = window.innerHeight - topOffset - (BORDER * 2);
    const measureHeight = Math.max(20, Math.floor((targetHeight / measuresPerColumn) - MEASURE_SPACING));

    return {
        columnWidth: COLUMN_WIDTH,
        measuresPerColumn,
        measureHeight,
        measureSpacing: MEASURE_SPACING,
        border: BORDER,
        padding: PADDING,
        columnCount: Math.ceil(measures.length / measuresPerColumn),
        laneWidth: (COLUMN_WIDTH - PADDING) / CHART_CONSTANTS.LANE_COUNT,
    };
}

/**
 * Sets the dimensions of the primary and overlay canvases.
 * @param {HTMLCanvasElement} canvas - The main chart canvas.
 * @param {HTMLCanvasElement} overlay - The overlay canvas for dynamic elements.
 * @param {object} layout - The layout configuration object from calculateChartLayout.
 */
function setupCanvases(canvas, overlay, underlay, layout) {
    canvas.width = layout.columnCount * layout.columnWidth - layout.padding + layout.border * 2;
    canvas.height = (layout.border * 2) + (layout.measuresPerColumn * (layout.measureHeight + layout.measureSpacing));
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    underlay.width = canvas.width; 
    underlay.height = canvas.height;
}


/**
 * Draws the static background elements of the chart, like the title and meter.
 * @param {CanvasRenderingContext2D} ctx - The rendering context of the chart canvas.
 * @param {object} layout - The layout configuration object.
 */
function drawChartBackground(ctx, layout) {
    if (songInfo.title) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let text = `${songInfo.title}`;
        let fontSize = 96;
        ctx.font = `bold ${fontSize}px sans-serif`;

        // Dynamically resize font to fit canvas width
        while (ctx.measureText(text).width > ctx.canvas.width * 0.9 && fontSize > 10) {
            fontSize -= 4;
            ctx.font = `bold ${fontSize}px sans-serif`;
        }
        ctx.fillText(text, ctx.canvas.width / 2, ctx.canvas.height / 2);

        // Draw meter
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = `bold 72px sans-serif`;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillText(chartMeter, ctx.canvas.width - 40, ctx.canvas.height - 1);
        ctx.restore();
    }
}

/**
 * Draws a single note as a circle.
 * @param {CanvasRenderingContext2D} ctx - The rendering context.
 * @param {number} x - The x-coordinate of the note's top-left corner.
 * @param {number} y - The y-coordinate of the note's top-left corner.
 */
function drawNoteShape(ctx, x, y) {
    const { NOTE_SIZE } = CHART_CONSTANTS;
    ctx.beginPath();
    ctx.arc(x + NOTE_SIZE / 2, y, NOTE_SIZE / 2, 0, 2 * Math.PI);
    ctx.fill();
}

/**
 * Draws the body of a hold or roll note, handling cases where it spans across columns.
 * @param {CanvasRenderingContext2D} ctx - The rendering context.
 * @param {object} hold - The active hold object being tracked.
 * @param {object} endNoteInfo - Information about the hold's end note.
 * @param {object} layout - The layout configuration object.
 */
function drawHoldBody(ctx, hold, endNoteInfo, layout) {
    ctx.fillStyle = hold.color;
    const holdBodyWidth = CHART_CONSTANTS.NOTE_SIZE / 2;
    const { colIndex, x, lineY } = endNoteInfo;
    
    // Case 1: Hold starts and ends in DIFFERENT columns
    if (hold.startColIndex !== colIndex) {
        // Part A: Draw from the start of the hold to the bottom of its column
        const startBodyX = hold.startX + (CHART_CONSTANTS.NOTE_SIZE / 4);
        ctx.fillRect(startBodyX, hold.startY, holdBodyWidth, ctx.canvas.height - hold.startY);

        // Part B: Loop through any full columns in between
        for (let j = hold.startColIndex + 1; j < colIndex; j++) {
            const intermediateColXBase = j * layout.columnWidth + layout.border;
            const intermediateHoldX = intermediateColXBase + (endNoteInfo.laneIndex * layout.laneWidth) + endNoteInfo.xOffset + (CHART_CONSTANTS.NOTE_SIZE / 4);
            ctx.fillRect(intermediateHoldX, 0, holdBodyWidth, ctx.canvas.height);
        }

        // Part C: Draw from the top of the final column to the end of the hold
        const endBodyX = x + (CHART_CONSTANTS.NOTE_SIZE / 4);
        ctx.fillRect(endBodyX, 0, holdBodyWidth, lineY);

    } else { // Case 2: Hold is contained within a single column
        const holdBodyX = hold.startX + (CHART_CONSTANTS.NOTE_SIZE / 4);
        ctx.fillRect(holdBodyX, hold.startY, holdBodyWidth, lineY - hold.startY);
    }
}


/**
 * Iterates through a measure's lines and draws all the notes.
 * @param {CanvasRenderingContext2D} ctx - The rendering context.
 * @param {Array} measure - The notes data for a single measure.
 * @param {number} measureYBase - The base y-coordinate for the current measure.
 * @param {number} colXBase - The base x-coordinate for the current column.
 * @param {number} colIndex - The index of the current column.
 * @param {object} activeHolds - A state object for tracking open holds.
 * @param {object} layout - The layout configuration object.
 */
function drawNotesForMeasure(ctx, measure, measureYBase, colXBase, colIndex, activeHolds, layout) {
    const { LANE_COUNT, NOTE_SIZE, NOTE_TYPES } = CHART_CONSTANTS;
    if (measure.length === 0) return;

    const yStepForMeasure = layout.measureHeight / measure.length;
    const xOffset = (layout.laneWidth - NOTE_SIZE) / 2;

    measure.forEach((line, lineIndexInMeasure) => {
        const lineY = Math.round(measureYBase + (lineIndexInMeasure * yStepForMeasure));

        for (let i = 0; i < LANE_COUNT; i++) {
            const noteType = line[i];
            if (noteType === NOTE_TYPES.NONE) continue;

            const x = colXBase + (i * layout.laneWidth) + xOffset;
            const color = getColorForQuantization(lineIndexInMeasure, measure.length);
            ctx.fillStyle = color;

            switch (noteType) {
                case NOTE_TYPES.TAP:
                    drawNoteShape(ctx, x, lineY);
                    break;
                case NOTE_TYPES.ROLL_START:
                case NOTE_TYPES.HOLD_START:
                    activeHolds[i] = {
                        startY: lineY,
                        color: color,
                        startX: x,
                        startColIndex: colIndex
                    };
                    drawNoteShape(ctx, x, lineY);
                    break;
                case NOTE_TYPES.HOLD_END:
                    const hold = activeHolds[i];
                    if (hold) {
                        const endNoteInfo = { colIndex, x, lineY: lineY, laneIndex: i, xOffset };
                        drawHoldBody(ctx, hold, endNoteInfo, layout);
                        activeHolds[i] = null; // The hold has been drawn
                    }
                    break;
            }
        }
    });
}

// Draw a faded preview at the bottom of the current column when the next column
// begins with notes at beat 0.
function drawNextColumnHeadPreview(ctx, measureIndex, colXBase, measureYBase, layout) {
    const { NOTE_SIZE, LANE_COUNT, NOTE_TYPES } = CHART_CONSTANTS;
    const measuresPerColumn = layout.measuresPerColumn;
    // only relevant for the last measure in a column
    const measureIndexInCol = measureIndex % measuresPerColumn;
    if (measureIndexInCol !== measuresPerColumn - 1) return;

    const nextMeasureIndex = measureIndex + 1;
    if (nextMeasureIndex >= measures.length) return;
    const nextMeasure = measures[nextMeasureIndex];
    if (!nextMeasure || nextMeasure.length === 0) return;

    const firstLine = nextMeasure[0];
    // fast check: any note(s) on the first line?
    let hasNote = false;
    for (let i = 0; i < LANE_COUNT; i++) {
        if (['1', '2', '4'].includes(firstLine[i])) { hasNote = true; break; }
    }
    if (!hasNote) return;

    // Compute bottom line Y exactly (the same Y where you draw the bottom separator).
    // If you draw bottom line with `bottomLineY - 0.5` for crispness, keep that here.
    const bottomLineY = measureYBase + layout.measureHeight;
    const previewCenterY = bottomLineY - 0.5; // aligns with a 1px line drawn as (y - 0.5, 1)

    // center-based drawing: compute lane center X
    const laneWidth = layout.laneWidth;
    const laneCenterOffset = (laneWidth / 2);
    const radius = NOTE_SIZE / 2;

    ctx.save();
    ctx.globalAlpha = 0.45; // faded preview look
    ctx.lineWidth = 1;

    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const noteType = firstLine[lane];
        if (noteType === NOTE_TYPES.NONE) continue;

        // choose color from quantization of upcoming measure (use line 0)
        const color = getColorForQuantization(0, nextMeasure.length);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;

        const centerX = Math.round(colXBase + (lane * laneWidth) + laneCenterOffset);

        if (noteType === NOTE_TYPES.TAP) {
            // draw centered circle directly (no ambiguity)
            ctx.beginPath();
            ctx.arc(centerX, previewCenterY, radius, 0, Math.PI * 2);
            ctx.fill();
        } else if (noteType === NOTE_TYPES.HOLD_START || noteType === NOTE_TYPES.ROLL_START) {
            // Draw a small vertical stub that suggests a hold starting in the next column.
            // stubHeight is short so it doesn't suggest a full-length hold in the current column.
            const stubHeight = Math.max(8, Math.round(radius)); // tweak as desired
            // draw a rounded cap + thin rectangle up from the bottom line
            ctx.beginPath();
            ctx.arc(centerX, previewCenterY, radius, 0, Math.PI * 2);
            ctx.fill();

            // rectangle connecting up a bit
            ctx.fillRect(centerX - Math.max(1, Math.round(radius/2)), previewCenterY, Math.max(1, Math.round(radius)), stubHeight);
        } 
    }

    // Debug dot (uncomment to visually verify alignment) 
    // ctx.globalAlpha = 1.0;
    // ctx.fillStyle = 'red';
    // ctx.fillRect(colXBase - 2, previewCenterY - 2, 4, 4);

    ctx.restore();
}


/**
 * Draws the grid lines for a single measure.
 * @param {CanvasRenderingContext2D} ctx - The rendering context.
 * @param {number} colXBase - The base x-coordinate for the current column.
 * @param {number} measureYBase - The base y-coordinate for the current measure.
 * @param {object} layout - The layout configuration object.
 */
function drawMeasureGrid(ctx, colXBase, measureYBase, layout) {
    const { NOTE_SIZE, LANE_COUNT } = CHART_CONSTANTS;
    const xOffset = (layout.laneWidth - NOTE_SIZE) / 2;

    // Draw vertical lane separators (same as before but use measureYBase and measureHeight)
    ctx.fillStyle = '#000';
    for (let i = 0.5; i < LANE_COUNT; i += 2) {
        let x = colXBase + (i * layout.laneWidth) + xOffset + NOTE_SIZE / 2;
        ctx.fillRect(x - 0.7, measureYBase, 1.4, layout.measureHeight);
    }
		
    // Draw 4th beats marks
    const laneX = colXBase + (layout.columnWidth - layout.padding - NOTE_SIZE) / 2;
    for (let beat = 1; beat < 4; beat++) {
        const beatY = measureYBase + (layout.measureHeight * (beat / 4));
        ctx.fillRect(laneX, beatY - 0.5, NOTE_SIZE, 1);
    }
    
    // Draw horizontal measure separator at the TOP of this measure.
    // That way the first beat (beat 0) sits exactly on this line.
    ctx.fillStyle = '#000';
    ctx.fillRect(colXBase, measureYBase, layout.columnWidth - layout.padding, 1);

    // Optionally, draw the bottom line for visual clarity (not necessary; uncomment if you want)
    ctx.fillRect(colXBase, measureYBase + layout.measureHeight, layout.columnWidth - layout.padding, 1);
}

/**
 * Draws horizontal quarter-beat markers across any active hold bodies within a measure.
 * This provides a visual guide for the player to know when to release a hold.
 * @param {CanvasRenderingContext2D} ctx - The rendering context.
 * @param {number} measureYBase - The base y-coordinate for the current measure.
 * @param {number} colXBase - The base x-coordinate for the current column.
 * @param {object} activeHolds - The current state of active holds passing through the measure.
 * @param {object} layout - The chart's layout configuration object.
 */
function drawHoldBeatMarkers(ctx, measureYBase, colXBase, layout, endedHolds) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    const { LANE_COUNT, NOTE_SIZE } = CHART_CONSTANTS;
    const xOffset = (layout.laneWidth - NOTE_SIZE) / 2;

    // Loop through the three quarter-beats (at 25%, 50%, and 75% of the measure's height).
    // We start at `beat = 1` because the 0% mark is the main measure line.
    for (let beat = 1; beat < 4; beat++) {
        const beatY = measureYBase + (layout.measureHeight * (beat / 4));

        // Check each of the 4 lanes.
        for (let lane = 0; lane < LANE_COUNT; lane++) {
            // If a hold note is currently "active" in this lane, draw a marker.
            if (endedHolds[lane]) {
                const laneX = colXBase + (lane * layout.laneWidth) + xOffset;
                // Draw a 1px tall horizontal line across the note area.
                ctx.fillRect(laneX, beatY - 0.5, NOTE_SIZE, 1);
            }
        }
    }
}

/**
 * Draws the BPM change indicators for a given measure.
 * @param {CanvasRenderingContext2D} ctx - The rendering context.
 * @param {number} measureIndex - The index of the current measure.
 * @param {number} measureYBase - The base y-coordinate for the current measure.
 * @param {number} colXBase - The base x-coordinate for the current column.
 * @param {object} layout - The layout configuration object.
 */
function drawBpmChangesForMeasure(ctx, measureIndex, measureYBase, colXBase, colIndex, layout) {
    const measureStartBeat = measureIndex * 4;
    const measureEndBeat = (measureIndex + 1) * 4;

    simplifiedBpms.forEach(bpmEvent => {
        if (bpmEvent.beat >= measureStartBeat && bpmEvent.beat < measureEndBeat) {
            const beatInMeasure = bpmEvent.beat - measureStartBeat;
            const yOffset = (beatInMeasure / 4) * layout.measureHeight;
            const yPos = measureYBase + yOffset;

            ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
            ctx.fillRect(colXBase, yPos, layout.columnWidth - layout.padding + 3, 2);

            ctx.fillStyle = '#AA0000';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            // Position text to avoid going off-screen on the last column
            let textX = (colIndex < layout.columnCount - 1)
                ? colXBase + layout.columnWidth - layout.padding + 3
                : colXBase - 25;
            ctx.fillText(`${bpmEvent.bpm.toFixed(0)}`, textX, yPos + 2);
        }
    });
}


/**
 * --- MAIN CHART DRAWING & LAYOUT LOGIC ---
 * This function is responsible for rendering the entire note chart onto the canvas.
 * It orchestrates the calculation of layout and the drawing of all chart elements.
 */
function drawChart() {
    const canvas = document.getElementById('chartCanvas');
    const overlay = document.getElementById('overlayCanvas');
    const underlay = document.getElementById('underlayCanvas');
    const ctx = canvas.getContext('2d');

    if (measures.length === 0) return;

    // 1. Calculate the dynamic layout of the chart
    const topOffset = document.getElementById('judgementDisplay').offsetHeight + 6;
    const layout = calculateChartLayout(measures, window.innerWidth - 5, topOffset);
    
    // Also export the layout parameters for other parts of the game (e.g., playhead)
    Object.assign(chartLayoutParams, layout);

    // 2. Set canvas dimensions based on the calculated layout
    setupCanvases(canvas, overlay, underlay, layout);

    // 3. Draw static background elements
    drawChartBackground(ctx, layout);

    // 4. Draw all the measures, notes, and other elements
    const activeHolds = {}; // State for tracking holds, kept within this drawing scope
    measures.forEach((measure, measureIndex) => {
        const colIndex = Math.floor(measureIndex / layout.measuresPerColumn);
        const measureIndexInCol = measureIndex % layout.measuresPerColumn;
        
        const colXBase = colIndex * layout.columnWidth + layout.border;
        // Compute measure top deterministically: top border + index * (height + spacing)
        const measureYBase = layout.border + measureIndexInCol * (layout.measureHeight + layout.measureSpacing);
        
        // Draw top border for the very first row of measures in this column
        if (measureIndexInCol === 0) {
            ctx.fillStyle = '#000';
            ctx.fillRect(colXBase, layout.border, layout.columnWidth - layout.padding, 1);
        }

        drawMeasureGrid(ctx, colXBase, measureYBase, layout);
				
        drawBpmChangesForMeasure(ctx, measureIndex, measureYBase, colXBase, colIndex, layout);
				
        drawNotesForMeasure(ctx, measure, measureYBase, colXBase, colIndex, activeHolds, layout);
				drawNextColumnHeadPreview(ctx, measureIndex, colXBase, measureYBase, layout);
    });
}

// Helper Functions

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

const COLOR_MAP = {
    4: '#000000', 8: '#0000FF', 12: '#990099', 16: '#009900',
    24: '#990099', 32: '#009900', 64: '#009900', 'default': '#AAAAAA'
};

function getColorForQuantization(lineIndex, notesInMeasure) {
    if (notesInMeasure === 0) return COLOR_MAP['default'];
    const commonDivisor = gcd(lineIndex, notesInMeasure);
    const snap = notesInMeasure / commonDivisor;
    if (snap % 64 === 0) return COLOR_MAP[64];
    if (snap % 32 === 0) return COLOR_MAP[32];
    if (snap % 24 === 0) return COLOR_MAP[24];
    if (snap % 16 === 0) return COLOR_MAP[16];
    if (snap % 12 === 0) return COLOR_MAP[12];
    if (snap % 8 === 0) return COLOR_MAP[8];
    if (snap % 6 === 0) return COLOR_MAP[12];
    if (snap % 4 === 0) return COLOR_MAP[4];
    if (snap % 3 === 0) return COLOR_MAP[12];
    if (snap % 2 === 0) return COLOR_MAP[4];
    if (snap % 1 === 0) return COLOR_MAP[4];
    return COLOR_MAP['default'];
}


// Layout-Beats Mapping

/**
 * Translates canvas click coordinates into a song beat.
 * @returns {number|null} The calculated beat, or null if the click was outside a valid chart area.
 */
function getBeatFromCoordinates(x, y) {
    if (!chartLayoutParams.columnWidth) return null;

    const { columnWidth, measuresPerColumn, measureHeight, border, padding, measureSpacing } = chartLayoutParams;

    // Determine the column index from the X coordinate
    let colIndex = Math.floor((x - border) / columnWidth);
    const xInCol = (x - border) % columnWidth;
    if (xInCol > (columnWidth - padding / 2)) {
        colIndex++;
    }

    // Determine the measure index within the column from the Y coordinate (subtract top border first)
    const yFromTop = y - border;
    const measureIndexInCol = Math.floor(yFromTop / (measureHeight + measureSpacing));

    // Calculate the overall measure index
    const measureIndex = (colIndex * measuresPerColumn) + measureIndexInCol;

    // Determine the beat within the measure from the Y coordinate
    const yInMeasure = yFromTop % (measureHeight + measureSpacing);
    // If we're on the spacing region (below the measureHeight) clamp to measureHeight
    const clampedYInMeasure = Math.min(yInMeasure, measureHeight);
    let beatInMeasure = (clampedYInMeasure / measureHeight) * 4;
    beatInMeasure = Math.max(0, Math.min(beatInMeasure, 4.0)); // clamp to (0-4) range

    // Calculate the final beat
    const finalBeat = (measureIndex * 4) + beatInMeasure;
    return finalBeat;
}

function getCoordinatesFromBeat(beat, lane) {
    if (chartLayoutParams.measuresPerColumn === 0 || !chartLayoutParams.columnWidth) return null;

    const { columnWidth, measuresPerColumn, measureHeight, border, padding, measureSpacing } = chartLayoutParams;
    const { NOTE_SIZE, LANE_COUNT } = CHART_CONSTANTS;
    const laneWidth = (columnWidth - padding) / LANE_COUNT;
    const xOffset = (laneWidth - NOTE_SIZE) / 2;

    const measureIndex = Math.floor(beat / 4);
    const beatInMeasure = beat % 4;

    const colIndex = Math.floor(measureIndex / measuresPerColumn);
    const measureIndexInCol = measureIndex % measuresPerColumn;

    const colXBase = colIndex * columnWidth + border;
    const measureYBase = border + measureIndexInCol * (measureHeight + measureSpacing);

    const yPos = Math.round(measureYBase + (beatInMeasure / 4) * measureHeight);
    const xPos = colXBase + (lane * laneWidth) + xOffset;

    return { x: xPos + NOTE_SIZE / 2, y: yPos };
}


function clearUnderlay() {
    const underlayCanvas = document.getElementById('underlayCanvas');
    const ctx = underlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, underlayCanvas.width, underlayCanvas.height);
}

function showNotAvailableScreen() {
		const overlayCanvas = document.getElementById('overlayCanvas');
		const ctx = overlayCanvas.getContext('2d');
		ctx.save();
		ctx.fillStyle = 'rgba(200, 200, 200, 0.75)';
		ctx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
		ctx.restore();
}
