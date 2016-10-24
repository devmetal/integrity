#!/usr/bin/env node

const glob = require('glob');
const { createReadStream, existsSync } = require('fs');
const { split, through, mapSync } = require('event-stream');
const { join, dirname } = require('path');
const { inspect } = require('util');
const search = process.argv[2];
const cwd = process.cwd();

const findFiles = pattern => new Promise((resolve, reject) => {
  glob(pattern, { ignore: '**/node_modules/**' }, (err, files) => {
    if (err) reject(err);
    resolve(files);
  });
});

const openStream = file => createReadStream(join(cwd, file));

const lineNo = () => {
  let no = 0;
  return mapSync((line) => {
    no++;
    return { line, no };
  });
};

const requireExp = /require\(([\'\"]\.{1,2}.*)\)/i;
const getRequire = () => {
  return mapSync((data) => {
    const line = data.line;
    const matches = line.match(requireExp);
    if (!matches) return;

    const requirePath = matches[1].replace(/[\'\"]/g, "");
    return Object.assign(data, { requirePath });
  });
}

const integrity = (base) => {
  const cache = [];
  return through(
    function write(data) {
      const { requirePath } = data;
      const modulePathAsJs = `${join(base, requirePath)}.js`;
      const modulePathAsFolder = `${join(base, requirePath, 'index.js')}`;

      const searchPathAsJs = join(cwd, modulePathAsJs);
      const searchPathAsFolder = join(cwd, modulePathAsFolder);

      const existsAsJs = existsSync(searchPathAsJs);
      const existsAsFolder = existsSync(searchPathAsFolder)
      const exists = existsAsJs || existsAsFolder;

      const integrity = {
        requirePath,
        modulePathAsJs,
        modulePathAsFolder,
        searchPathAsJs,
        searchPathAsFolder,
        existsAsJs,
        existsAsFolder,
        exists,
        no: data.no
      };

      if (!exists) {
        cache.push(integrity);
      }

      this.emit('data', integrity);
    },
    function end() {
      this.emit('result', cache);
      this.emit('end');
    }
  )
};

const checkfile = file => new Promise((resolve, reject) => {
  const base = dirname(file);
  openStream(file)
    .pipe(split())
    .pipe(lineNo())
    .pipe(getRequire())
    .pipe(integrity(base))
    .on('result', (integrities) => {
      resolve({ file, integrities });
    })
    .on('error', reject);
});

const checkFiles = files => Promise.all(files.map(checkfile));

; (function () {
  findFiles(search)
    .then(checkFiles)
    .then((results) => {
      let n = 0;
      for (const f of results) {
        if (f.integrities.length) {
          n++;
          console.log(f.file);
        }
        for (const i of f.integrities) {
          console.log(`\t${i.no} - ${i.requirePath}`);
          console.log(`\t\t${i.modulePathAsJs}`);
          console.log(`\t\t${i.modulePathAsFolder}`);
        }
      }
      console.log(`error found: ${n}`)
    })
} ());
