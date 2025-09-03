/** Save/Load game state in local storage
  *****
  * Controls, keybinds, best score, last played song, difficulty etc
  *****/

// It generate a hash from a string.
// We using it to genarate a unique chart key based on actual chart note data.
function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277,
        h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    
    //return [(h1^h2^h3^h4)>>>0, (h2^h1)>>>0, (h3^h1)>>>0, (h4^h1)>>>0].join('-'); // string-based hash
    return (h1^h2^h3^h4)>>>0; // i think it's more than enough
}

/** --- HIGH SCORE KEY GENERATION ---
// This function creates a unique identifier for a player's score record.
// A high score is not just tied to a song, but to the specific way it was played.
*/
function getHighScoreKey(speed, playheadOn, assistOn) {
    if (!chartHash || !speed) return null; // The global chartHash is calculated in initChart()

    let modeString = '';
    if (playheadOn) {
        modeString = 'PH_ON'; // Playhead is ON, assist doesn't matter
    } else {
        modeString = assistOn ? 'ASSIST' : 'PH_OFF'; // Playhead is OFF, differentiate by assist
    }

    // Creates a key like "1234567890-12-1.2-ASSIST"
    const key = `${chartHash}-${speed.toFixed(1)}-${modeString}`; // db(key);
    return key;
}


function loadKeybinds() {
    const savedBinds = localStorage.getItem('pharaohKeybinds');
    if (savedBinds) {
        keybinds = JSON.parse(savedBinds);
    }
}

function saveKeybinds() {
    localStorage.setItem('pharaohKeybinds', JSON.stringify(keybinds));
}

function saveSettings() {
    const settings = {
        songVolume: document.getElementById('songVolume').value,
        assistVolume: document.getElementById('assistVolume').value,
        clapSoundType: document.getElementById('clapSoundType').value,
        audioOffset: document.getElementById('audioOffset').value,
        showPlayhead: document.getElementById('showPlayhead').checked,
        lastSelectedDifficulty: lastSelectedDifficulty,
        lastPlayedSongIndex: document.getElementById('songSelector').selectedIndex
    };
    localStorage.setItem('pharaohWebPlayerSettings', JSON.stringify(settings));
}

function loadSettings() {
    const savedSettings = localStorage.getItem('pharaohWebPlayerSettings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);

        // Apply volume settings
        if (settings.songVolume !== undefined) {
            const songVolumeControl = document.getElementById('songVolume');
            songVolumeControl.value = settings.songVolume;
            songVolumeControl.dispatchEvent(new Event('input'));
        }
        if (settings.assistVolume !== undefined) {
            document.getElementById('assistVolume').value = settings.assistVolume;
        }
        
        if (settings.clapSoundType !== undefined) {
            document.getElementById('clapSoundType').value = settings.clapSoundType;
        }

        // Apply offset settings
        if (settings.audioOffset !== undefined) {
            const offsetControl = document.getElementById('audioOffset');
            offsetControl.value = settings.audioOffset;
            additionalOffset = parseInt(settings.audioOffset, 10) / 1000;
        }

        // Apply playhead settings
        if (settings.showPlayhead !== undefined) {
            document.getElementById('showPlayhead').checked = settings.showPlayhead;
        }
        document.getElementById('showPlayhead').checked = false; // no playhead

        // Restore the last selected difficulty
        if (settings.lastSelectedDifficulty !== undefined) {
            lastSelectedDifficulty = settings.lastSelectedDifficulty;
        } else if (lastSelectedDifficulty == null) {
            lastSelectedDifficulty = 6; 
        }
    } else { 
        lastSelectedDifficulty = 6; // Default difficulty for the first time
    }
}

function updateKeybindUI() {
    const container = document.getElementById('keybindSettings');
    container.innerHTML = 'Keybinds: ';
    for (let i = 0; i < 4; i++) {
        const keyForLane = Object.keys(keybinds).find(k => keybinds[k] === i) || '...';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = keyForLane;
        input.dataset.lane = i;
        input.readOnly = true;
        input.style.width = '70px';
        input.addEventListener('focus', e => e.target.value = 'Press Key');
        input.addEventListener('blur', e => e.target.value = Object.keys(keybinds).find(k => keybinds[k] === i) || '...');
        input.addEventListener('keydown', e => {
            e.preventDefault();
            const newKeyCode = e.code;
            delete keybinds[newKeyCode];
            Object.keys(keybinds).forEach(key => {
                if (keybinds[key] === i) delete keybinds[key];
            });
            input.value = newKeyCode;
            keybinds[newKeyCode] = i;
            saveKeybinds();
            input.blur();
        });
        container.appendChild(input);
    }
}


function saveHighScore() {
    // Use the state CAPTURED at the beginning of the song
    const key = getHighScoreKey(speedDuringPlay, playheadDuringPlay, assistDuringPlay);
    if (!key) return;

    const highScores = JSON.parse(localStorage.getItem('pharaohHighScores') || '{}');
    const currentBest = highScores[key] || 0;
    const newAccuracy = parseFloat(document.getElementById('accuracyDisplay').textContent);

    if (newAccuracy > currentBest) {
        highScores[key] = newAccuracy;
        localStorage.setItem('pharaohHighScores', JSON.stringify(highScores));
        //console.log(`New high score for ${key}: ${newAccuracy}`);

        // Immediately update the display to show the new record we just set.
        displayBestScore();
    }
}

function saveLastPlayedDifficulty() {
    if (!songInfo.artist || !songInfo.title) return;
    const key = `${songInfo.artist}-${songInfo.title}`;
    const lastDifficulties = JSON.parse(localStorage.getItem('pharaohLastDifficulty') || '{}');
    
    // Save the meter of the chart that was just played
    lastDifficulties[key] = chartMeter; 
    localStorage.setItem('pharaohLastDifficulty', JSON.stringify(lastDifficulties));
}

window.__bestScoreToastTimer = window.__bestScoreToastTimer || null;

function displayBestScore() {
    // Get the CURRENT state of the UI controls
    const playheadOn = document.getElementById('showPlayhead').checked;
    const assistOn = parseFloat(document.getElementById('assistVolume').value) > 0;

    const key = getHighScoreKey(playbackRate, playheadOn, assistOn);
    const display = document.getElementById('bestScoreDisplay');
    if (!key) {
        display.textContent = '';
        return;
    }

    // Generate the human-readable text for the current mode
    let modeText = '';
    if (playheadOn) {
        modeText = 'with playhead';
    } else {
        modeText = assistOn ? 'with assist' : 'without assist';
    }

    const highScores = JSON.parse(localStorage.getItem('pharaohHighScores') || '{}');
    bestScore = highScores[key];

    let message;
    if (bestScore != null) {
        message = `Best: ${bestScore.toFixed(2)}% (at ${chartMeter} difficulty, ${playbackRate.toFixed(1)}x, ${modeText})`;
        display.textContent = `Best: ${bestScore.toFixed(2)}% (at ${chartMeter} difficulty, ${playbackRate.toFixed(1)}x speed, ${modeText})`;
    } else {
        message = `No score recorded for ${chartMeter} difficulty at ${playbackRate.toFixed(1)}x, ${modeText}`;
        display.textContent = `No score recorded for ${chartMeter} difficulty at ${playbackRate.toFixed(1)}x speed, ${modeText}`;
    }

    // Only show toast if the display element is not visible
    const isVisible = isElementInViewport(display);
    if (!isVisible && window.showSongToast) {
      window.showSongToast(message, {
          tag: 'bestScore',
          mode: 'queue',    
          duration: 2500,
          replaceQueued: true // ensure queued bestScore entries are replaced by later ones
        });
    }
}

function updateJudgementDisplayFromHistory() {
    const playheadOn = document.getElementById('showPlayhead').checked;
    const assistOn = parseFloat(document.getElementById('assistVolume').value) > 0;
    const key = getHighScoreKey(playbackRate, playheadOn, assistOn);

    const lastPlay = key ? sessionPlayHistory[key] : null;

    if (lastPlay) {
        // A record for this mode was found, display it
        document.getElementById('missesDisplay').textContent = lastPlay.misses;
        document.getElementById('accuracyDisplay').textContent = lastPlay.accuracy.toFixed(2);
    } else {
        // No record found for this mode, reset to default values
        document.getElementById('missesDisplay').textContent = '0';
        document.getElementById('accuracyDisplay').textContent = '100';
    }
    
    // Restore saved locked value (if any) on UI init
    const savedFixed = parseFloat(localStorage.getItem('fixedInputOffset'));
    if (!isNaN(savedFixed)) {
        fixedInputOffset = savedFixed;
        autoCalibrate = false;
        // show locked state visually
        const offsetEl2 = document.getElementById('offsetDisplay');
        if (offsetEl2) offsetEl2.classList.add('offset-locked');
        // ensure the initial dynamic value matches the lock
        dynamicInputOffset = fixedInputOffset;
    }
    document.getElementById('offsetDisplay').textContent = dynamicInputOffset.toFixed(0);
}

function recordRecentPlay() {
    if (!songInfo.artist || !songInfo.title) return;
    if (!selectedSongKey) return;
    
    const key = selectedSongKey;
    const recentPlays = JSON.parse(localStorage.getItem('pharaohRecentPlays') || '{}');
    recentPlays[key] = Date.now(); // Store the current timestamp
    localStorage.setItem('pharaohRecentPlays', JSON.stringify(recentPlays));
}

// Excluded songs storage helpers --------------------------------
function loadExcludedSet() {
  const raw = localStorage.getItem('pharaohExcludedSongs');
  if (!raw) return new Set();
  try {
    const obj = JSON.parse(raw);
    return new Set(Object.keys(obj).filter(k => obj[k]));
  } catch {
    return new Set();
  }
}

function saveExcludedSet(set) {
  const obj = {};
  for (const k of set) obj[k] = true;
  localStorage.setItem('pharaohExcludedSongs', JSON.stringify(obj));
}



