const Instance = require('./instance');
const sha = require('sha');
const { readFile } = require('fs');
const { ExplicitPromise } = require('../../reused/promise');

module.exports = Instance(({ all, Blob, simply }) => class {
  create() {
    return simply.transacting.getOneWhere('blobs', { sha: this.sha }, Blob)
      .then((extant) => extant.orElse(simply.create('blobs', this)));
  }

  static fromFile(path, contentType) {
    return all.do([
      ExplicitPromise.fromCallback((cb) => sha.get(path, cb)),
      ExplicitPromise.fromCallback((cb) => readFile(path, cb))
    ]).then(([ sha, buffer ]) => new Blob({ sha, contentType, content: buffer }));
  }
});
