import PouchDB from 'pouchdb-core';
import PouchDBWebSQL from 'pouchdb-adapter-node-websql';

PouchDB.plugin(PouchDBWebSQL);

export class DBQueueManager<Content> {
  db: PouchDB.Database<Content>;
  revisions: Dictionary<string>;
  putQueues: Dictionary<Content[]>;

  constructor(path: string) {
    this.db = new PouchDB(path, {
      adapter: 'websql',
      revs_limit: 100
    });

    this.revisions = {};
    this.putQueues = {};
  }

  private handleChange(response: PouchDB.Core.Response) {
    const queue = this.putQueues[response.id];

    this.revisions[response.id] = response.rev;

    queue.shift();

    if (queue.length > 0) {
      const _rev = response.rev;
      const _id = response.id;

      console.log(`${_id} - ${_rev}`);

      this.db.put(Object.assign({}, queue[0], { _rev, _id })).then(response => {
        this.handleChange(response);
      });
    }
  }

  private handleDeletion(response: PouchDB.Core.Response) {
    delete this.putQueues[response.id];
    delete this.revisions[response.id];
  }

  /* @arg1 exists - Will return the response after adding
   *                all of the document ids appropriately.
   */

  async initialize(
    exists: (response: PouchDB.Core.AllDocsResponse<Content>) => void
  ) {
    return this.db.allDocs({ include_docs: true }).then(result => {
      for (let i = 0; i < result.total_rows; ++i) {
        const entry = result.rows[i].doc;

        this.addQueue(entry._id);
        this.revisions[entry._id] = entry._rev;
      }

      exists(result);
    });
  }

  addQueue(id: string) {
    if (this.putQueues[id]) {
      console.warn(`Attempt to add already existing queue: ${id}`);
      return;
    }

    this.putQueues[id] = [];
  }

  queueChange(id: string, change: Content) {
    const queue = this.putQueues[id];

    if (queue.push(change) !== 1) {
      return;
    }

    const _rev = this.revisions[id];
    const _id = id;
    const commit = Object.assign({}, change, { _rev, _id });

    console.log(`${id} - ${_rev}`);

    this.db.put(commit).then(response => {
      this.handleChange(response);
    });
  }

  queueDeletion(id: string) {
    const queue = this.putQueues[id];

    /* The array is dead, just empty it */
    queue.length = 0;

    console.log(`${id} - queued for deletion`);

    this.db.remove({ _id: id, _rev: this.revisions[id] }).then(response => {
      this.handleDeletion(response);
    });
  }
}
