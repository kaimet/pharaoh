
// --- Setup and Initialization  ---

window.onload = async function() { 
    loadKeybinds();
    loadSettings(); 

    // Fetch the list of pre-packaged songs
    try {
        const response = await fetch('songs.json');
        if (!response.ok) {
            console.error("Could not load songs.json. Make sure the file exists.");
        } else {
            prepackagedSongs = await response.json();
            populateSongSelector(); // Build the list of songs first
            
            // Now, determine which song to load initially
						const savedSettingsRaw = localStorage.getItem('pharaohWebPlayerSettings');
						let initialSongIndex = null;

						if (savedSettingsRaw) {
								const savedSettings = JSON.parse(savedSettingsRaw);
								if (savedSettings.lastPlayedSongIndex !== undefined &&
										savedSettings.lastPlayedSongIndex > -1 &&
										savedSettings.lastPlayedSongIndex < prepackagedSongs.length) {
										initialSongIndex = savedSettings.lastPlayedSongIndex;
								} else {
										// settings exist but no valid song index -> use roulette
										initialSongIndex = runRoulette({selectSong: false});
								}
						} else {
								// no settings at all (first time) -> pick the very first song
								initialSongIndex = 2; // after roulette and first pack options  // <-- shady
						}

						if (prepackagedSongs.length > 0) {
								// Set the selector to the correct song and then load it
								openOnlyPack(getPackIndexForSongIndex(initialSongIndex));
								highlightCurrentSong(initialSongIndex);
								document.getElementById('songSelector').value = initialSongIndex - 1; // <-- shady
								loadSongFromUrl(prepackagedSongs[initialSongIndex - 1]); // <-- shady
						}
        }
    } catch (error) {
        console.error("Error fetching or parsing songs.json:", error);
    }
		
    // Initialize audio
		try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // --- Decode the embedded Base64 sound on startup ---
        decodeBase64Clap()
            .then(decodedBuffer => {
                loadedClapBuffer = decodedBuffer;
                const loadedOption = document.querySelector('#clapSoundType option[value="loaded"]');
                if (loadedOption) {
                    loadedOption.disabled = false; // Enable the option
                }
                //console.log("Successfully decoded embedded clap.ogg");
            })
            .catch(error => {
                // This will only happen if the Base64 string is corrupted
                console.log("Could not decode embedded clap.ogg.");
            });

        // Generate the initial default sound
        await generateClapSound(document.getElementById('clapSoundType').value);

    } catch (e) {
        alert('Web Audio API is not supported in this browser. Gameplay features will not work.');
        console.error("Failed to initialize Web Audio API:", e);
    }

    setupUIEventListeners();
    updateKeybindUI();
};

function setupUIEventListeners() {
		document.getElementById('copyJsonButton').addEventListener('click', () => {
        const jsonOutput = document.getElementById('devJsonOutput');
        const textToCopy = jsonOutput.value;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                //alert('JSON entry copied to clipboard!');
            }, () => {
                alert('Could not copy text.');
            });
        } else {
            // Fallback for older browsers or insecure contexts (like http://)
            jsonOutput.select();
            document.execCommand('copy');
            alert('JSON entry copied to clipboard (fallback method).');
        }
    });
		
    document.getElementById('playButton').addEventListener('click', playSong);
    document.getElementById('stopButton').addEventListener('click', stopSong);
    
    document.getElementById('songVolume').addEventListener('input', e => {
        if (songGainNode) {
            songGainNode.gain.value = Math.pow(parseFloat(e.target.value), 2);
        }
    });
    
    document.getElementById('assistVolume').addEventListener('input', () => {
        displayBestScore();
				updateJudgementDisplayFromHistory();
    });
		document.getElementById('clapSoundType').addEventListener('change', (e) => {
        generateClapSound(e.target.value);
    });

    document.getElementById('showPlayhead').addEventListener('change', e => {
        if (!e.target.checked && isPlaying) {
            clearOverlay();
        }
        displayBestScore();
				updateJudgementDisplayFromHistory();
    });

    document.getElementById('speedControl').addEventListener('input', e => {
        playbackRate = parseFloat(e.target.value);
        document.getElementById('speedValue').textContent = `${playbackRate.toFixed(1)}x`;
        if (isPlaying && songSource) {
            songSource.playbackRate.value = playbackRate;
        }
				onPlaybackRateChange(playbackRate);
				
        displayBestScore();
				updateJudgementDisplayFromHistory();
    });

    document.getElementById('audioOffset').addEventListener('change', e => {
        let offsetValue = parseInt(e.target.value, 10);
        if (isNaN(offsetValue)) {
            offsetValue = 0;
            e.target.value = 0; 
        }
        additionalOffset = offsetValue / 1000;
    });
    
		// Make the offset display clickable to toggle lock/unlock of auto-calibration
		const offsetEl = document.getElementById('offsetDisplay');
		if (offsetEl) {
				offsetEl.style.cursor = 'pointer';
				offsetEl.title = 'Click to lock/unlock input calibration (auto-calibration).';

				offsetEl.addEventListener('click', () => {
						// Toggle
						autoCalibrate = !autoCalibrate;

						if (!autoCalibrate) {
								// Lock: capture current dynamicInputOffset (ms)
								fixedInputOffset = dynamicInputOffset;
								offsetEl.classList.add('offset-locked');
								if (window.showSongToast) window.showSongToast(`Input offset locked: ${(fixedInputOffset / playbackRate).toFixed(0)}ms`);
								localStorage.setItem('fixedInputOffset', fixedInputOffset);
						} else {
								// Unlock: resume auto-calibration
								fixedInputOffset = null;
								offsetEl.classList.remove('offset-locked');
								if (window.showSongToast) window.showSongToast('Auto-calibration enabled');
								localStorage.removeItem('fixedInputOffset');
								// keep dynamicInputOffset as-is; future taps will update it
						}
						// Update UI immediately
						updateJudgementUI();
				});
		}

		
    document.getElementById('chartSelector').addEventListener('change', initChart);
    window.addEventListener('resize', drawChart);
    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('keyup', handleKeyRelease);
		
    
    // --- FULL-PAGE DRAG AND DROP LOGIC ---
		
    const dropZone = document.getElementById('dropZone');

    // STEP 1: Listen on the window to know when a drag starts.
    window.addEventListener('dragenter', (e) => {
        // Only show the overlay if the user is dragging files.
        if (e.dataTransfer.types.includes('Files')) {
            dropZone.classList.add('drag-over');
        }
    });

    // STEP 2: The overlay is now visible. Attach the rest of the
    // listeners directly to it.

    // We MUST prevent the default action on dragover for the drop to work.
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    // If the user's cursor leaves the overlay area, hide it.
    dropZone.addEventListener('dragleave', (e) => {
        dropZone.classList.remove('drag-over');
    });

    // This is what happens when the user lets go of the files.
    dropZone.addEventListener('drop', (e) => {
        // CRITICAL: Prevent the browser's default action (opening the file).
        e.preventDefault();
        
        // Hide the overlay.
        dropZone.classList.remove('drag-over');
        
        // Pass the event to file handler.
        handleFileDrop(e);
				
				window.dispatchEvent(new KeyboardEvent('keydown',{'code': 'NumpadMultiply'})); // set original speed
    });
		
		/*
    // --- SIMPLIFIED DRAG AND DROP LOGIC ---
    // We attach listeners to the entire body to avoid any issues with overlays.
    
    // We MUST prevent the default action on these events for the drop to work.
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.body.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Add visual feedback by changing the background
    document.body.addEventListener('dragenter', () => {
      document.body.style.backgroundColor = '#444';
    });

    document.body.addEventListener('dragleave', () => {
      document.body.style.backgroundColor = '#222'; // Or your original color
    });
    
    // This is what happens when the user lets go of the files.
    document.body.addEventListener('drop', (e) => {
        document.body.style.backgroundColor = '#222'; // Reset background
        handleFileDrop(e); // Pass the event to your file handler.
    });
		*/
		
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
		
		// --- Help Modal
		
		const helpButton = document.getElementById('helpButton');
    const helpModal = document.getElementById('helpModal');
    const closeHelpButton = document.getElementById('closeHelpButton');

    helpButton.addEventListener('click', () => {
        helpModal.classList.remove('hidden');
    });

    closeHelpButton.addEventListener('click', () => {
        helpModal.classList.add('hidden');
    });

    // Also close the modal if the user clicks on the dark overlay background
    helpModal.addEventListener('click', (event) => {
        if (event.target === helpModal) {
            helpModal.classList.add('hidden');
        }
    });
}

function populateChartSelector() {
    const selector = document.getElementById('chartSelector');
    selector.innerHTML = '';

    // Sort charts by difficulty (meter) before displaying them
    allCharts.sort((a, b) => {
        const meterA = parseInt(a.meter, 10);
        const meterB = parseInt(b.meter, 10);
        if (isNaN(meterA)) return 1;
        if (isNaN(meterB)) return -1;
        return meterA - meterB;
    });

    allCharts.forEach((chart, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${chart.difficulty} [${chart.meter}]`;
        selector.appendChild(option);
    });

    // --- SELECTION LOGIC ---
		
    let targetDifficulty;
    
    // First, try to find a saved difficulty for THIS SPECIFIC song.
    const lastDifficulties = JSON.parse(localStorage.getItem('pharaohLastDifficulty') || '{}');
    const songKey = `${songInfo.artist}-${songInfo.title}`;
    
    if (lastDifficulties[songKey]) {
        targetDifficulty = lastDifficulties[songKey];
    } else {
        // If none is found, fall back to the last difficulty played on ANY song.
        targetDifficulty = lastSelectedDifficulty;
    }
    
    // Now, find the best match for the target difficulty.
    if (targetDifficulty !== null) {
        let bestMatchIndex = 0;
        let smallestDiff = Infinity;
        allCharts.forEach((chart, index) => {
            const currentMeter = parseInt(chart.meter, 10);
            if (!isNaN(currentMeter)) {
                const currentDiff = Math.abs(currentMeter - targetDifficulty);
                if (currentDiff < smallestDiff) {
                    smallestDiff = currentDiff;
                    bestMatchIndex = index;
                }
            }
        });
        selector.value = bestMatchIndex;
    }

    selector.style.display = 'block';
}

function handleFileDrop(event) {
    event.preventDefault();
    stopSong(); 
    document.getElementById('dropZone').classList.remove('drag-over');
    document.getElementById('playButton').disabled = true;
    isLoadingSong = true; 
    let chartIsReady = false;
    let audioIsReady = false;
    
    const files = event.dataTransfer.files;
    const chartFile = Array.from(files).find(f => f.name.endsWith('.sm') || f.name.endsWith('.ssc'));
		
		// We check the file extension as a fallback for Firefox.
    const audioFile = Array.from(files).find(f => 
        f.type.startsWith('audio/') || 
        f.name.toLowerCase().endsWith('.mp3') ||
        f.name.toLowerCase().endsWith('.ogg')
    );

    if (!audioFile) {
        audioBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
				audioIsReady = true;
    }

    if (chartFile) {
        const chartReader = new FileReader();
        chartReader.onload = (e) => {
            allCharts = parseChartFile(e.target.result);
            if (allCharts.length > 0) {
                updateDeveloperInfo(chartFile.name, audioFile ? audioFile.name : 'audio.mp3');
                
								populateChartSelector();
								clearSongSelection();
                
								initChart();
								
								if (window.showSongToast) {
									showSongToast(`${songInfo.artist} - ${songInfo.title}`, { tag: 'selection', duration: 3000 });
								}
                
								displayBestScore();
                
                chartIsReady = true;
                
                if (chartIsReady && audioIsReady) {
                    document.getElementById('playButton').disabled = false;
                    isLoadingSong = false; // Loading complete
										clearOverlay();
                } else {
										showNotAvailableScreen();
								}
            } else {
                alert('No "dance-single" charts found in this file.');
                isLoadingSong = false; // Failed to load, so stop loading state
								clearOverlay();
            }
        };
        chartReader.readAsText(chartFile);
    } else {
        isLoadingSong = false;
				clearOverlay();
    }

    if (audioFile) {
        const audioReader = new FileReader();
        audioReader.onload = (e) => {
            audioContext.decodeAudioData(e.target.result)
                .then(buffer => {
                    audioBuffer = buffer;
                    audioIsReady = true;

                    if (chartIsReady && audioIsReady) {
                        document.getElementById('playButton').disabled = false;
                        isLoadingSong = false; // Loading complete
												clearOverlay();
												if (userWantToPlay) playSong();
                    }
                })
                .catch(err => {
                    alert(`Error decoding audio file: ${err}`);
                    isLoadingSong = false; // Failed to load, so stop loading state
										clearOverlay();
                });
        };
        audioReader.readAsArrayBuffer(audioFile);
    }
		
		selectedSongKey = '';
}

// Generates json entry for current song
function updateDeveloperInfo(chartFileName = 'chart.sm', audioFileName = 'audio.mp3') {
		if (!DEV_MODE) return;
		
    // If we don't have a title from a loaded chart, do nothing.
    if (!songInfo || !songInfo.title) {
        document.getElementById('devInfoContainer').style.display = 'none';
        return;
    }

    // Sanitize the title to create a safe directory name (e.g., "My Song!" -> "my-song")
    const safeDirName = songInfo.title.toLowerCase()
                                      .replace(/\s+/g, '-')      // Replace spaces with -
                                      .replace(/[^\w-]+/g, ''); // Remove all non-word chars except -

    // Create the JSON object with our best guesses for the paths
    const devJson = {
        title: songInfo.title || "Unknown Title",
        artist: songInfo.artist || "Unknown Artist", 
        //chartPath: `songs/${safeDirName}/${chartFileName}`,
        //audioPath: `songs/${safeDirName}/${audioFileName}`
        chartPath: `songs/${chartFileName}`,
        audioPath: `songs/${audioFileName}`
    };
		let key = selectedSongKey;
		if (!key) key = `${Date.now()}`;
		devJson.key = key;

    // Convert the object to a nicely formatted string
    const jsonString = ',\n' + JSON.stringify(devJson, null, 2); // null, 2 enables pretty-printing

    // Display the info and the text
    const container = document.getElementById('devInfoContainer');
    const output = document.getElementById('devJsonOutput');
    output.value = jsonString;
    //container.style.display = 'block';  // Z hotkey
}

// --- helper: is element visible in the viewport? ---
// we using it to not show best score toast if best score message is visible in div.
function isElementInViewport(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  // Return true if any part of rect intersects viewport
  return rect.top >= 0 && rect.left >= 0 && rect.bottom <= vh && rect.right <= vw;
}
