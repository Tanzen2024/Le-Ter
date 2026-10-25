// Ajoute à un fichier .m4a (une piste audio, `moov` placé après `mdat`, comme le produit
// l'encodeur AAC de Windows) une liste d'édition `edts/elst` : le lecteur ne joue que
// `frames` échantillons à partir de `preroll`. Android (Media3) et iOS (AVFoundation) s'en
// servent pour la lecture sans trou : le pré-roulement et le remplissage de fin de l'AAC ne
// s'entendent ni au début ni à chaque tour de boucle.
import { readFileSync, writeFileSync } from 'node:fs';

function boxes(buffer, start, end) {
  const list = [];
  for (let at = start; at < end; ) {
    const size = buffer.readUInt32BE(at);
    if (size < 8 || at + size > end) throw new Error(`boîte MP4 invalide à ${at}`);
    list.push({ type: buffer.toString('ascii', at + 4, at + 8), at, size });
    at += size;
  }
  return list;
}
function child(buffer, parent, type) {
  return boxes(buffer, parent.at + 8, parent.at + parent.size).find((b) => b.type === type);
}
/** Durée (version 0 : 32 bits, version 1 : 64 bits) d'un en-tête mvhd/tkhd/mdhd. */
function durationField(buffer, box, v0Offset, v1Offset) {
  return buffer[box.at + 8] === 1 ? box.at + v1Offset : box.at + v0Offset;
}

/**
 * @param path       fichier .m4a modifié sur place
 * @param preroll    échantillons à sauter au début (dans la fréquence `sampleRate`)
 * @param frames     échantillons à jouer
 * @param sampleRate fréquence de `preroll` et `frames`
 */
export function applyEditList(path, { preroll, frames, sampleRate }) {
  const buffer = readFileSync(path);
  const top = boxes(buffer, 0, buffer.length);
  const moov = top.find((b) => b.type === 'moov');
  const mdat = top.find((b) => b.type === 'mdat');
  // Insérer dans `moov` décalerait les données si `moov` précédait `mdat` (offsets stco).
  if (!moov || !mdat || moov.at < mdat.at || moov.at + moov.size !== buffer.length) {
    throw new Error(`${path} : structure inattendue (moov doit suivre mdat et finir le fichier)`);
  }
  const traks = boxes(buffer, moov.at + 8, moov.at + moov.size).filter((b) => b.type === 'trak');
  if (traks.length !== 1) throw new Error(`${path} : une seule piste attendue`);
  const [trak] = traks;
  if (child(buffer, trak, 'edts')) throw new Error(`${path} : liste d'édition déjà présente`);
  const mvhd = child(buffer, moov, 'mvhd');
  const tkhd = child(buffer, trak, 'tkhd');
  const mdhd = child(buffer, child(buffer, trak, 'mdia'), 'mdhd');
  const movieScale = buffer.readUInt32BE(buffer[mvhd.at + 8] === 1 ? mvhd.at + 28 : mvhd.at + 20);
  const mediaScale = buffer.readUInt32BE(buffer[mdhd.at + 8] === 1 ? mdhd.at + 28 : mdhd.at + 20);
  const mediaDuration = Number(
    buffer[mdhd.at + 8] === 1 ? buffer.readBigUInt64BE(mdhd.at + 32) : buffer.readUInt32BE(mdhd.at + 24),
  );
  const mediaTime = Math.round((preroll * mediaScale) / sampleRate);
  const playedMedia = Math.round((frames * mediaScale) / sampleRate);
  if (mediaTime + playedMedia > mediaDuration) {
    throw new Error(`${path} : l'édition dépasse la piste (${mediaTime + playedMedia} > ${mediaDuration})`);
  }
  const segment = Math.round((frames * movieScale) / sampleRate);

  const elst = Buffer.alloc(28);
  elst.writeUInt32BE(28, 0);
  elst.write('elst', 4);
  // version 0, drapeaux 0, une entrée : durée (échelle du film), début (échelle du média), vitesse 1.
  elst.writeUInt32BE(1, 12);
  elst.writeUInt32BE(segment, 16);
  elst.writeInt32BE(mediaTime, 20);
  elst.writeUInt32BE(0x00010000, 24);
  const edts = Buffer.concat([Buffer.from([0, 0, 0, 36]), Buffer.from('edts'), elst]);

  // Durées du film et de la piste : celles de l'édition.
  const setDuration = (box, v0, v1) => {
    const at = durationField(buffer, box, v0, v1);
    if (buffer[box.at + 8] === 1) buffer.writeBigUInt64BE(BigInt(segment), at);
    else buffer.writeUInt32BE(segment, at);
  };
  setDuration(mvhd, 24, 32);
  setDuration(tkhd, 28, 36);
  buffer.writeUInt32BE(moov.size + edts.length, moov.at);
  buffer.writeUInt32BE(trak.size + edts.length, trak.at);
  // `edts` se place juste après `tkhd`.
  const insertAt = tkhd.at + tkhd.size;
  writeFileSync(path, Buffer.concat([buffer.subarray(0, insertAt), edts, buffer.subarray(insertAt)]));
  return { mediaTime, playedMedia, mediaDuration, mediaScale };
}
