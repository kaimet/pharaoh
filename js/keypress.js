
// Backspase - Roulette
document.addEventListener('keydown', (e) => {
		if (isPlaying) return;
		
    // ignore Backspace when focused in a text field
    const active = document.activeElement;
    if (e.key === 'Backspace') {
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            return; // let browser handle editing/back navigation in inputs
        }
        e.preventDefault();
        runRoulette();
    }
});

/* Simple arrow navigation for the listbox:
   - ArrowDown / ArrowUp move to the immediate next/prev option only.
   - If target option is a pack header or is hidden, do nothing.
   - Dispatches a 'change' event so existing change-handler will open pack / load song / highlight.
*/
(function installSimpleListboxKeys() {
  const selectorId = 'songSelector';

  function isSelectableSongOption(opt) {
    return opt &&
           opt.dataset &&
           opt.dataset.type === 'song' &&
           !opt.hidden;
  }

  function tryMoveOne(selector, dir) {
    const cur = selector.selectedIndex;
    if (typeof cur !== 'number' || cur < 0) return false;
    const target = cur + dir;
    if (target < 0 || target >= selector.options.length) return false;
    const opt = selector.options[target];
    if (isSelectableSongOption(opt)) {
      selector.selectedIndex = target;
      // Fire change so your UI's change handler will load/highlight the song
      selector.dispatchEvent(new Event('change', { bubbles: true }));
			showSelectedSongToast(target);
      return true;
    }
    // if target is a pack or hidden item -> do nothing
    return false;
  }

  document.addEventListener('keydown', (e) => {
    if (isPlaying) return;
		
		const selector = document.getElementById(selectorId);
    if (!selector) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (e.ctrlKey || e.shiftKey) return;
			
      // prevent page scrolling
      e.preventDefault();

      const dir = e.key === 'ArrowDown' ? 1 : -1;
      tryMoveOne(selector, dir);
    }
  });
})();

/**
 * Arrow Up/Down handlers
 */
function handleVolumeChange(e) {
    e.preventDefault();
    const volInput = document.getElementById('songVolume');
    if (!volInput) return;
    const step = 0.1;
    const min = parseFloat(volInput.min || 0);
    const max = parseFloat(volInput.max || 1);
    const cur = parseFloat(volInput.value || 0);
    const delta = e.code === 'ArrowUp' ? step : -step;
    let newVal = Math.round((cur + delta) * 100) / 100;
    newVal = Math.max(min, Math.min(max, newVal));
    if (newVal !== cur) {
        const precision = (volInput.step && volInput.step.includes('.')) ? volInput.step.split('.')[1].length : 2;
        volInput.value = newVal.toFixed(precision);
        volInput.dispatchEvent(new Event('input', { bubbles: true }));
        volInput.dispatchEvent(new Event('change', { bubbles: true }));
        // show toast as percentage (preserve original behavior)
        if (window.showSongToast) {
            window.showSongToast(`Song Volume: ${Math.round(newVal * 100)}%`);
        }
    }
}

/**
 * Speed control (numpad keys and 9/0)
 */
function handleSpeedControl(e) {
    // Disable this hotkey if we are in a high score run AND the first note has passed.
    if (isPlaying && isFullSongPlay && playerTime() >= firstNoteTime) {
        return;
    }

		const active = document.activeElement;
		if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
				return; // user can use minus key to set offset in the input element, so let them
		}

    e.preventDefault();

    const speedControl = document.getElementById('speedControl');
    let newSpeed = parseFloat(speedControl.value);

    if (e.code === 'NumpadSubtract' || e.code === 'Minus') {
        newSpeed -= 0.1;
    } else if (e.code === 'NumpadAdd' || e.code === 'Equal') {
        newSpeed += 0.1;
    } else {
        newSpeed = 1;
    }
    newSpeed = parseFloat(newSpeed.toFixed(1));
    newSpeed = Math.max(parseFloat(speedControl.min), Math.min(parseFloat(speedControl.max), newSpeed));

    // Apply new speed
    if (isPlaying) {
        const lastSongTime = (audioContext.currentTime - startTime) * playbackRate;

        if (isFullSongPlay && lastSongTime < firstNoteTime) {
            speedDuringPlay = newSpeed;
        }

        //playbackRate = newSpeed; //it changes in onPlaybackRateChange
				onPlaybackRateChange(newSpeed);
        startTime = audioContext.currentTime - (lastSongTime / playbackRate);

        if (songSource) {
            songSource.playbackRate.value = playbackRate;
        }
    } else {
        playbackRate = newSpeed;
    }

    // Update UI
    speedControl.value = playbackRate;
    document.getElementById('speedValue').textContent = `${playbackRate.toFixed(1)}x`;
    displayBestScore();
    updateJudgementDisplayFromHistory();
}

/**
 * Toggle playhead mode (Slash key)
 */
function handlePlayheadToggle(e) {
    // Disable this hotkey if we are in a high score run AND the first note has passed.
    if (isPlaying && isFullSongPlay && playerTime() >= firstNoteTime) {
        return;
    }

    e.preventDefault();
    const checkbox = document.getElementById('showPlayhead');
    checkbox.checked = !checkbox.checked;

    if (window.showSongToast) {
        window.showSongToast(`Playhead is ${checkbox.checked ? 'On' : 'Off'}`, {
            tag: 'playhead'
        });
    }

    // If this is a high score run, update the 'snapshot' variable that will be used for saving.
    if (isPlaying && isFullSongPlay) {
        playheadDuringPlay = checkbox.checked;
    }

    // Update the score display to reflect the new mode.
    displayBestScore();
    updateJudgementDisplayFromHistory();
}

/**
 * Chart left/right handlers (ArrowLeft/ArrowRight)
 */
function handleSelectingChartDifficulty(e) {
    if (isPlaying || allCharts.length === 0) return;
    e.preventDefault();

    const selector = document.getElementById('chartSelector');
    let newIndex = selector.selectedIndex;

    if (e.code === 'ArrowLeft') {
        newIndex = Math.max(0, newIndex - 1);
    } else { // ArrowRight
        newIndex = Math.min(selector.options.length - 1, newIndex + 1);
    }

    if (newIndex !== selector.selectedIndex) {
        selector.value = newIndex;
        initChart();
    }
}

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
		// --- quick-start digit keys (Digit1..Digit0) ---
    const idx = digitCodeToIndex(e.code);
    if (idx !== -1) {
        if (isLoadingSong) return;
        const beat = quickStarts[idx];
        if (beat !== null) {
            e.preventDefault();
            playSong(beat);
            return true;
        } else {
            // optional feedback: slot empty
            //console.log(`Quick-start key ${idx+1 === 10 ? 0 : idx+1} is empty`);
            return false;
        }
    }

    if (e.code === 'Escape') {
        e.preventDefault();
        stopSong();
        return true;
    }
    return false;
}

/**
 * Top-level key handler (orchestrator)
 */
function handleKeyPress(e) {
    if (e.repeat) return;

    // Dev shortcut
    if (e.code === 'KeyZ' && DEV_MODE) {
        const btn = document.getElementById('copyJsonButton');
        if (btn) btn.click();
        return;
    }

    // Play/Stop  (enter/escape/backquote)
    if (handlePlayStopShortcuts(e)) return;

    // Chart selection (arrows left/right)
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        handleSelectingChartDifficulty(e);
        return;
    }

    // ArrowUp/ArrowDown: volume and song select logic
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        
        if (e.shiftKey) {
            handleVolumeChange(e);
            return;
        }

        // Selection behavior by arrow keys is already set in installSimpleListboxKeys()
        return;
    }

    // Speed control hotkeys
    if (['NumpadSubtract', 'NumpadAdd', 'NumpadMultiply', 'Minus', 'Equal'].includes(e.code)) {
        handleSpeedControl(e);
        return;
    }

    // Playhead mode toggle (Slash)
    if (e.code === 'Slash') {
        handlePlayheadToggle(e);
        return;
    }

    // Delegate rest to in-play handler
    handleKeyPressDuringPlay(e);
}

/**
 * Convert 'Digit1'..'Digit0' to quickStarts index 0..9
 */
function digitCodeToIndex(code) {
    if (code === 'Digit0') return 9;
    const n = parseInt(code.slice(5), 10);
    return (!isNaN(n) && n >= 1 && n <= 9) ? (n - 1) : -1;
}

/**
 * Register/adjust quick-starts, keep them sorted (earliest -> key 1).
 * Show toast ONLY when quickStarts actually change.
 */
function registerQuickStart(beat, thresholdBeats = 8) {
  if (!beat || beat <= 0) return; // only non-beginning starts

  const EPS = 1e-6;

  // helper to deep-copy current slots (we keep exactly 10 entries)
  const oldSlots = (typeof quickStarts !== 'undefined' ? quickStarts.slice(0, 10) : new Array(10).fill(null));

  // Work on a temporary 'existing' array of non-null beats
  const existing = oldSlots.filter(b => b !== null);

  // Find closest existing slot within threshold (if any)
  let closestIdx = -1;
  let closestDist = Infinity;
  for (let i = 0; i < existing.length; i++) {
    const d = Math.abs(existing[i] - beat);
    if (d <= thresholdBeats && d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  if (closestIdx !== -1) {
    // adjust the closest slot
    existing[closestIdx] = beat;
  } else {
    // add as new candidate
    existing.push(beat);
  }

  // sort ascending and keep earliest 10
  existing.sort((a, b) => a - b);
  const kept = existing.slice(0, 10);

  // build the newSlots (earliest -> index 0)
  const newSlots = kept.concat(Array(Math.max(0, 10 - kept.length)).fill(null));

  // compare oldSlots vs newSlots (consider EPS)
  const slotsChanged = (function (a, b) {
    for (let i = 0; i < 10; i++) {
      const ai = a[i];
      const bi = b[i];
      const aIsNull = (ai === null || ai === undefined);
      const bIsNull = (bi === null || bi === undefined);
      if (aIsNull && bIsNull) continue;
      if (aIsNull !== bIsNull) return true;
      if (Math.abs(ai - bi) > EPS) return true;
    }
    return false;
  })(oldSlots, newSlots);

  // commit
  quickStarts = newSlots;

  // If nothing changed, do not show toast or update UI
  if (!slotsChanged) return;

  // find which key index the beat ended up at
  let idx = quickStarts.findIndex(b => b !== null && Math.abs(b - beat) <= EPS);
  if (idx === -1) {
    // if not found by EPS (float mismatch), try approximate match
    idx = quickStarts.findIndex(b => b !== null && Math.abs(b - beat) < 1e-2);
  }
  const keyLabel = (idx === 9) ? '0' : (idx === -1 ? '—' : String(idx + 1));

  const wasAdjustment = (closestIdx !== -1);
  const msg = wasAdjustment
    ? `Start position updated → key ${keyLabel}`
    : `Start position assigned to key ${keyLabel}`;

  // show toast
  if (typeof showSongToast === 'function' || typeof window.showSongToast === 'function') {
    (window.showSongToast || showSongToast)(msg, { tag: 'quickStart', duration: 1500 });
  } else {
    console.log(msg);
  }
}








