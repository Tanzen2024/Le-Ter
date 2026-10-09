// Génère les sons d'interface de Le Ter (assets/audio/*.wav) par synthèse : aucun fichier
// téléchargé, aucune licence tierce. Sons courts, mono, 22 050 Hz, 16 bits (quelques Ko).
//
//   node scripts/generate-ui-sounds.mjs
//
// Pour remplacer un son par un fichier conçu par un designer sonore : déposer le fichier
// sous le même nom (ou mettre à jour SOUND_SOURCES dans src/services/expo-sound-player.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'audio');

/**
 * Une note : fréquence (Hz), durée (s), départ (s), amplitude, et part d'harmoniques
 * impaires (0 = sinus pur, plus « doux » ; > 0 = timbre plus marqué).
 */
function render(notes, totalSeconds) {
  const samples = new Float64Array(Math.ceil(totalSeconds * SAMPLE_RATE));
  for (const { freq, start, duration, gain, harmonics = 0 } of notes) {
    const first = Math.floor(start * SAMPLE_RATE);
    const count = Math.floor(duration * SAMPLE_RATE);
    const attack = Math.max(1, Math.floor(0.004 * SAMPLE_RATE));
    for (let i = 0; i < count && first + i < samples.length; i += 1) {
      const t = i / SAMPLE_RATE;
      // Attaque de 4 ms (pas de clic numérique) puis décroissance exponentielle.
      const envelope = Math.min(1, i / attack) * Math.exp((-5 * i) / count);
      let wave = Math.sin(2 * Math.PI * freq * t);
      if (harmonics > 0) {
        wave += harmonics * (Math.sin(2 * Math.PI * 3 * freq * t) / 3);
        wave += harmonics * (Math.sin(2 * Math.PI * 5 * freq * t) / 5);
        wave /= 1 + harmonics * (1 / 3 + 1 / 5);
      }
      samples[first + i] += wave * envelope * gain;
    }
  }
  return samples;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => {
    const clamped = Math.max(-1, Math.min(1, value));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // taille du bloc fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // octets par seconde
  header.writeUInt16LE(2, 32); // octets par échantillon
  header.writeUInt16LE(16, 34); // bits par échantillon
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const SOUNDS = {
  // Clic bref et discret (boutons).
  'ui-click.wav': render([{ freq: 1760, start: 0, duration: 0.04, gain: 0.35 }], 0.05),
  // Deux notes montantes (préférence appliquée).
  'ui-confirm.wav': render(
    [
      { freq: 880, start: 0, duration: 0.09, gain: 0.32 },
      { freq: 1318.5, start: 0.075, duration: 0.14, gain: 0.32 },
    ],
    0.23,
  ),
  // Deux notes graves descendantes, timbre plus marqué (action impossible).
  'ui-error.wav': render(
    [
      { freq: 311, start: 0, duration: 0.11, gain: 0.34, harmonics: 0.6 },
      { freq: 233, start: 0.1, duration: 0.17, gain: 0.34, harmonics: 0.6 },
    ],
    0.28,
  ),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, samples] of Object.entries(SOUNDS)) {
  const wav = toWav(samples);
  writeFileSync(join(OUT_DIR, name), wav);
  console.log(`${name} : ${wav.length} octets`);
}
