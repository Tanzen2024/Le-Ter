// Compose et génère la musique de partie de Le Ter par synthèse : composition ORIGINALE
// écrite ici (mélodie, grille d'accords, rythmique), aucun échantillon, aucun fichier
// téléchargé, aucune œuvre tierce. Style : arcade, énergique et rythmé, au son d'une console
// 16 bits.
//
//   node scripts/generate-music.mjs            (Windows : sources WAV + encodage AAC)
//   node scripts/generate-music.mjs --wav-only (toute plateforme : sources WAV seulement)
//
// 1. Rendu en WAV PCM mono 22 050 Hz, 16 bits, dans audio-src/music/ (sources de travail,
//    ignorées par git, jamais embarquées dans l'application).
// 2. Encodage AAC 96 kbit/s, 44,1 kHz mono par l'encodeur intégré à Windows
//    (scripts/encode-music.ps1) vers assets/audio/music/*.m4a.
// 3. Liste d'édition MP4 (scripts/mp4-edit-list.mjs) : le lecteur ne joue que la piste exacte.
//    L'encodeur ne retarde pas le signal mais abîme les ~10 premières ms et complète la fin
//    par du silence ; chaque source est donc encadrée de PREROLL échantillons (pour une boucle :
//    sa propre fin devant, son début derrière ; sinon du silence) que l'édition retire. Sans
//    cela, chaque tour de boucle aurait un trou d'environ 20 ms.
//
// Pistes (déclarées dans MUSIC_TRACKS, src/services/expo-music-player.ts) :
//   theme-NN-intro.m4a    générique NN (01 à 10) : thème d'entrée (2 mesures), enchaîne sur sa boucle
//   theme-NN-loop.m4a     générique NN : boucle de partie, raccord sans coupure
//   result-victory.m4a    fanfare courte de victoire
//   result-round-end.m4a  thème court de fin de partie (défaite, égalité, arrêt)
// Le générique 01 est écrit note à note ; les génériques 02 à 10 sont composés ici à partir de
// leur fiche (tonalité, mode, grille, tempo, style) et d'une graine fixe : mêmes fichiers à
// chaque génération.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyEditList } from './mp4-edit-list.mjs';

const SR = 22050;
// Tempo du générique en cours de rendu (chaque générique a le sien).
let BEAT;
let STEP; // croche
let BAR;
/** Décalage des croches de contretemps (fraction de croche) : 0 = droit, ~0,33 = swing. */
let SWING = 0;
function setTempo(bpm, swing = 0) {
  BEAT = 60 / bpm;
  STEP = BEAT / 2;
  BAR = BEAT * 4;
  SWING = swing;
}
/** Instant de la croche `i` d'une mesure, swing compris. */
function stepAt(i) {
  return i * STEP + (i % 2 === 1 ? SWING * STEP : 0);
}
setTempo(148);
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(SCRIPTS_DIR, '..', 'audio-src', 'music');
const OUT_DIR = join(SCRIPTS_DIR, '..', 'assets', 'audio', 'music');
/** Échantillons ajoutés de part et d'autre de chaque source, retirés par la liste d'édition. */
const PREROLL = 1024;

// --- Notes -------------------------------------------------------------------------------------
const SEMITONES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const NAMES = Object.keys(SEMITONES);
function midiOf(name) {
  const [, pitch, octave] = /^([A-G]#?)(\d)$/.exec(name);
  return 12 * (Number(octave) + 1) + SEMITONES[pitch];
}
function nameOf(midi) {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
function hz(name) {
  return 440 * 2 ** ((midiOf(name) - 69) / 12);
}

// --- Bruit déterministe (fichiers identiques à chaque génération) -------------------------------
let seed = 0x2f6b9a1d;
function noise() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 4294967296) * 2 - 1;
}

// --- Oscillateurs à bande limitée (polyBLEP : pas de repliement aigu) -------------------------
function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
function saw(phase, dt) {
  return 2 * phase - 1 - polyBlep(phase, dt);
}
function pulse(phase, dt, width) {
  let value = phase < width ? 1 : -1;
  value += polyBlep(phase, dt);
  value -= polyBlep((phase + 1 - width) % 1, dt);
  return value;
}

// --- Piste : tampon circulaire (une boucle raccorde ses queues de notes au début) -------------
class Track {
  constructor(seconds, circular) {
    this.length = Math.round(seconds * SR);
    this.data = new Float64Array(this.length);
    this.circular = circular;
  }
  add(index, value) {
    if (index < this.length) this.data[index] += value;
    else if (this.circular) this.data[index % this.length] += value;
  }
}

/** Voix mélodique : oscillateur, enveloppe ADSR simple, vibrato, filtre passe-bas un pôle. */
function tone(track, { freq, start, duration, gain, wave = 'saw', width = 0.5, attack = 0.005, release = 0.06, cutoff = 0.5, vibrato = 0, sustain = 1, decay = 0 }) {
  const first = Math.round(start * SR);
  const held = Math.round(duration * SR);
  const total = held + Math.round(release * SR);
  const rise = Math.max(1, Math.round(attack * SR));
  let phase = 0;
  let low = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const vib = vibrato > 0 && t > 0.12 ? 1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t) : 1;
    const f = freq * vib;
    const dt = f / SR;
    phase = (phase + dt) % 1;
    const raw = wave === 'saw' ? saw(phase, dt) : wave === 'pulse' ? pulse(phase, dt, width) : Math.sin(2 * Math.PI * phase);
    low += cutoff * (raw - low);
    let env = Math.min(1, i / rise);
    if (decay > 0) env *= sustain + (1 - sustain) * Math.exp(-t / decay);
    if (i >= held) env *= Math.max(0, 1 - (i - held) / (total - held));
    track.add(first + i, low * env * gain);
  }
}

function kick(track, start, gain = 0.9) {
  const first = Math.round(start * SR);
  const count = Math.round(0.22 * SR);
  let phase = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / SR;
    const f = 48 + 120 * Math.exp(-t / 0.03);
    phase += f / SR;
    const click = i < 60 ? noise() * 0.3 * (1 - i / 60) : 0;
    track.add(first + i, (Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.08) + click) * gain);
  }
}

function snare(track, start, gain = 0.55) {
  const first = Math.round(start * SR);
  const count = Math.round(0.18 * SR);
  let previous = 0;
  let phase = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / SR;
    const n = noise();
    const bright = n - previous; // passe-haut grossier : grain de caisse claire
    previous = n;
    phase += 190 / SR;
    const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.03) * 0.6;
    track.add(first + i, (bright * 0.7 * Math.exp(-t / 0.055) + body) * gain);
  }
}

function hat(track, start, gain = 0.16, open = false) {
  const first = Math.round(start * SR);
  const length = open ? 0.16 : 0.04;
  const count = Math.round(length * SR);
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    const n = noise();
    const bright = n - previous;
    previous = n;
    track.add(first + i, bright * Math.exp(-(i / SR) / (length / 3)) * gain);
  }
}

function crash(track, start, gain = 0.22) {
  const first = Math.round(start * SR);
  const count = Math.round(1.1 * SR);
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    const n = noise();
    const bright = n - previous;
    previous = n;
    track.add(first + i, bright * Math.exp(-(i / SR) / 0.35) * gain);
  }
}

/** Écho (délai d'une croche pointée) sur une piste, circulaire pour une boucle. */
function echo(track, seconds, feedback, mix) {
  const delay = Math.round(seconds * SR);
  const n = track.length;
  const dry = Float64Array.from(track.data);
  // wet[i] = dry[i - d] + feedback × wet[i - d] ; deux passes pour qu'une boucle renvoie
  // l'écho de sa fin sur son début.
  const wet = new Float64Array(n);
  for (let pass = 0; pass < (track.circular ? 2 : 1); pass += 1) {
    for (let i = 0; i < n; i += 1) {
      const from = i - delay;
      if (from < 0 && !track.circular) continue;
      const j = from < 0 ? from + n : from;
      wet[i] = dry[j] + feedback * wet[j];
    }
  }
  for (let i = 0; i < n; i += 1) track.data[i] = dry[i] + wet[i] * mix;
}

function mixTracks(seconds, circular, parts) {
  const out = new Track(seconds, circular);
  for (const [track, gain] of parts) for (let i = 0; i < out.length; i += 1) out.data[i] += track.data[i] * gain;
  return out;
}

/** Normalise en crête (-1 dBFS) avec une saturation douce au-delà du genou. */
function master(track, peakDb = -1) {
  let peak = 0;
  for (const v of track.data) peak = Math.max(peak, Math.abs(v));
  const target = 10 ** (peakDb / 20);
  // Compression légère : on vise une crête 1,4 fois plus haute puis tanh arrondit les pointes.
  const drive = (target * 1.4) / peak;
  const shaped = track.data.map((v) => Math.tanh(v * drive));
  let shapedPeak = 0;
  for (const v of shaped) shapedPeak = Math.max(shapedPeak, Math.abs(v));
  return shaped.map((v) => (v / shapedPeak) * target);
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// --- Composition -------------------------------------------------------------------------------
const CHORDS = {
  Am: { root: 'A', notes: ['A4', 'C5', 'E5'] },
  F: { root: 'F', notes: ['F4', 'A4', 'C5'] },
  G: { root: 'G', notes: ['G4', 'B4', 'D5'] },
  E: { root: 'E', notes: ['G#4', 'B4', 'E5'] },
  Dm: { root: 'D', notes: ['F4', 'A4', 'D5'] },
  A: { root: 'A', notes: ['A4', 'C#5', 'E5'] },
  D: { root: 'D', notes: ['F#4', 'A4', 'D5'] },
};

// Mélodie : 8 croches par mesure ; « - » prolonge la note précédente, « . » est un silence.
const SECTION_A = [
  ['Am', ['E5', '.', 'E5', 'A5', '-', 'G5', 'E5', '-']],
  ['F', ['F5', '-', 'E5', 'D5', '-', 'C5', 'D5', '-']],
  ['G', ['D5', '.', 'D5', 'G5', '-', 'F5', 'D5', '-']],
  ['Am', ['E5', '-', '-', '-', 'C5', 'D5', 'E5', '-']],
  ['Am', ['E5', '.', 'E5', 'A5', '-', 'B5', 'C6', '-']],
  ['F', ['C6', '-', 'B5', 'A5', '-', 'G5', 'A5', '-']],
  ['G', ['B5', '-', 'A5', 'G5', '-', 'F5', 'G5', '-']],
  ['E', ['G#5', '-', '-', '-', 'B5', '-', 'E5', '-']],
];
const SECTION_B = [
  ['Dm', ['F5', '-', '-', 'A5', '-', '-', 'D6', '-']],
  ['Am', ['C6', '-', 'B5', 'A5', '-', 'E5', '-', '-']],
  ['F', ['F5', '-', '-', 'A5', '-', '-', 'C6', '-']],
  ['E', ['B5', '-', '-', 'G#5', '-', '-', 'E5', '-']],
  ['Dm', ['D5', 'F5', 'A5', 'D6', '-', 'C6', 'A5', '-']],
  ['Am', ['C6', '-', 'A5', 'E5', '-', 'A5', 'C6', '-']],
  ['F', ['D6', '-', 'C6', 'A5', '-', 'F5', 'A5', '-']],
  ['E', ['G#5', '-', 'B5', '-', 'E6', '-', '-', '-']],
];

function octaveDown(note) {
  if (note === '-' || note === '.') return note;
  const [, pitch, octave] = /^([A-G]#?)(\d)$/.exec(note);
  return `${pitch}${Number(octave) - 1}`;
}

/** Joue une mélodie (liste de 8 croches) à partir de `start`. */
function melody(track, steps, start, voice) {
  for (let i = 0; i < steps.length; i += 1) {
    const note = steps[i];
    if (note === '-' || note === '.') continue;
    let length = 1;
    while (i + length < steps.length && steps[i + length] === '-') length += 1;
    tone(track, { ...voice, freq: hz(note), start: start + stepAt(i), duration: length * STEP * 0.92 });
  }
}

const LEAD = { gain: 0.32, wave: 'pulse', width: 0.25, attack: 0.006, release: 0.08, cutoff: 0.55, vibrato: 0.006 };
const LEAD_LOW = { gain: 0.2, wave: 'saw', attack: 0.01, release: 0.08, cutoff: 0.3, vibrato: 0.004 };
const BASS = { gain: 0.42, wave: 'saw', attack: 0.003, release: 0.03, cutoff: 0.18, decay: 0.09, sustain: 0.55 };
const STAB = { gain: 0.11, wave: 'saw', attack: 0.004, release: 0.05, cutoff: 0.35, decay: 0.06, sustain: 0.3 };

/**
 * Accompagnement d'une mesure : basse, ponctuations d'accords, batterie. `chordName` est un nom
 * de CHORDS ou un accord déjà construit ; le style par défaut est celui du générique 01.
 */
function backing({ bass, stabs, drums }, chordName, start, { intense = false, crashHere = false, style = {} } = {}) {
  const chord = typeof chordName === 'string' ? CHORDS[chordName] : chordName;
  const low = `${chord.root}2`;
  const high = `${chord.root}3`;
  const fifth = hz(low) * 1.5;
  const bassStyle = style.bass ?? 'octaves';
  // Basse : 8 croches ; « 5 » = quinte, null = silence, une note suivie de « - » est tenue.
  const pattern = {
    octaves: [low, low, high, low, low, high, low, '5'],
    pump: [low, low, low, low, low, low, low, '5'],
    walk: [low, '-', '5', '-', high, '-', '5', '-'],
    synco: [low, null, null, low, null, '5', low, high],
  }[bassStyle];
  pattern.forEach((note, i) => {
    if (note === null || note === '-') return;
    const held = pattern[i + 1] === '-' ? 2 : 1;
    tone(bass, { ...BASS, freq: note === '5' ? fifth : hz(note), start: start + stepAt(i), duration: STEP * (held - 0.2) });
  });
  // Accords sur les contretemps des temps 2 et 4 (« et »), plus un accent sur le 1.
  for (const at of style.stabs ?? [0, 3, 7]) {
    for (const note of chord.notes) tone(stabs, { ...STAB, freq: hz(note), start: start + stepAt(at), duration: STEP * 0.6 });
  }
  if (crashHere) crash(drums, start);
  drumBar(drums, start, style.drums ?? 'drive', intense);
}

/** Batterie d'une mesure selon le style du générique. */
function drumBar(drums, start, kind, intense) {
  const at = (i) => start + stepAt(i);
  if (kind === 'four') {
    for (const i of [0, 2, 4, 6]) kick(drums, at(i));
    snare(drums, at(2), 0.5);
    snare(drums, at(6), 0.5);
    for (let i = 0; i < 8; i += 1) hat(drums, at(i), i % 2 === 1 ? 0.15 : 0.07, i % 2 === 1);
    if (intense) for (let i = 0; i < 8; i += 1) hat(drums, at(i) + STEP / 2, 0.06);
    return;
  }
  if (kind === 'half') {
    kick(drums, at(0));
    kick(drums, at(5), 0.7);
    snare(drums, at(4), 0.6);
    if (intense) kick(drums, at(7), 0.5);
    for (let i = 0; i < 16; i += 1) hat(drums, start + (i * BAR) / 16, i % 4 === 2 ? 0.15 : 0.08);
    return;
  }
  if (kind === 'shuffle') {
    kick(drums, at(0));
    kick(drums, at(4), 0.8);
    if (intense) kick(drums, at(7), 0.5);
    snare(drums, at(2), 0.45);
    snare(drums, at(6), 0.45);
    for (let i = 0; i < 8; i += 1) hat(drums, at(i), i % 2 === 0 ? 0.13 : 0.09, i === 7);
    return;
  }
  if (kind === 'break') {
    kick(drums, at(0));
    kick(drums, at(3), 0.7);
    kick(drums, at(5), 0.8);
    snare(drums, at(2));
    snare(drums, at(6));
    snare(drums, at(7), 0.15);
    const hats = intense ? 16 : 8;
    for (let i = 0; i < hats; i += 1) hat(drums, start + (i * BAR) / hats, i % 2 === 1 ? 0.14 : 0.1);
    return;
  }
  // « drive » : batterie du générique 01.
  kick(drums, start);
  kick(drums, start + 3 * STEP, 0.75);
  kick(drums, start + 4 * STEP);
  if (intense) kick(drums, start + 6 * STEP, 0.6);
  snare(drums, start + 2 * STEP);
  snare(drums, start + 6 * STEP);
  const hats = intense ? 16 : 8;
  for (let i = 0; i < hats; i += 1) {
    const time = start + (i * BAR) / hats;
    hat(drums, time, i % 2 === 1 ? 0.17 : 0.11, !intense && i === 7);
  }
}

function newLayers(seconds, circular) {
  return {
    lead: new Track(seconds, circular),
    arp: new Track(seconds, circular),
    bass: new Track(seconds, circular),
    stabs: new Track(seconds, circular),
    drums: new Track(seconds, circular),
  };
}

function render(layers, seconds, circular, echoMix = 0.28) {
  echo(layers.lead, STEP * 1.5, 0.32, echoMix);
  return master(
    mixTracks(seconds, circular, [
      [layers.lead, 1],
      [layers.arp, 1],
      [layers.bass, 1],
      [layers.stabs, 1],
      [layers.drums, 1],
    ]),
  );
}

function matchLoop() {
  const bars = [
    ...SECTION_A.map((bar, i) => ({ bar, crashHere: i === 0 })),
    ...SECTION_B.map((bar, i) => ({ bar, crashHere: i === 0 })),
    ...SECTION_A.map((bar, i) => ({ bar, crashHere: i === 0, intense: true })),
  ];
  const seconds = bars.length * BAR;
  const layers = newLayers(seconds, true);
  bars.forEach(({ bar: [chord, steps], crashHere, intense }, i) => {
    const start = i * BAR;
    melody(layers.lead, steps, start, LEAD);
    // Reprise finale : la mélodie est doublée à l'octave inférieure, plus dense.
    if (intense) melody(layers.lead, steps.map(octaveDown), start, LEAD_LOW);
    backing(layers, chord, start, { intense, crashHere });
  });
  return render(layers, seconds, true);
}

function intro() {
  // « En garde » : roulement qui monte sur une pédale de mi, puis quatre accords frappés qui
  // mènent au premier temps de la boucle.
  const seconds = 2 * BAR;
  const layers = newLayers(seconds, false);
  tone(layers.bass, { ...BASS, freq: hz('E2'), start: 0, duration: BAR, decay: 0, sustain: 1 });
  for (let i = 0; i < 16; i += 1) snare(layers.drums, (i * BAR) / 16, 0.15 + (0.4 * i) / 16);
  crash(layers.drums, 0, 0.15);
  ['Am', 'F', 'G', 'E'].forEach((name, i) => {
    const start = BAR + i * BEAT;
    kick(layers.drums, start);
    snare(layers.drums, start, 0.35);
    tone(layers.bass, { ...BASS, freq: hz(`${CHORDS[name].root}2`), start, duration: BEAT * 0.8 });
    for (const note of CHORDS[name].notes) tone(layers.stabs, { ...STAB, gain: 0.16, freq: hz(note), start, duration: BEAT * 0.7 });
    tone(layers.lead, { ...LEAD, freq: hz(octaveUp(CHORDS[name].notes[2])), start, duration: BEAT * 0.7 });
  });
  return render(layers, seconds, false);
}

function octaveUp(note) {
  const [, pitch, octave] = /^([A-G]#?)(\d)$/.exec(note);
  return `${pitch}${Number(octave) + 1}`;
}

function victory() {
  // Fanfare en la majeur : arpège montant, puis accord tenu avec cymbale.
  const seconds = 2 * BAR + 0.8;
  const layers = newLayers(seconds, false);
  melody(layers.lead, ['A4', 'C#5', 'E5', 'A5', '-', 'E5', 'A5', 'C#6'], 0, LEAD);
  backing(layers, 'A', 0, { crashHere: true });
  tone(layers.lead, { ...LEAD, freq: hz('E6'), start: BAR, duration: BAR * 0.9, release: 0.4 });
  tone(layers.lead, { ...LEAD_LOW, freq: hz('A4'), start: BAR, duration: BAR * 0.9, release: 0.4 });
  for (const note of CHORDS.A.notes) tone(layers.stabs, { ...STAB, gain: 0.14, decay: 0, sustain: 1, freq: hz(note), start: BAR, duration: BAR * 0.9, release: 0.4 });
  tone(layers.bass, { ...BASS, decay: 0, sustain: 1, freq: hz('A2'), start: BAR, duration: BAR * 0.9, release: 0.3 });
  crash(layers.drums, BAR, 0.28);
  kick(layers.drums, BAR);
  return render(layers, seconds, false);
}

function roundEnd() {
  // Fin de partie : descente mineure plus posée, résolution sur la mineur.
  const seconds = 2 * BAR + 0.8;
  const layers = newLayers(seconds, false);
  melody(layers.lead, ['E5', '-', 'D5', '-', 'C5', '-', 'B4', '-'], 0, { ...LEAD, width: 0.5 });
  for (const [i, name] of ['F', 'E'].entries()) {
    const start = i * 2 * BEAT;
    for (const note of CHORDS[name].notes) tone(layers.stabs, { ...STAB, decay: 0, sustain: 1, freq: hz(note), start, duration: BEAT * 1.8 });
    tone(layers.bass, { ...BASS, decay: 0, sustain: 1, freq: hz(`${CHORDS[name].root}2`), start, duration: BEAT * 1.8 });
    kick(layers.drums, start, 0.6);
  }
  tone(layers.lead, { ...LEAD, width: 0.5, freq: hz('A4'), start: BAR, duration: BAR * 0.9, release: 0.4 });
  for (const note of CHORDS.Am.notes) tone(layers.stabs, { ...STAB, decay: 0, sustain: 1, freq: hz(note), start: BAR, duration: BAR * 0.9, release: 0.4 });
  tone(layers.bass, { ...BASS, decay: 0, sustain: 1, freq: hz('A2'), start: BAR, duration: BAR * 0.9, release: 0.3 });
  kick(layers.drums, BAR, 0.6);
  return render(layers, seconds, false);
}

// --- Génériques 02 à 10 : composés à partir d'une fiche -----------------------------------------
const MODES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

/** Générateur pseudo-aléatoire à graine (xorshift) : une fiche donne toujours la même musique. */
function seeded(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * Fiche d'un générique : tonique (octave 4), mode, grille de 4 accords par section (degrés de
 * 0 à 6 ; « 4M » = 5e degré rendu majeur, la sensible des tonalités mineures), tempo, swing,
 * styles de basse et de batterie, timbre de la mélodie, arpège d'accompagnement.
 */
const THEMES = [
  { file: '02', tonic: 'D4', mode: 'dorian', bpm: 132, A: [0, 3, 6, 0], B: [2, 3, 4, 4], bass: 'walk', drums: 'four', lead: { wave: 'pulse', width: 0.5, cutoff: 0.45 }, seed: 0x1a2b3c },
  { file: '03', tonic: 'E4', mode: 'minor', bpm: 160, A: [0, 5, 6, 0], B: [3, 5, 6, '4M'], bass: 'octaves', drums: 'drive', lead: { wave: 'saw', cutoff: 0.4 }, seed: 0x5eed03 },
  { file: '04', tonic: 'C4', mode: 'major', bpm: 126, A: [0, 4, 5, 3], B: [3, 0, 3, 4], bass: 'pump', drums: 'four', lead: { wave: 'pulse', width: 0.125, cutoff: 0.6 }, arp: true, seed: 0x0c0ffe },
  { file: '05', tonic: 'G4', mode: 'minor', bpm: 140, A: [0, 3, 5, '4M'], B: [5, 6, 0, '4M'], bass: 'synco', drums: 'break', lead: { wave: 'pulse', width: 0.25, cutoff: 0.5, vibrato: 0.008 }, seed: 0x9a9a05 },
  { file: '06', tonic: 'F4', mode: 'major', bpm: 118, swing: 0.33, A: [0, 5, 1, 4], B: [3, 4, 2, 5], bass: 'walk', drums: 'shuffle', lead: { wave: 'sine', gain: 0.45, cutoff: 0.9, vibrato: 0.01 }, arp: true, seed: 0xf06f06 },
  { file: '07', tonic: 'B3', mode: 'minor', bpm: 152, A: [0, 6, 5, 6], B: [3, 4, 5, '4M'], bass: 'octaves', drums: 'drive', lead: { wave: 'pulse', width: 0.5, cutoff: 0.4 }, arp: true, seed: 0xb7b7b7 },
  { file: '08', tonic: 'D4', mode: 'major', bpm: 136, A: [0, 5, 3, 4], B: [1, 4, 5, 4], bass: 'synco', drums: 'half', lead: { wave: 'saw', cutoff: 0.35, vibrato: 0.006 }, seed: 0xd08d08 },
  { file: '09', tonic: 'C4', mode: 'minor', bpm: 144, A: [0, 6, 5, 6], B: [5, 3, '4M', '4M'], bass: 'octaves', drums: 'break', lead: { wave: 'pulse', width: 0.25, cutoff: 0.55 }, arp: true, seed: 0xc9c9c9 },
  { file: '10', tonic: 'A3', mode: 'mixolydian', bpm: 128, A: [0, 6, 3, 0], B: [5, 3, 6, 6], bass: 'pump', drums: 'four', lead: { wave: 'pulse', width: 0.25, cutoff: 0.5, vibrato: 0.006 }, seed: 0xa10a10 },
];

/** Hauteur MIDI d'un degré (entier quelconque, négatif ou au-delà de l'octave) du mode. */
function degreeMidi(theme, degree, raiseLeading = false) {
  const scale = MODES[theme.mode];
  const index = ((degree % 7) + 7) % 7;
  const leading = raiseLeading && index === 6 ? 1 : 0;
  return midiOf(theme.tonic) + 12 * Math.floor(degree / 7) + scale[index] + leading;
}

/** Accord d'un degré de la grille, au format de CHORDS (fondamentale + 3 notes vers l'octave 4). */
function chordOf(theme, spec) {
  const major = spec === '4M';
  const degree = major ? 4 : spec;
  let notes = [degree, degree + 2, degree + 4].map((d) => degreeMidi(theme, d, major));
  if (notes[0] > midiOf('D5')) notes = notes.map((m) => m - 12);
  return { degree, major, root: NAMES[notes[0] % 12], notes: notes.map(nameOf) };
}

// Rythmes d'une mesure de mélodie (8 croches) : « x » attaque, « - » tenue, « . » silence.
const RHYTHMS = ['x.xx-xx-', 'x-xx-xx-', 'x--x--x-', 'xxxxx-x-', 'x-x-xxx-', 'x.x.xx--', '.xxx-x-x', 'x-xxx.x-'];
const CADENCES = ['x---x-x-', 'x-------', 'x-x-x---'];
const MOVES = [-2, -1, -1, 1, 1, 2, 0, 3, -3];

function motifOf(random, rhythms) {
  return {
    rhythm: [...rhythms[Math.floor(random() * rhythms.length)]],
    contour: Array.from({ length: 8 }, () => MOVES[Math.floor(random() * MOVES.length)]),
  };
}

/** Degré de l'accord le plus proche de `degree` (temps forts : la mélodie tombe sur l'accord). */
function nearestChordTone(degree, chord) {
  for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
    const d = degree + offset;
    if ([0, 2, 4].includes((((d - chord.degree) % 7) + 7) % 7)) return d;
  }
  return degree;
}

/**
 * Une mesure de mélodie : le motif donne le rythme et le profil ; les temps forts tombent sur
 * une note de l'accord ; `endOn` force la dernière note sur ce degré (cadence).
 */
function barMelody(theme, motif, chord, cursor, { low, high, endOn }) {
  const last = motif.rhythm.lastIndexOf('x');
  let current = cursor;
  const steps = motif.rhythm.map((token, i) => {
    if (token !== 'x') return token;
    current = Math.max(low, Math.min(high, current + motif.contour[i]));
    if (i === 0 || i === 4) current = nearestChordTone(current, chord);
    if (i === last && endOn !== undefined) {
      const shift = (((endOn - current) % 7) + 7) % 7;
      current += shift > 3 ? shift - 7 : shift;
    }
    return nameOf(degreeMidi(theme, current + 7, chord.major));
  });
  return { steps, cursor: current };
}

/** Section de 8 mesures : phrase de 4 mesures (motif, réponse, motif, cadence) jouée deux fois. */
function section(theme, random, grid, { low, high, endOn }) {
  const chords = grid.map((spec) => chordOf(theme, spec));
  const first = motifOf(random, RHYTHMS);
  const answer = motifOf(random, RHYTHMS);
  const variant = motifOf(random, RHYTHMS);
  const halfClose = { rhythm: [...CADENCES[Math.floor(random() * CADENCES.length)]], contour: first.contour };
  const fullClose = { rhythm: [...CADENCES[Math.floor(random() * CADENCES.length)]], contour: answer.contour };
  const plan = [first, answer, first, halfClose, first, answer, variant, fullClose];
  let cursor = Math.round((low + high) / 2);
  return plan.map((motif, i) => {
    const chord = chords[i % 4];
    const target = i === 7 ? endOn : i === 3 ? 4 : undefined;
    const bar = barMelody(theme, motif, chord, cursor, { low, high, endOn: target });
    cursor = bar.cursor;
    return { chord, steps: bar.steps };
  });
}

const ARP = { gain: 0.07, wave: 'pulse', width: 0.5, attack: 0.002, release: 0.03, cutoff: 0.4, decay: 0.05, sustain: 0.2 };

/** Arpège en doubles croches sur les notes de l'accord, une octave au-dessus. */
function arpeggio(track, chord, start) {
  const notes = chord.notes.map((n) => nameOf(midiOf(n) + 12));
  for (let i = 0; i < 16; i += 1) {
    const note = notes[[0, 1, 2, 1][i % 4]];
    tone(track, { ...ARP, freq: hz(note), start: start + (i * BAR) / 16, duration: (BAR / 16) * 0.7 });
  }
}

/** Boucle de 16 mesures : section A (thème, cadence sur la tonique), section B (plus aiguë, plus dense). */
function themeLoop(theme) {
  setTempo(theme.bpm, theme.swing ?? 0);
  const random = seeded(theme.seed);
  const voice = { ...LEAD, ...theme.lead };
  const style = { bass: theme.bass, drums: theme.drums };
  const bars = [
    ...section(theme, random, theme.A, { low: -2, high: 6, endOn: 0 }).map((bar, i) => ({ ...bar, crashHere: i === 0 })),
    // Fin de B sur la dominante : la boucle repart sur le premier temps de A.
    ...section(theme, random, theme.B, { low: 1, high: 9, endOn: 4 }).map((bar, i) => ({ ...bar, crashHere: i === 0, intense: i >= 4 })),
  ];
  const seconds = bars.length * BAR;
  const layers = newLayers(seconds, true);
  bars.forEach(({ chord, steps, crashHere, intense }, i) => {
    const start = i * BAR;
    melody(layers.lead, steps, start, voice);
    if (intense) melody(layers.lead, steps.map(octaveDown), start, LEAD_LOW);
    if (theme.arp) arpeggio(layers.arp, chord, start);
    backing(layers, chord, start, { intense, crashHere, style });
  });
  return render(layers, seconds, true, theme.swing ? 0.2 : 0.28);
}

/** Thème d'entrée : roulement montant sur la dominante, puis les accords de A frappés. */
function themeIntro(theme) {
  setTempo(theme.bpm, theme.swing ?? 0);
  const seconds = 2 * BAR;
  const layers = newLayers(seconds, false);
  const voice = { ...LEAD, ...theme.lead };
  const dominant = chordOf(theme, theme.mode === 'minor' ? '4M' : 4);
  tone(layers.bass, { ...BASS, freq: hz(`${dominant.root}2`), start: 0, duration: BAR, decay: 0, sustain: 1 });
  for (let i = 0; i < 16; i += 1) snare(layers.drums, (i * BAR) / 16, 0.15 + (0.4 * i) / 16);
  crash(layers.drums, 0, 0.15);
  // La mélodie monte sur l'accord de dominante pendant le roulement.
  dominant.notes.forEach((note, i) => {
    tone(layers.lead, { ...voice, gain: 0.22, freq: hz(note), start: (i + 1) * BEAT, duration: BEAT * 0.8 });
  });
  theme.A.map((spec) => chordOf(theme, spec)).forEach((chord, i) => {
    const start = BAR + i * BEAT;
    kick(layers.drums, start);
    snare(layers.drums, start, 0.35);
    tone(layers.bass, { ...BASS, freq: hz(`${chord.root}2`), start, duration: BEAT * 0.8 });
    for (const note of chord.notes) tone(layers.stabs, { ...STAB, gain: 0.16, freq: hz(note), start, duration: BEAT * 0.7 });
    tone(layers.lead, { ...voice, freq: hz(octaveUp(chord.notes[2])), start, duration: BEAT * 0.7 });
  });
  return render(layers, seconds, false);
}

// Générique 01 et thèmes de résultat au tempo d'origine (148 BPM), puis génériques 02 à 10.
const FILES = {
  'theme-01-intro.wav': intro(),
  'theme-01-loop.wav': matchLoop(),
  'result-victory.wav': victory(),
  'result-round-end.wav': roundEnd(),
};
for (const theme of THEMES) {
  FILES[`theme-${theme.file}-intro.wav`] = themeIntro(theme);
  FILES[`theme-${theme.file}-loop.wav`] = themeLoop(theme);
}
/** Source encadrée : une boucle reçoit sa fin devant et son début derrière, le reste du silence. */
function framed(samples, loop) {
  const out = new Float64Array(samples.length + 2 * PREROLL);
  out.set(samples, PREROLL);
  if (loop) {
    out.set(samples.subarray(samples.length - PREROLL), 0);
    out.set(samples.subarray(0, PREROLL), PREROLL + samples.length);
  }
  return out;
}

rmSync(SOURCE_DIR, { recursive: true, force: true });
mkdirSync(SOURCE_DIR, { recursive: true });
for (const [name, samples] of Object.entries(FILES)) {
  writeFileSync(join(SOURCE_DIR, name), toWav(framed(samples, name.endsWith('-loop.wav'))));
}

if (process.argv.includes('--wav-only')) {
  console.log(`Sources WAV écrites dans ${SOURCE_DIR} (encodage non lancé).`);
} else {
  if (process.platform !== 'win32') {
    throw new Error("L'encodage AAC utilise l'encodeur de Windows : lancer avec --wav-only ailleurs.");
  }
  mkdirSync(OUT_DIR, { recursive: true });
  // Les anciennes pistes (WAV ou .m4a retirés) ne doivent pas rester à côté des nouvelles.
  for (const file of readdirSync(OUT_DIR)) rmSync(join(OUT_DIR, file));
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(SCRIPTS_DIR, 'encode-music.ps1'), '-Source', SOURCE_DIR, '-Target', OUT_DIR],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  let total = 0;
  for (const [name, samples] of Object.entries(FILES)) {
    const m4a = name.replace(/\.wav$/, '.m4a');
    applyEditList(join(OUT_DIR, m4a), { preroll: PREROLL, frames: samples.length, sampleRate: SR });
    const size = readFileSync(join(OUT_DIR, m4a)).length;
    total += size;
    console.log(`${m4a} : ${(samples.length / SR).toFixed(2)} s, ${Math.round(size / 1024)} Ko`);
  }
  console.log(`Total : ${(total / 1024 / 1024).toFixed(2)} Mo`);
}
