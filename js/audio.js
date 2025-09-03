// --- Audio Handling  ---


function playSound(buffer, time, volume) {
    if (!audioContext || !buffer || volume <= 0 || !masterGainNode) return null;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;
    source.connect(gainNode).connect(masterGainNode);
    source.start(time);
    return source;
}

function generateClapSound(type = 'zap') {
    if (!audioContext) return;
    const sampleRate = audioContext.sampleRate;
    const duration = 0.05; // 50ms duration for all sounds
    const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    const len = data.length;
    
    if (type === 'loaded' && loadedClapBuffer) {
        assistClapBuffer = loadedClapBuffer;
        return; // Exit, we don't need to generate anything.
    }

    switch (type) {
        // A sharp, cutting burst of white noise. Good for being heard over music.
        case 'noise':
            for (let i = 0; i < len; i++) {
                // Generate random noise and apply a very fast exponential decay
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.015));
            }
            break;

        // A harmonically richer, more 'digital' sound than the sine wave.
        case 'square':
             for (let i = 0; i < len; i++) {
                const time = i / sampleRate;
                // A square wave (alternating 1 and -1)
                const square = Math.sin(Math.PI * 2 * 440 * time) >= 0 ? 1 : -1;
                data[i] = square * Math.exp(-i / (sampleRate * 0.005));
            }
            break;
            
        // A very fast downward frequency sweep. Piercing and distinct.
        case 'zap':
            for (let i = 0; i < len; i++) {
                const time = i / sampleRate;
                // Sweeps from 2000Hz down to 400Hz over the duration
                const frequency = 2000 * Math.exp(time * -250);
                data[i] = Math.sin(Math.PI * 2 * frequency * time) * Math.exp(-i / (sampleRate * 0.02));
            }
            break;

        // The original sound. A pure, clean tone.
        case 'sine':
        default:
            for (let i = 0; i < len; i++) {
                data[i] = Math.sin(Math.PI * 2 * 1000 * i / sampleRate) * Math.exp(-i / (sampleRate * 0.01));
            }
            break;
            
        // A burst of shaped white noise to simulate an impact.
        case 'clap':
            for (let i = 0; i < len; i++) {
                // White noise for the 'smack' sound
                const noise = Math.random() * 2 - 1;
                // A fast, curved decay envelope makes it feel percussive
                const envelope = Math.pow(1 - (i / len), 4);
                data[i] = noise * envelope;
            }
            break;
          
        // A mellow, 8-bit-style beep. Less harsh than a square wave.
        case 'triangle':
            const freq = 440; // A higher pitch often works well for triangles
            for (let i = 0; i < len; i++) {
                const time = i / sampleRate;
                // Generates a value that moves between -1 and 1 in a linear ramp
                const triangleValue = 1 - 4 * Math.abs(Math.round(time * freq) - (time * freq));
                data[i] = triangleValue * Math.exp(-i / (sampleRate * 0.01));
            }
            break;
    }
    assistClapBuffer = buffer;
}
