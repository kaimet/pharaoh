
(function instalSongSelectingHandler() {
    document.getElementById('songSelector').addEventListener('change', (ev) => {
				const selector = document.getElementById('songSelector');
				const selectedVal = selector.value;
				if (selectedVal === 'roulette') {
						// user clicked the roulette option
						runRoulette();
						// keep the listbox visible; runRoulette will set selection/highlight/load
						return;
				}

				const selectedIndex = parseInt(selectedVal, 10);
				if (isNaN(selectedIndex)) return;

				const opt = selector.options[selector.selectedIndex];

				// PACK header clicked -> toggle open/close
				if (opt && opt.dataset && opt.dataset.type === 'pack') {
						const wasOpen = opt.dataset.packOpen === 'true';
						if (!wasOpen) {
								openOnlyPack(selectedIndex);
						} else {
								openOnlyPack(-1);
						}
						return;
				}

				// SONG clicked -> ensure its pack is open and load it
				const item = prepackagedSongs[selectedIndex];
				if (item && !item.pack) {
						openPackContainingIndex(selectedIndex);
						highlightCurrentSong(getOptionIndexForSongValue(selectedIndex));
						loadSongFromUrl(item);
						saveSettings();
				}
		});
		
		/*
		// X key toggles exclusion when selector is focused or active element
		document.addEventListener('keydown', (e) => {
			const selector = document.getElementById('songSelector');
			if (!selector) return;

			// ensure input areas not intercepting
			const active = document.activeElement;
			if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

			if (e.key === 'x' || e.key === 'X') {
				// only when selector has focus (or you can allow global toggle for convenience)
				if (document.activeElement === selector || selector.contains(document.activeElement)) {
					e.preventDefault();
					toggleExcludeSelectedSong();
				}
			}
		});
		*/

		// contextmenu (right-click) on the listbox: toggle exclude for clicked option
		document.getElementById('songSelector').addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const selector = document.getElementById('songSelector');
			// find option index under mouse by computing relative position with option heights
			// simpler approach: use elementFromPoint to get option element (works in many browsers)
			const el = document.elementFromPoint(e.clientX, e.clientY);
			if (!el || el.tagName !== 'OPTION') {
				// some browsers don't expose OPTION via elementFromPoint; fallback to current selectedIndex
				toggleExcludeSelectedSong();
				return;
			}
			// get option index
			const index = Array.prototype.indexOf.call(selector.options, el);
			if (index < 0) return;
			selector.selectedIndex = index;
			toggleExcludeSelectedSong();
		});
})();

// --- allow re-clicking the same pack/roulette option to toggle/trigger it --- //
(function installSameOptionClickHandler() {
  const selector = document.getElementById('songSelector');
  if (!selector) return;

  // store the index before the click (mousedown) so we can compare after the click
  selector.addEventListener('mousedown', (e) => {
    selector._preClickSelectedIndex = selector.selectedIndex;
  });

  selector.addEventListener('click', (e) => {
    const pre = selector._preClickSelectedIndex;
    const cur = selector.selectedIndex;

    // if selection changed, the 'change' handler will handle it — noop here
    if (pre !== cur) return;

    // selection did not change — handle re-click on special items
    const opt = selector.options[cur];
    if (!opt || !opt.dataset) return;

    // If user re-clicked a PACK header -> toggle it
    if (opt.dataset.type === 'pack') {
      // opt.value holds the pack's song-index value (string) which openOnlyPack expects
      const packValue = parseInt(opt.value, 10);
      const wasOpen = opt.dataset.packOpen === 'true';
      if (!wasOpen) {
        openOnlyPack(packValue);
      } else {
        openOnlyPack(-1); // collapse all
      }
      // done — do not dispatch change (we intentionally avoid firing change for same selection)
      return;
    }

    // If user re-clicked Roulette option -> trigger roulette
    if (opt.dataset.type === 'roulette') {
      // runRoulette already opens/selects/loads the chosen song
      if (typeof runRoulette === 'function') runRoulette();
      return;
    }

    // otherwise: if it's a song or something else and selection didn't change, do nothing
  });
})();


function populateSongSelector() {
    const selector = document.getElementById('songSelector');
    selector.innerHTML = ''; // Clear existing options

    // --- Add Roulette special option at the very top ---
    const rouletteOpt = document.createElement('option');
    rouletteOpt.value = 'roulette';
    rouletteOpt.dataset.type = 'roulette';
    rouletteOpt.className = 'roulette-option';
    rouletteOpt.textContent = '🔀 Roulette';
    rouletteOpt.hidden = false;
    selector.appendChild(rouletteOpt);

    const recentPlays = JSON.parse(localStorage.getItem('pharaohRecentPlays') || '{}');
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
		
		const excludedSet = loadExcludedSet(); // get excluded songs

    let currentPackIndex = -1;

    prepackagedSongs.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = index;

        if (item.pack) {
            option.dataset.type = 'pack';
            option.dataset.packName = item.pack;
            option.dataset.packIndex = index;
            option.dataset.packOpen = 'false';
            option.className = 'pack';
            option.textContent = `▸ ${item.pack}`;
            option.hidden = false;
        } else {
            option.dataset.type = 'song';
            option.dataset.parentPack = currentPackIndex;
            option.className = 'song';
            option.hidden = true; // hidden until pack open

            // Build text 
            let optionText = '';
            if (item.artist && item.title) {
                const playKey = getPlayKey(item);
                optionText = `${item.artist} - ${item.title}`;
								
								if (excludedSet.has(playKey)) {
										option.dataset.excluded = 'true';
										option.classList.add('excluded-song');
										optionText = `${optionText} 🚫`;
								} else {
										option.dataset.excluded = 'false';
								}

                if (sessionPlayedSongs.has(playKey)) {
                    optionText = `🟢 ${optionText}`;
                } else {
                    const lastPlayTime = recentPlays[playKey];
                    if (lastPlayTime && (now - lastPlayTime < THREE_DAYS_MS)) {
                        optionText = `🔵 ${optionText}`;
                    } else if (lastPlayTime && (now - lastPlayTime < MONTH_MS)) {
                        optionText = `🔹 ${optionText}`;
                    }
                }
            } else {
                optionText = 'Unknown song';
            }
            option.textContent = optionText;
        }

        if (item.pack) currentPackIndex = index;
        selector.appendChild(option);
    });

    // collapse packs default
    for (let i = 0; i < selector.options.length; i++) {
        const o = selector.options[i];
        if (o.dataset && o.dataset.type === 'pack') {
            o.dataset.packOpen = 'false';
            o.textContent = `▸ ${o.dataset.packName}`;
        }
    }
}

// Toggle exclusion for the currently selected song option
function toggleExcludeSelectedSong() {
  const selector = document.getElementById('songSelector');
  if (!selector) return;
  const opt = selector.options[selector.selectedIndex];
  if (!opt || !opt.dataset || opt.dataset.type !== 'song') return;

  const songIndex = parseInt(opt.value, 10);
  const songItem = prepackagedSongs[songIndex];
  if (!songItem) return;
  const key = getPlayKey(songItem);

  const excluded = loadExcludedSet();
  if (excluded.has(key)) {
    excluded.delete(key);
  } else {
    excluded.add(key);
  }
  saveExcludedSet(excluded);

  // Update option UI immediately
  if (excluded.has(key)) {
			opt.dataset.excluded = 'true';
			opt.classList.add('excluded-song');
			const base = (opt.textContent || '').replace(/\s*🚫$/, '').trim();
			opt.textContent = `${base} 🚫`;
	} else {
			opt.dataset.excluded = 'false';
			opt.classList.remove('excluded-song');
			opt.textContent = (opt.textContent || '').replace(/\s*🚫$/, '').trim();
	}

  // optional: show small toast to confirm
  if (window.showSongToast) {
    const label = optionLabel(opt);
    window.showSongToast(`${label} ${excluded.has(key) ? 'is excluded from' : 'is included in'} roulette results`, {
      tag: 'exclude-toggle',
      duration: 1500
    });
  }
}


/** Collapse all packs if packIndex < 0. Otherwise open only the provided pack index. */
function openOnlyPack(packOptionIndex) {
    const selector = document.getElementById('songSelector');
    if (!selector) return;

    for (let i = 0; i < selector.options.length; i++) {
        const opt = selector.options[i];
        if (!opt.dataset) continue;

        if (opt.dataset.type === 'pack') {
            if (parseInt(packOptionIndex, 10) >= 0 && parseInt(opt.value, 10) === parseInt(packOptionIndex, 10)) {
                opt.dataset.packOpen = 'true';
                opt.textContent = `▾ ${opt.dataset.packName}`;
            } else {
                opt.dataset.packOpen = 'false';
                opt.textContent = `▸ ${opt.dataset.packName}`;
            }
        } else if (opt.dataset.type === 'song') {
            // reveal only songs that belong to packOptionIndex (or hide all if packOptionIndex < 0)
            if (parseInt(packOptionIndex, 10) >= 0) {
                opt.hidden = (parseInt(opt.dataset.parentPack, 10) !== parseInt(packOptionIndex, 10));
            } else {
                opt.hidden = true;
            }
        }
    }
}

/** Highlight the currently-loaded song (by option index). */
function highlightCurrentSong(songOptionIndex) {
  const selector = document.getElementById('songSelector');
  if (!selector) return;
  for (let i = 0; i < selector.options.length; i++) {
    const opt = selector.options[i];
    if (opt.classList) {
      if (songOptionIndex >= 0 && i === songOptionIndex) {
        opt.classList.add('current-song');
      } else {
        opt.classList.remove('current-song');
      }
    }
  }
}

/** Returns the pack header index (option.value) that contains given songIndex.
 *  Walks backwards from songIndex until a pack item is found.
 */
function getPackIndexForSongIndex(songIndex) {
    for (let i = songIndex; i >= 0; i--) {
        const item = prepackagedSongs[i];
        if (item && item.pack) return i;
    }
    return -1;
}

/** Given any song option index, open its pack so the song becomes visible.
 *  If packIndex === -1, nothing happens.
 */
function openPackContainingIndex(songIndex) {
    const packIndex = getPackIndexForSongIndex(songIndex);
    if (packIndex >= 0) openOnlyPack(packIndex);
}

/** Consistent key for recentPlays lookup for a song item */
function getPlayKey(item) {
    if (!item) return '';
    return item.key ? item.key : `${item.artist || ''}-${item.title || ''}`;
}

/** Weighted random choice helper: items is array, weights same length, total weight > 0 */
function chooseWeightedIndex(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return -1;
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

/**
 * Roulette: never-played first, then fill up to TARGET_SHARE with oldest-played;
 * played-song weights use an exponential curve so older songs receive much stronger weight.
 *
 * options: {
 *   targetShare: 0..1 (default 0.5),
 *   maxAgeMs: ms over which played-song weight reaches max (default 30 days),
 *   maxPlayedWeight: weight cap for played songs (default 12),
 *   expAlpha: exponential sharpness (default 5),
 *   neverMultiplier: multiplier applied to maxPlayedWeight to produce never-played weight (default 1.5)
 * }
 */
function runRoulette(options = {}) {
    // procentage of all songs for roulette candidates
		const TARGET_SHARE = (typeof options.targetShare === 'number') ? options.targetShare : 0.6;
    const MAX_AGE_MS = (typeof options.maxAgeMs === 'number') ? options.maxAgeMs : 30 * 24 * 60 * 60 * 1000; // 30 days
    const MAX_PLAYED_WEIGHT = (typeof options.maxPlayedWeight === 'number') ? options.maxPlayedWeight : 12;
    const EXP_ALPHA = (typeof options.expAlpha === 'number') ? options.expAlpha : 3.0; // sharper => more bias to oldest
    const NEVER_MULTIPLIER = (typeof options.neverMultiplier === 'number') ? options.neverMultiplier : 1.1;
    const NEVER_WEIGHT = Math.max(1, Math.round(MAX_PLAYED_WEIGHT * NEVER_MULTIPLIER));
		const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
		
		selectSong = options.selectSong == undefined ? true : options.selectSong;
		
    const recentPlays = JSON.parse(localStorage.getItem('pharaohRecentPlays') || '{}');
    const now = Date.now();
		
    // gather song indices (skip pack headers and exluded songs)
		const allSongIndices = [];
    const excludedSet = loadExcludedSet();
		for (let i = 0; i < prepackagedSongs.length; i++) {
			if (!prepackagedSongs[i] || prepackagedSongs[i].pack) continue;
			const key = getPlayKey(prepackagedSongs[i]);
			if (excludedSet.has(key)) continue; // completely ignore excluded songs
			allSongIndices.push(i);
		}

		
    const totalSongs = allSongIndices.length;
    if (totalSongs === 0) return;

    // partition into never-played and played (collect age)
    const neverPlayed = [];
    const played = []; // { songIndex, lastPlayed, age }
    for (const si of allSongIndices) {
        const item = prepackagedSongs[si];
        const key = getPlayKey(item);
        const last = recentPlays[key];
        if (!last) {
            neverPlayed.push(si);
        } else {
            played.push({ songIndex: si, lastPlayed: last, age: Math.max(0, now - last) });
        }
    }

    // target number of candidates
    const targetCount = Math.max(1, Math.ceil(TARGET_SHARE * totalSongs));

    // start with all never-played
    const candidates = [...neverPlayed];

    // if need more, add oldest-played songs by descending age (oldest first)
    if (candidates.length < targetCount) {
        played.sort((a, b) => b.age - a.age); // oldest (largest age) first
        const need = targetCount - candidates.length;
        for (let i = 0; i < need && i < played.length; i++) {
            // exclude very recently played songs if we already have enough candidates
						if (played[i].age < THREE_DAYS_MS && candidates.length > 50) break;
						candidates.push(played[i].songIndex);
        }
    }

    // fallback: if candidates empty (edge case), pick uniformly from allSongIndices
    if (candidates.length === 0) {
        const r = Math.floor(Math.random() * totalSongs);
        finalizeRouletteChoice(allSongIndices[r]);
        return;
    }

    // build weights: never-played -> NEVER_WEIGHT; played -> exponential curve scaled to [1..MAX_PLAYED_WEIGHT]
    const weights = candidates.map(si => {
        const item = prepackagedSongs[si];
        const key = getPlayKey(item);
        const last = recentPlays[key];
        if (!last) return NEVER_WEIGHT;

        // age proportion 0..1
        const age = Math.max(0, now - last);
        const prop = Math.min(age / MAX_AGE_MS, 1);

        // exponential mapping: normalizedExp = (e^(alpha*prop)-1) / (e^alpha - 1)
        const expNumer = Math.exp(EXP_ALPHA * prop) - 1;
        const expDenom = Math.exp(EXP_ALPHA) - 1 || 1; // guard denom
        const normalizedExp = expNumer / expDenom;

        // map to weight range [1 .. MAX_PLAYED_WEIGHT]
        const weight = 1 + normalizedExp * (MAX_PLAYED_WEIGHT - 1);
        return Math.max(0.0001, weight); // tiny floor to avoid zero weights
    });

    // choose weighted index from weights array
    const pickIdx = chooseWeightedIndex(weights);
    let chosenSongIndex;
    if (pickIdx < 0 || pickIdx >= candidates.length) {
        // fallback uniform
        chosenSongIndex = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        chosenSongIndex = candidates[pickIdx];
    }

    if (selectSong) {
			finalizeRouletteChoice(chosenSongIndex);
		} else {
			return chosenSongIndex;
		}

    // finalize: open pack, set selector, highlight, dispatch change, show toast
    function finalizeRouletteChoice(songIndex) {
        if (songIndex == null || songIndex < 0) return;
        openPackContainingIndex(songIndex);

        const selector = document.getElementById('songSelector');
        const optIdx = getOptionIndexForSongValue(songIndex);
        if (optIdx >= 0) {
            selector.selectedIndex = optIdx;
            highlightCurrentSong(optIdx);
            selector.dispatchEvent(new Event('change', { bubbles: true }));
						showSelectedSongToast(optIdx);

        } else {
            // fallback: load directly
            loadSongFromUrl(prepackagedSongs[songIndex]);
        }
    }
}

function showSelectedSongToast(index) {
		const selector = document.getElementById('songSelector');
		if (window.showSongToast) {
				const toastText = optionLabel(selector.options[index]);
				window.showSongToast(toastText, {
						tag: 'selection',
						duration: 3000
				});
		}

}

function optionLabel(opt) {
    if (!opt) return '';

    // Base label: strip markers from start
    let txt = (opt.textContent || '').trim();
    //txt = txt.replace(/^([🟢🔵🔹]\s*)+/, '').trim();

    // If this is a song, prepend its pack name
    if (opt.dataset && opt.dataset.type === 'song' && opt.dataset.parentPack) {
        const selector = document.getElementById('songSelector');
        const parentPackValue = parseInt(opt.dataset.parentPack, 10);
        for (let i = 0; i < selector.options.length; i++) {
            const packOpt = selector.options[i];
            if (packOpt.dataset &&
                packOpt.dataset.type === 'pack' &&
                parseInt(packOpt.value, 10) === parentPackValue) {
                const packName = packOpt.dataset.packName || '';
                if (packName) {
                    return `${packName} - ${txt}`;
                }
                break;
            }
        }
    }

    // For pack headers or roulette, just return the text without markers
    return txt;
}

/** helper: find option index inside the SELECT element whose option.value == songValue (number) */
function getOptionIndexForSongValue(songValue) {
    const selector = document.getElementById('songSelector');
    for (let i = 0; i < selector.options.length; i++) {
        // option.value for normal song options is the numeric song index (stringified)
        if (selector.options[i].value === String(songValue)) return i;
    }
    return -1;
}


async function loadSongFromUrl(songData) {
    isLoadingSong = true;
		stopSong();

    // Show loading indicator and disable controls
    const bestScoreDisplay = document.getElementById('bestScoreDisplay');
    const songSelector = document.getElementById('songSelector');
    bestScoreDisplay.textContent = 'Loading...';
    songSelector.disabled = true;
    document.getElementById('playButton').disabled = true;
		let isAudio = (songData.audioPath && songData.audioPath.length > 1);
		
    try {
        // Fetch both files concurrently
        const [chartResponse, audioResponse] = await Promise.all([
            fetch(songData.chartPath),
            isAudio ? fetch(songData.audioPath) : null
        ]);

        if (!chartResponse.ok) throw new Error(`Failed to load chart: ${chartResponse.statusText}`);
        if (audioResponse) isAudio = audioResponse.ok;

        // Process the responses
        const chartText = await chartResponse.text();
        const audioData = isAudio ? await audioResponse.arrayBuffer(): null;
        
        // Parse the chart file
        allCharts = parseChartFile(chartText);
        if (allCharts.length === 0) {
            alert('No "dance-single" charts found in this file.');
            return;
        }
				
				selectedSongKey = songData.key;
				if (!selectedSongKey) selectedSongKey = `${songData.artist}-${songData.title}`;
        
				// dev info
        const chartFileName = songData.chartPath.split('/').pop();
        const audioFileName = songData.audioPath.split('/').pop();
        updateDeveloperInfo(chartFileName, audioFileName);
				

        // Populate the UI and initialize the chart
				sessionPlayHistory = {};
        populateChartSelector();
        initChart();
				showNotAvailableScreen(); // need to be after initChart() bacause initChart clears the overlay

        // Decode the audio data
        audioBuffer = isAudio ? await audioContext.decodeAudioData(audioData)
				                      : audioContext.createBuffer(1, 1, audioContext.sampleRate);
				
    } catch (error) {
        alert(`Error loading song: ${error.message}`);
        console.error("Load song error:", error);
    } finally {
				isLoadingSong = false;
				// Re-enable controls
				songSelector.disabled = false;
				document.getElementById('playButton').disabled = false;
				clearOverlay();
				if (userWantToPlay) playSong();
				// The best score will be displayed by the initChart/drawChart functions
		}
}

/** Clear any selection in the listbox and remove current-song highlight. */
/** Clear any selection in the listbox, remove current-song highlight, and collapse all packs. */
function clearSongSelection() {
  const selector = document.getElementById('songSelector');
  if (!selector) return;

  // Deselect every option (reliable cross-browser)
  for (let i = 0; i < selector.options.length; i++) {
    selector.options[i].selected = false;
  }

  // Reset selectedIndex
  try {
    selector.selectedIndex = -1;
  } catch (err) {
    // ignore (some browsers can be fussy)
  }

  // Remove any UI highlight used for the "currently loaded" song
  if (typeof highlightCurrentSong === 'function') {
    highlightCurrentSong(-1); // we've made highlightCurrentSong handle -1 already
  } else {
    for (let i = 0; i < selector.options.length; i++) {
      selector.options[i].classList.remove('current-song');
    }
  }
	
	openOnlyPack(-1); // Collapse all packs
  
}





