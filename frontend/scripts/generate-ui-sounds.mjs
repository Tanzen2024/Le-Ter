// Génère les sons d'interface et de table de Le Ter (assets/audio/*.wav) par synthèse : aucun fichier
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

/**
 * Bruit filtré (frottement, contact de carte) : générateur pseudo-aléatoire À GRAINE FIXE, donc
 * fichiers identiques à chaque génération. `lowpass` / `highpass` : coefficients 0..1 de
 * filtres à un pôle (plus petit = plus filtré). Attaque `attack` s, décroissance `decay`.
 */
function renderNoise({ start, duration, gain, lowpass = 1, highpass = 0, attack = 0.002, decay = 5 }, totalSeconds, seed = 1) {
  const samples = new Float64Array(Math.ceil(totalSeconds * SAMPLE_RATE));
  let state = seed >>> 0 || 1;
  const random = () => {
    // xorshift32 : déterministe, suffisant pour du bruit.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  };
  const first = Math.floor(start * SAMPLE_RATE);
  const count = Math.floor(duration * SAMPLE_RATE);
  const rise = Math.max(1, Math.floor(attack * SAMPLE_RATE));
  let low = 0;
  let previousLow = 0;
  let high = 0;
  for (let i = 0; i < count && first + i < samples.length; i += 1) {
    low += lowpass * (random() - low);
    // Passe-haut : retire le grave du bruit filtré (souffle plus net).
    high = highpass > 0 ? (1 - highpass) * (high + low - previousLow) : low;
    previousLow = low;
    const envelope = Math.min(1, i / rise) * Math.exp((-decay * i) / count);
    samples[first + i] += high * envelope * gain;
  }
  return samples;
}

/** Superpose plusieurs rendus de même durée. */
function mix(...layers) {
  const out = new Float64Array(Math.max(...layers.map((l) => l.length)));
  for (const layer of layers) layer.forEach((value, i) => (out[i] += value));
  return out;
}

/**
 * Niveau crête visé par fichier (dBFS). Les rendus ci-dessous fixent le TIMBRE et l'équilibre
 * interne d'un son ; son NIVEAU est fixé ici, par normalisation en virgule flottante avant la
 * quantification 16 bits (aucune perte, aucune saturation : la crête reste sous 0 dBFS).
 * Les anciens fichiers culminaient entre -7 et -16 dBFS et le volume « Fort » valait déjà 1 :
 * le logiciel ne pouvait pas les rendre plus audibles. Hiérarchie : les sons qui annoncent un
 * événement (carte posée, tour, refus, résultat) à -1 dBFS ; les sons de geste, très
 * fréquents (clic, saisie), un cran en dessous pour ne pas devenir agressifs.
 */
const PEAK_DB = {
  'ui-click.wav': -4,
  'card-pick.wav': -3,
  'card-deal.wav': -2,
};
const DEFAULT_PEAK_DB = -1;

function normalize(samples, peakDb) {
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (peak === 0) return samples;
  const factor = 10 ** (peakDb / 20) / peak;
  return samples.map((value) => value * factor);
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

  // --- Sons de la table (LOT 5) : doux, courts, en retrait des sons d'interface. ---
  // Distribution : souffle bref d'un paquet glissé sur le feutre (un son par lot, pas par carte).
  'card-deal.wav': renderNoise(
    { start: 0, duration: 0.13, gain: 1.0, lowpass: 0.35, highpass: 0.2, attack: 0.018, decay: 4 },
    0.14,
    7,
  ),
  // Carte saisie : effleurement très léger.
  'card-pick.wav': mix(
    renderNoise({ start: 0, duration: 0.05, gain: 0.55, lowpass: 0.5, highpass: 0.3, attack: 0.003, decay: 6 }, 0.06, 11),
    render([{ freq: 2093, start: 0, duration: 0.04, gain: 0.08 }], 0.06),
  ),
  // Carte posée (coup confirmé) : contact du carton et petit choc sourd sur la table.
  'card-place.wav': mix(
    renderNoise({ start: 0, duration: 0.07, gain: 0.7, lowpass: 0.45, highpass: 0.1, attack: 0.001, decay: 7 }, 0.12, 23),
    // Le choc à 150 Hz est presque inaudible sur un haut-parleur de téléphone (coupure vers
    // 300-500 Hz) : une composante à 320 Hz, harmonique, porte le contact sur mobile.
    render(
      [
        { freq: 150, start: 0, duration: 0.09, gain: 0.26 },
        { freq: 320, start: 0, duration: 0.07, gain: 0.2, harmonics: 0.4 },
      ],
      0.12,
    ),
  ),
  // À moi de jouer : petite cloche à deux notes, distincte de la confirmation d'interface.
  'turn-chime.wav': render(
    [
      { freq: 1046.5, start: 0, duration: 0.32, gain: 0.18, harmonics: 0.15 },
      { freq: 1568, start: 0.09, duration: 0.42, gain: 0.16, harmonics: 0.15 },
    ],
    0.52,
  ),
  // Résultat favorable (victoire désignée par le serveur) : arpège montant.
  'result-win.wav': render(
    [
      { freq: 523.25, start: 0, duration: 0.22, gain: 0.22 },
      { freq: 659.25, start: 0.09, duration: 0.24, gain: 0.22 },
      { freq: 783.99, start: 0.18, duration: 0.28, gain: 0.22 },
      { freq: 1046.5, start: 0.27, duration: 0.5, gain: 0.24, harmonics: 0.1 },
    ],
    0.8,
  ),
  // Autre résultat (défaite, égalité, partie arrêtée) : accord calme de résolution.
  'result-neutral.wav': render(
    [
      { freq: 392, start: 0, duration: 0.5, gain: 0.2 },
      { freq: 523.25, start: 0.06, duration: 0.55, gain: 0.18 },
    ],
    0.64,
  ),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, samples] of Object.entries(SOUNDS)) {
  const wav = toWav(normalize(samples, PEAK_DB[name] ?? DEFAULT_PEAK_DB));
  writeFileSync(join(OUT_DIR, name), wav);
  console.log(`${name} : ${wav.length} octets`);
}
