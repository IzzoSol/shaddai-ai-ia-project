'use strict';
/**
 * JsonStore — generic atomic JSON file store with an in-process serialization
 * lock. Extracted from the pattern proven in economy-service.js's DevFileStore
 * so the referral / treasury / status-perk services can share ONE correct
 * implementation instead of copy-pasting money-adjacent write logic.
 *
 * Guarantees:
 *  - Atomic writes: serialize to `<file>.tmp`, fsync, then rename over the target.
 *    rename(2) is atomic on POSIX and same-volume on Windows, so a crash mid-write
 *    leaves either the old or new file intact — never a half-written file.
 *  - Serialized mutations: every withLock() runs in a single promise chain, so
 *    read-modify-write sequences never interleave and lose updates.
 *
 * This store holds NO money-cash-out logic; it is a persistence primitive only.
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} filePath absolute path to the JSON file
   * @param {object} emptyShape default object when the file is absent/empty
   */
  constructor(filePath, emptyShape) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('JsonStore requires a filePath');
    }
    this.filePath = filePath;
    this.tmpPath = filePath + '.tmp';
    this._emptyShape = emptyShape || {};
    this._lock = Promise.resolve();
    this._ensureFile();
  }

  _empty() {
    // Deep-ish clone so callers can't mutate the shared template.
    return JSON.parse(JSON.stringify(this._emptyShape));
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) this._writeAtomic(this._empty());
  }

  _read() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return this._empty();
      throw e;
    }
    if (!raw || raw.trim() === '') return this._empty();
    // BUGFIX (2026-09-12): a UTF-8 BOM (﻿) as the file's first character
    // makes JSON.parse throw ("Unexpected token") even though the rest of the
    // content is valid JSON -- fs.readFileSync(path,'utf8') does not strip it.
    // Found via data/referrals.json shipping with a BOM (likely written by a
    // Windows editor), which meant EVERY read through this store -- including
    // the very first referral-code lookup -- failed with a 500. Stripping a
    // leading BOM is always safe: it's never valid inside real JSON.
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    // Defensive: ensure every top-level key from the template exists.
    return Object.assign(this._empty(), parsed);
  }

  _writeAtomic(db) {
    const json = JSON.stringify(db, null, 2);
    const fd = fs.openSync(this.tmpPath, 'w');
    try {
      fs.writeFileSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(this.tmpPath, this.filePath);
  }

  /**
   * Run fn(db) under the serialization lock. fn may mutate db and return a value;
   * db is persisted atomically AFTER fn resolves. If fn throws, nothing is written.
   */
  withLock(fn) {
    const run = async () => {
      const db = this._read();
      const result = await fn(db);
      return { db, result };
    };
    const next = this._lock.then(run, run); // run even if a prior op rejected
    this._lock = next.then(() => undefined, () => undefined);
    return next.then(({ db, result }) => {
      this._writeAtomic(db);
      return result;
    });
  }

  /** Read-only snapshot under the lock (no write). */
  read() {
    return this._lock.then(() => this._read(), () => this._read());
  }
}

module.exports = { JsonStore };
