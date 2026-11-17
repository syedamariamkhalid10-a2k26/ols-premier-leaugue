'use strict';
/**
 * Photograph handling. Every upload is decoded and re-encoded with sharp, which:
 *  - rejects anything that is not a real image,
 *  - removes EXIF metadata (including GPS location) for student privacy,
 *  - compresses photos for fast loading on slow connections.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const cfg = require('../config');
const { bad } = require('../util');

const PLAYER_DIR = () => path.join(cfg.UPLOAD_DIR, 'players');
const CLUB_DIR = () => path.join(cfg.UPLOAD_DIR, 'clubs');
const KEY_RE = /^[a-f0-9]{24}$/;

sharp.cache(false);
sharp.concurrency(1);

async function savePlayerPhoto(buffer) {
  if (!buffer || !buffer.length) throw bad('Please choose a photograph.');
  fs.mkdirSync(PLAYER_DIR(), { recursive: true });
  const key = crypto.randomBytes(12).toString('hex');
  let img;
  try {
    img = sharp(buffer, { limitInputPixels: 60e6, failOn: 'error' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error('no size');
  } catch {
    throw bad('That file is not a supported photograph. Please upload a JPG, PNG, WebP or HEIC image.');
  }
  // Portrait 4:5 crop, focused on the most interesting part of the picture (usually the face).
  await img.clone().resize(600, 750, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 78 }).toFile(path.join(PLAYER_DIR(), `${key}.webp`));
  await img.clone().resize(200, 250, { fit: 'cover', position: sharp.strategy.attention })
    .webp({ quality: 72 }).toFile(path.join(PLAYER_DIR(), `${key}_t.webp`));
  return key;
}

function removePlayerPhoto(key) {
  if (!key || !KEY_RE.test(key)) return;
  for (const f of [`${key}.webp`, `${key}_t.webp`]) fs.rm(path.join(PLAYER_DIR(), f), { force: true }, () => {});
}

function playerPhotoPath(key, thumb) {
  if (!KEY_RE.test(key || '')) return null;
  return path.join(PLAYER_DIR(), `${key}${thumb ? '_t' : ''}.webp`);
}

async function saveClubLogo(buffer) {
  fs.mkdirSync(CLUB_DIR(), { recursive: true });
  const key = crypto.randomBytes(12).toString('hex');
  try {
    await sharp(buffer, { limitInputPixels: 60e6, density: 300 })
      .resize(480, 480, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(path.join(CLUB_DIR(), `${key}.png`));
  } catch {
    throw bad('That file is not a supported image. Please upload a PNG, SVG, JPG or WebP logo.');
  }
  return key;
}
function clubLogoPath(key) {
  if (!KEY_RE.test(key || '')) return null;
  return path.join(CLUB_DIR(), `${key}.png`);
}

module.exports = { savePlayerPhoto, removePlayerPhoto, playerPhotoPath, saveClubLogo, clubLogoPath, KEY_RE };
