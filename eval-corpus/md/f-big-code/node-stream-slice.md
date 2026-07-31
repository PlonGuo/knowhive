# Stream

<!--introduced_in=v0.10.0-->

> Stability: 2 - Stable

<!-- source_link=lib/stream.js -->

A stream is an abstract interface for working with streaming data in Node.js.
The `node:stream` module provides an API for implementing the stream interface.

There are many stream objects provided by Node.js. For instance, a
[request to an HTTP server][http-incoming-message] and [`process.stdout`][]
are both stream instances.

Streams can be readable, writable, or both. All streams are instances of
[`EventEmitter`][].

To access the `node:stream` module:

```js
const stream = require('node:stream');
```

The `node:stream` module is useful for creating new types of stream instances.
It is usually not necessary to use the `node:stream` module to consume streams.

## Organization of this document

This document contains two primary sections and a third section for notes. The
first section explains how to use existing streams within an application. The
second section explains how to create new types of streams.

## Types of streams

There are four fundamental stream types within Node.js:

* [`Writable`][]: streams to which data can be written (for example,
  [`fs.createWriteStream()`][]).
* [`Readable`][]: streams from which data can be read (for example,
  [`fs.createReadStream()`][]).
* [`Duplex`][]: streams that are both `Readable` and `Writable` (for example,
  [`net.Socket`][]).
* [`Transform`][]: `Duplex` streams that can modify or transform the data as it
  is written and read (for example, [`zlib.createDeflate()`][]).

Additionally, this module includes the utility functions
[`stream.duplexPair()`][],
[`stream.pipeline()`][],
[`stream.finished()`][]
[`stream.Readable.from()`][], and
[`stream.addAbortSignal()`][].

### Streams Promises API

<!-- YAML
added: v15.0.0
-->

The `stream/promises` API provides an alternative set of asynchronous utility
functions for streams that return `Promise` objects rather than using
callbacks. The API is accessible via `require('node:stream/promises')`
or `require('node:stream').promises`.

### `stream.pipeline(streams[, options])`

### `stream.pipeline(source[, ...transforms], destination[, options])`

<!-- YAML
added: v15.0.0
changes:
  - version:
      - v19.7.0
      - v18.16.0
    pr-url: https://github.com/nodejs/node/pull/46307
    description: Added support for webstreams.
  - version:
      - v18.0.0
      - v17.2.0
      - v16.14.0
    pr-url: https://github.com/nodejs/node/pull/40886
    description: Add the `end` option, which can be set to `false` to prevent
                 automatically closing the destination stream when the source
                 ends.
-->

* `streams` {Stream\[]|Iterable\[]|AsyncIterable\[]|Function\[]|
  ReadableStream\[]|WritableStream\[]|TransformStream\[]}
* `source` {Stream|Iterable|AsyncIterable|Function|ReadableStream}
  * Returns: {Promise|AsyncIterable}
* `...transforms` {Stream|Function|TransformStream}
  * `source` {AsyncIterable}
  * Returns: {Promise|AsyncIterable}
* `destination` {Stream|Function|WritableStream}
  * `source` {AsyncIterable}
  * Returns: {Promise|AsyncIterable}
* `options` {Object} Pipeline options
  * `signal` {AbortSignal}
  * `end` {boolean} End the destination stream when the source stream ends.
    Transform streams are always ended, even if this value is `false`.
    **Default:** `true`.
* Returns: {Promise} Fulfills when the pipeline is complete.

```cjs
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');
const zlib = require('node:zlib');

async function run() {
  await pipeline(
    fs.createReadStream('archive.tar'),
    zlib.createGzip(),
    fs.createWriteStream('archive.tar.gz'),
  );
  console.log('Pipeline succeeded.');
}

run().catch(console.error);
```

```mjs
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

await pipeline(
  createReadStream('archive.tar'),
  createGzip(),
  createWriteStream('archive.tar.gz'),
);
console.log('Pipeline succeeded.');
```

To use an `AbortSignal`, pass it inside an options object, as the last argument.
When the signal is aborted, `destroy` will be called on the underlying pipeline,
with an `AbortError`.

```cjs
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');
const zlib = require('node:zlib');

async function run() {
  const ac = new AbortController();
  const signal = ac.signal;

  setImmediate(() => ac.abort());
  await pipeline(
    fs.createReadStream('archive.tar'),
    zlib.createGzip(),
    fs.createWriteStream('archive.tar.gz'),
    { signal },
  );
}

run().catch(console.error); // AbortError
```

```mjs
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

const ac = new AbortController();
const { signal } = ac;
setImmediate(() => ac.abort());
try {
  await pipeline(
    createReadStream('archive.tar'),
    createGzip(),
    createWriteStream('archive.tar.gz'),
    { signal },
  );
} catch (err) {
  console.error(err); // AbortError
}
```

The `pipeline` API also supports async generators:

```cjs
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');

async function run() {
  await pipeline(
    fs.createReadStream('lowercase.txt'),
    async function* (source, { signal }) {
      source.setEncoding('utf8');  // Work with strings rather than `Buffer`s.
      for await (const chunk of source) {
        yield await processChunk(chunk, { signal });
      }
    },
    fs.createWriteStream('uppercase.txt'),
  );
  console.log('Pipeline succeeded.');
}

run().catch(console.error);
```

```mjs
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';

await pipeline(
  createReadStream('lowercase.txt'),
  async function* (source, { signal }) {
    source.setEncoding('utf8');  // Work with strings rather than `Buffer`s.
    for await (const chunk of source) {
      yield await processChunk(chunk, { signal });
    }
  },
  createWriteStream('uppercase.txt'),
);
console.log('Pipeline succeeded.');
```

Remember to handle the `signal` argument passed into the async generator.
Especially in the case where the async generator is the source for the
pipeline (i.e. first argument) or the pipeline will never complete.

```cjs
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');

async function run() {
  await pipeline(
    async function* ({ signal }) {
      await someLongRunningfn({ signal });
      yield 'asd';
    },
    fs.createWriteStream('uppercase.txt'),
  );
  console.log('Pipeline succeeded.');
}

run().catch(console.error);
```

```mjs
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
await pipeline(
  async function* ({ signal }) {
    await someLongRunningfn({ signal });
    yield 'asd';
  },
  fs.createWriteStream('uppercase.txt'),
);
console.log('Pipeline succeeded.');
```

The `pipeline` API provides [callback version][stream-pipeline]:

### `stream.finished(stream[, options])`

<!-- YAML
added: v15.0.0
changes:
  - version:
    - v19.5.0
    - v18.14.0
    pr-url: https://github.com/nodejs/node/pull/46205
    description: Added support for `ReadableStream` and `WritableStream`.
  - version:
    - v19.1.0
    - v18.13.0
    pr-url: https://github.com/nodejs/node/pull/44862
    description: The `cleanup` option was added.
-->

* `stream` {Stream|ReadableStream|WritableStream} A readable and/or writable
  stream/webstream.
* `options` {Object}
  * `error` {boolean|undefined}
  * `readable` {boolean|undefined}
  * `writable` {boolean|undefined}
  * `signal` {AbortSignal|undefined}
  * `cleanup` {boolean|undefined} If `true`, removes the listeners registered by
    this function before the promise is fulfilled. **Default:** `false`.
* Returns: {Promise} Fulfills when the stream is no
  longer readable or writable.

```cjs
const { finished } = require('node:stream/promises');
const fs = require('node:fs');

const rs = fs.createReadStream('archive.tar');

async function run() {
  await finished(rs);
  console.log('Stream is done reading.');
}

run().catch(console.error);
rs.resume(); // Drain the stream.
```

```mjs
import { finished } from 'node:stream/promises';
import { createReadStream } from 'node:fs';

const rs = createReadStream('archive.tar');

async function run() {
  await finished(rs);
  console.log('Stream is done reading.');
}

run().catch(console.error);
rs.resume(); // Drain the stream.
```

The `finished` API also provides a [callback version][stream-finished].

`stream.finished()` leaves dangling event listeners (in particular
`'error'`, `'end'`, `'finish'` and `'close'`) after the returned promise is
resolved or rejected. The reason for this is so that unexpected `'error'`
events (due to incorrect stream implementations) do not cause unexpected
crashes. If this is unwanted behavior then `options.cleanup` should be set to
`true`:

```mjs
await finished(rs, { cleanup: true });
```

### Object mode

All streams created by Node.js APIs operate exclusively on strings, {Buffer},
{TypedArray} and {DataView} objects:

* `Strings` and `Buffers` are the most common types used with streams.
* `TypedArray` and `DataView` lets you handle binary data with types like
  `Int32Array` or `Uint8Array`. When you write a TypedArray or DataView to a
  stream, Node.js processes
  the raw bytes.

It is possible, however, for stream
implementations to work with other types of JavaScript values (with the
exception of `null`, which serves a special purpose within streams).
Such streams are considered to operate in "object mode".

Stream instances are switched into object mode using the `objectMode` option
when the stream is created. Attempting to switch an existing stream into
object mode is not safe.

### Buffering

<!--type=misc-->

Both [`Writable`][] and [`Readable`][] streams will store data in an internal
buffer.

The amount of data potentially buffered depends on the `highWaterMark` option
passed into the stream's constructor. For normal streams, the `highWaterMark`
option specifies a [total number of bytes][hwm-gotcha]. For streams operating
in object mode, the `highWaterMark` specifies a total number of objects. For
streams operating on (but not decoding) strings, the `highWaterMark` specifies
a total number of UTF-16 code units.

Data is buffered in `Readable` streams when the implementation calls
[`stream.push(chunk)`][stream-push]. If the consumer of the Stream does not
call [`stream.read()`][stream-read], the data will sit in the internal
queue until it is consumed.

Once the total size of the internal read buffer reaches the threshold specified
by `highWaterMark`, the stream will temporarily stop reading data from the
underlying resource until the data currently buffered can be consumed (that is,
the stream will stop calling the internal [`readable._read()`][] method that is
used to fill the read buffer).

Data is buffered in `Writable` streams when the
[`writable.write(chunk)`][stream-write] method is called repeatedly. While the
total size of the internal write buffer is below the threshold set by
`highWaterMark`, calls to `writable.write()` will return `true`. Once
the size of the internal buffer reaches or exceeds the `highWaterMark`, `false`
will be returned.

A key goal of the `stream` API, particularly the [`stream.pipe()`][] method,
is to limit the buffering of data to acceptable levels such that sources and
destinations of differing speeds will not overwhelm the available memory.

The `highWaterMark` option is a threshold, not a limit: it dictates the amount
of data that a stream buffers before it stops asking for more data. It does not
enforce a strict memory limitation in general. Specific stream implementations
may choose to enforce stricter limits but doing so is optional.

Because [`Duplex`][] and [`Transform`][] streams are both `Readable` and
`Writable`, each maintains _two_ separate internal buffers used for reading and
writing, allowing each side to operate independently of the other while
maintaining an appropriate and efficient flow of data. For example,
[`net.Socket`][] instances are [`Duplex`][] streams whose `Readable` side allows
consumption of data received _from_ the socket and whose `Writable` side allows
writing data _to_ the socket. Because data may be written to the socket at a
faster or slower rate than data is received, each side should
operate (and buffer) independently of the other.

The mechanics of the internal buffering are an internal implementation detail
and may be changed at any time. However, for certain advanced implementations,
the internal buffers can be retrieved using `writable.writableBuffer` or
`readable.readableBuffer`. Use of these undocumented properties is discouraged.

## API for stream consumers

<!--type=misc-->

Almost all Node.js applications, no matter how simple, use streams in some
manner. The following is an example of using streams in a Node.js application
that implements an HTTP server:

```js
const http = require('node:http');

const server = http.createServer((req, res) => {
  // `req` is an http.IncomingMessage, which is a readable stream.
  // `res` is an http.ServerResponse, which is a writable stream.

  let body = '';
  // Get the data as utf8 strings.
  // If an encoding is not set, Buffer objects will be received.
  req.setEncoding('utf8');

  // Readable streams emit 'data' events once a listener is added.
  req.on('data', (chunk) => {
    body += chunk;
  });

  // The 'end' event indicates that the entire body has been received.
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      // Write back something interesting to the user:
      res.write(typeof data);
      res.end();
    } catch (er) {
      // uh oh! bad json!
      res.statusCode = 400;
      return res.end(`error: ${er.message}`);
    }
  });
});

server.listen(1337);

// $ curl localhost:1337 -d "{}"
// object
// $ curl localhost:1337 -d "\"foo\""
// string
// $ curl localhost:1337 -d "not json"
// error: Unexpected token 'o', "not json" is not valid JSON
```

[`Writable`][] streams (such as `res` in the example) expose methods such as
`write()` and `end()` that are used to write data onto the stream.

[`Readable`][] streams use the [`EventEmitter`][] API for notifying application
code when data is available to be read off the stream. That available data can
be read from the stream in multiple ways.

Both [`Writable`][] and [`Readable`][] streams use the [`EventEmitter`][] API in
various ways to communicate the current state of the stream.

[`Duplex`][] and [`Transform`][] streams are both [`Writable`][] and
[`Readable`][].

Applications that are either writing data to or consuming data from a stream
are not required to implement the stream interfaces directly and will generally
have no reason to call `require('node:stream')`.

Developers wishing to implement new types of streams should refer to the
section [API for stream implementers][].

### Writable streams

Writable streams are an abstraction for a _destination_ to which data is
written.

Examples of [`Writable`][] streams include:

* [HTTP requests, on the client][]
* [HTTP responses, on the server][]
* [fs write streams][]
* [zlib streams][zlib]
* [crypto streams][crypto]
* [TCP sockets][]
* [child process stdin][]
* [`process.stdout`][], [`process.stderr`][]

Some of these examples are actually [`Duplex`][] streams that implement the
[`Writable`][] interface.

All [`Writable`][] streams implement the interface defined by the
`stream.Writable` class.

While specific instances of [`Writable`][] streams may differ in various ways,
all `Writable` streams follow the same fundamental usage pattern as illustrated
in the example below:

```js
const myStream = getWritableStreamSomehow();
myStream.write('some data');
myStream.write('some more data');
myStream.end('done writing data');
```

#### Class: `stream.Writable`

<!-- YAML
added: v0.9.4
-->

<!--type=class-->

##### Event: `'close'`

<!-- YAML
added: v0.9.4
changes:
  - version: v10.0.0
    pr-url: https://github.com/nodejs/node/pull/18438
    description: Add `emitClose` option to specify if `'close'` is emitted on
                 destroy.
-->

The `'close'` event is emitted when the stream and any of its underlying
resources (a file descriptor, for example) have been closed. The event indicates
that no more events will be emitted, and no further computation will occur.

A [`Writable`][] stream will always emit the `'close'` event if it is
created with the `emitClose` option.

##### Event: `'drain'`

<!-- YAML
added: v0.9.4
-->

If a call to [`stream.write(chunk)`][stream-write] returns `false`, the
`'drain'` event will be emitted when it is appropriate to resume writing data
to the stream.

```js
// Write the data to the supplied writable stream one million times.
// Be attentive to back-pressure.
function writeOneMillionTimes(writer, data, encoding, callback) {
  let i = 1000000;
  write();
  function write() {
    let ok = true;
    do {
      i--;
      if (i === 0) {
        // Last time!
        writer.write(data, encoding, callback);
      } else {
        // See if we should continue, or wait.
        // Don't pass the callback, because we're not done yet.
        ok = writer.write(data, encoding);
      }
    } while (i > 0 && ok);
    if (i > 0) {
      // Had to stop early!
      // Write some more once it drains.
      writer.once('drain', write);
    }
  }
}
```

##### Event: `'error'`

<!-- YAML
added: v0.9.4
-->

* Type: {Error}

The `'error'` event is emitted if an error occurred while writing or piping
data. The listener callback is passed a single `Error` argument when called.

The stream is closed when the `'error'` event is emitted unless the
[`autoDestroy`][writable-new] option was set to `false` when creating the
stream.

After `'error'`, no further events other than `'close'` _should_ be emitted
(including `'error'` events).

##### Event: `'finish'`

<!-- YAML
added: v0.9.4
-->

The `'finish'` event is emitted after the [`stream.end()`][stream-end] method
has been called, and all data has been flushed to the underlying system.

```js
const writer = getWritableStreamSomehow();
for (let i = 0; i < 100; i++) {
  writer.write(`hello, #${i}!\n`);
}
writer.on('finish', () => {
  console.log('All writes are now complete.');
});
writer.end('This is the end\n');
```

##### Event: `'pipe'`

<!-- YAML
added: v0.9.4
-->

* `src` {stream.Readable} source stream that is piping to this writable

The `'pipe'` event is emitted when the [`stream.pipe()`][] method is called on
a readable stream, adding this writable to its set of destinations.

```js
const writer = getWritableStreamSomehow();
const reader = getReadableStreamSomehow();
writer.on('pipe', (src) => {
  console.log('Something is piping into the writer.');
  assert.equal(src, reader);
});
reader.pipe(writer);
```

##### Event: `'unpipe'`

<!-- YAML
added: v0.9.4
-->

* `src` {stream.Readable} The source stream that
  [unpiped][`stream.unpipe()`] this writable

The `'unpipe'` event is emitted when the [`stream.unpipe()`][] method is called
on a [`Readable`][] stream, removing this [`Writable`][] from its set of
destinations.

This is also emitted in case this [`Writable`][] stream emits an error when a
[`Readable`][] stream pipes into it.

```js
const writer = getWritableStreamSomehow();
const reader = getReadableStreamSomehow();
writer.on('unpipe', (src) => {
  console.log('Something has stopped piping into the writer.');
  assert.equal(src, reader);
});
reader.pipe(writer);
reader.unpipe(writer);
```

##### `writable.cork()`

<!-- YAML
added: v0.11.2
-->

The `writable.cork()` method forces all written data to be buffered in memory.
The buffered data will be flushed when either the [`stream.uncork()`][] or
[`stream.end()`][stream-end] methods are called.

The primary intent of `writable.cork()` is to accommodate a situation in which
several small chunks are written to the stream in rapid succession. Instead of
immediately forwarding them to the underlying destination, `writable.cork()`
buffers all the chunks until `writable.uncork()` is called, which will pass them
all to `writable._writev()`, if present. This prevents a head-of-line blocking
situation where data is being buffered while waiting for the first small chunk
to be processed. However, use of `writable.cork()` without implementing
`writable._writev()` may have an adverse effect on throughput.

See also: [`writable.uncork()`][], [`writable._writev()`][stream-_writev].

##### `writable.destroy([error])`

<!-- YAML
added: v8.0.0
changes:
  - version: v14.0.0
    pr-url: https://github.com/nodejs/node/pull/29197
    description: Work as a no-op on a stream that has already been destroyed.
-->

* `error` {Error} Optional, an error to emit with `'error'` event.
* Returns: {this}

Destroy the stream. Optionally emit an `'error'` event, and emit a `'close'`
event (unless `emitClose` is set to `false`). After this call, the writable
stream has ended and subsequent calls to `write()` or `end()` will result in
an `ERR_STREAM_DESTROYED` error.
This is a destructive and immediate way to destroy a stream. Previous calls to
`write()` may not have drained, and may trigger an `ERR_STREAM_DESTROYED` error.
Use `end()` instead of destroy if data should flush before close, or wait for
the `'drain'` event before destroying the stream.

```cjs
const { Writable } = require('node:stream');

const myStream = new Writable();

const fooErr = new Error('foo error');
myStream.destroy(fooErr);
myStream.on('error', (fooErr) => console.error(fooErr.message)); // foo error
```

```cjs
const { Writable } = require('node:stream');

const myStream = new Writable();

myStream.destroy();
myStream.on('error', function wontHappen() {});
```

```cjs
const { Writable } = require('node:stream');

const myStream = new Writable();
myStream.destroy();

myStream.write('foo', (error) => console.error(error.code));
// ERR_STREAM_DESTROYED
```

Once `destroy()` has been called any further calls will be a no-op and no
further errors except from `_destroy()` may be emitted as `'error'`.

Implementors should not override this method,
but instead implement [`writable._destroy()`][writable-_destroy].

##### `writable.closed`

<!-- YAML
added: v18.0.0
-->

* Type: {boolean}

Is `true` after `'close'` has been emitted.

##### `writable.destroyed`

<!-- YAML
added: v8.0.0
-->

* Type: {boolean}

Is `true` after [`writable.destroy()`][writable-destroy] has been called.

```cjs
const { Writable } = require('node:stream');

const myStream = new Writable();

console.log(myStream.destroyed); // false
myStream.destroy();
console.log(myStream.destroyed); // true
```

##### `writable.end([chunk[, encoding]][, callback])`

<!-- YAML
added: v0.9.4
changes:
  - version:
    - v22.0.0
    - v20.13.0
    pr-url: https://github.com/nodejs/node/pull/51866
    description: The `chunk` argument can now be a `TypedArray` or `DataView` instance.
  - version: v15.0.0
    pr-url: https://github.com/nodejs/node/pull/34101
    description: The `callback` is invoked before 'finish' or on error.
  - version: v14.0.0
    pr-url: https://github.com/nodejs/node/pull/29747
    description: The `callback` is invoked if 'finish' or 'error' is emitted.
  - version: v10.0.0
    pr-url: https://github.com/nodejs/node/pull/18780
    description: This method now returns a reference to `writable`.
  - version: v8.0.0
    pr-url: https://github.com/nodejs/node/pull/11608
    description: The `chunk` argument can now be a `Uint8Array` instance.
-->

* `chunk` {string|Buffer|TypedArray|DataView|any} Optional data to write. For
  streams not operating in object mode, `chunk` must be a {string}, {Buffer},
  {TypedArray} or {DataView}. For object mode streams, `chunk` may be any
  JavaScript value other than `null`.
* `encoding` {string} The encoding if `chunk` is a string
* `callback` {Function} Callback for when the stream is finished.
* Returns: {this}

Calling the `writable.end()` method signals that no more data will be written
to the [`Writable`][]. The optional `chunk` and `encoding` arguments allow one
final additional chunk of data to be written immediately before closing the
stream.

Calling the [`stream.write()`][stream-write] method after calling
[`stream.end()`][stream-end] will raise an error.

```js
// Write 'hello, ' and then end with 'world!'.
const fs = require('node:fs');
const file = fs.createWriteStream('example.txt');
file.write('hello, ');
file.end('world!');
// Writing more now is not allowed!
```

##### `writable.setDefaultEncoding(encoding)`

<!-- YAML
added: v0.11.15
changes:
  - version: v6.1.0
    pr-url: https://github.com/nodejs/node/pull/5040
    description: This method now returns a reference to `writable`.
-->

* `encoding` {string} The new default encoding
* Returns: {this}

The `writable.setDefaultEncoding()` method sets the default `encoding` for a
[`Writable`][] stream.

##### `writable.uncork()`

<!-- YAML
added: v0.11.2
-->

The `writable.uncork()` method flushes all data buffered since
[`stream.cork()`][] was called.

When using [`writable.cork()`][] and `writable.uncork()` to manage the buffering
of writes to a stream, defer calls to `writable.uncork()` using
`process.nextTick()`. Doing so allows batching of all
`writable.write()` calls that occur within a given Node.js event loop phase.

```js
stream.cork();
stream.write('some ');
stream.write('data ');
process.nextTick(() => stream.uncork());
```

If the [`writable.cork()`][] method is called multiple times on a stream, the
same number of calls to `writable.uncork()` must be called to flush the buffered
data.

```js
stream.cork();
stream.write('some ');
stream.cork();
stream.write('data ');
process.nextTick(() => {
  stream.uncork();
  // The data will not be flushed until uncork() is called a second time.
  stream.uncork();
});
```

See also: [`writable.cork()`][].

##### `writable.writable`

<!-- YAML
added: v11.4.0
-->

* Type: {boolean}

Is `true` if it is safe to call [`writable.write()`][stream-write], which means
the stream has not been destroyed, errored, or ended.

##### `writable.writableAborted`

<!-- YAML
added:
  - v18.0.0
  - v16.17.0
changes:
 - version:
    - v24.0.0
    - v22.17.0
   pr-url: https://github.com/nodejs/node/pull/57513
   description: Marking the API stable.
-->

* Type: {boolean}

Returns whether the stream was destroyed or errored before emitting `'finish'`.

##### `writable.writableEnded`

<!-- YAML
added: v12.9.0
-->

* Type: {boolean}

Is `true` after [`writable.end()`][] has been called. This property
does not indicate whether the data has been flushed, for this use
[`writable.writableFinished`][] instead.

##### `writable.writableCorked`

<!-- YAML
added:
 - v13.2.0
 - v12.16.0
-->

* Type: {integer}

Number of times [`writable.uncork()`][stream-uncork] needs to be
called in order to fully uncork the stream.

##### `writable.errored`

<!-- YAML
added:
  v18.0.0
-->

* Type: {Error}

Returns error if the stream has been destroyed with an error.

##### `writable.writableFinished`

<!-- YAML
added: v12.6.0
-->

* Type: {boolean}

Is set to `true` immediately before the [`'finish'`][] event is emitted.

##### `writable.writableHighWaterMark`

<!-- YAML
added: v9.3.0
-->

* Type: {number}

Return the value of `highWaterMark` passed when creating this `Writable`.

##### `writable.writableLength`

<!-- YAML
added: v9.4.0
-->

* Type: {number}

This property contains the number of bytes (or objects) in the queue
ready to be written. The value provides introspection data regarding
the status of the `highWaterMark`.

##### `writable.writableNeedDrain`

<!-- YAML
added:
  - v15.2.0
  - v14.17.0
-->

* Type: {boolean}

Is `true` if the stream's buffer has been full and stream will emit `'drain'`.

##### `writable.writableObjectMode`

<!-- YAML
added: v12.3.0
-->

* Type: {boolean}

Getter for the property `objectMode` of a given `Writable` stream.

##### `writable[Symbol.asyncDispose]()`

<!-- YAML
added:
- v22.4.0
- v20.16.0
changes:
 - version: v24.2.0
   pr-url: https://github.com/nodejs/node/pull/58467
   description: No longer experimental.
-->

Calls [`writable.destroy()`][writable-destroy] with an `AbortError` and returns
a promise that fulfills when the stream is finished.

##### `writable.write(chunk[, encoding][, callback])`

<!-- YAML
added: v0.9.4
changes:
  - version:
    - v22.0.0
    - v20.13.0
    pr-url: https://github.com/nodejs/node/pull/51866
    description: The `chunk` argument can now be a `TypedArray` or `DataView` instance.
  - version: v8.0.0
    pr-url: https://github.com/nodejs/node/pull/11608
    description: The `chunk` argument can now be a `Uint8Array` instance.
  - version: v6.0.0
    pr-url: https://github.com/nodejs/node/pull/6170
    description: Passing `null` as the `chunk` parameter will always be
                 considered invalid now, even in object mode.
-->

* `chunk` {string|Buffer|TypedArray|DataView|any} Optional data to write. For
  streams not operating in object mode, `chunk` must be a {string}, {Buffer},
  {TypedArray} or {DataView}. For object mode streams, `chunk` may be any
  JavaScript value other than `null`.
* `encoding` {string|null} The encoding, if `chunk` is a string. **Default:** `'utf8'`
* `callback` {Function} Callback for when this chunk of data is flushed.
* Returns: {boolean} `false` if the stream wishes for the calling code to
  wait for the `'drain'` event to be emitted before continuing to write
  additional data; otherwise `true`.

The `writable.write()` method writes some data to the stream, and calls the
supplied `callback` once the data has been fully handled. If an error
occurs, the `callback` will be called with the error as its
first argument. The `callback` is called asynchronously and before `'error'` is
emitted.

The return value is `true` if the internal buffer is less than the
`highWaterMark` configured when the stream was created after admitting `chunk`.
If `false` is returned, further attempts to write data to the stream should
stop until the [`'drain'`][] event is emitted.

While a stream is not draining, calls to `write()` will buffer `chunk`, and
return false. Once all currently buffered chunks are drained (accepted for
delivery by the operating system), the `'drain'` event will be emitted.
Once `write()` returns false, do not write more chunks
until the `'drain'` event is emitted. While calling `write()` on a stream that
is not draining is allowed, Node.js will buffer all written chunks until
maximum memory usage occurs, at which point it will abort unconditionally.
Even before it aborts, high memory usage will cause poor garbage collector
performance and high RSS (which is not typically released back to the system,
even after the memory is no longer required). Since TCP sockets may never
drain if the remote peer does not read the data, writing a socket that is
not draining may lead to a remotely exploitable vulnerability.

Writing data while the stream is not draining is particularly
problematic for a [`Transform`][], because the `Transform` streams are paused
by default until they are piped or a `'data'` or `'readable'` event handler
is added.

If the data to be written can be generated or fetched on demand, it is
recommended to encapsulate the logic into a [`Readable`][] and use
[`stream.pipe()`][]. However, if calling `write()` is preferred, it is
possible to respect backpressure and avoid memory issues using the
[`'drain'`][] event:

```js
function write(data, cb) {
  if (!stream.write(data)) {
    stream.once('drain', cb);
  } else {
    process.nextTick(cb);
  }
}

// Wait for cb to be called before doing any other write.
write('hello', () => {
  console.log('Write completed, do more writes now.');
});
```

A `Writable` stream in object mode will always ignore the `encoding` argument.

### Readable streams

Readable streams are an abstraction for a _source_ from which data is
consumed.

Examples of `Readable` streams include:

* [HTTP responses, on the client][http-incoming-message]
* [HTTP requests, on the server][http-incoming-message]
* [fs read streams][]
* [zlib streams][zlib]
* [crypto streams][crypto]
* [TCP sockets][]
* [child process stdout and stderr][]
* [`process.stdin`][]

All [`Readable`][] streams implement the interface defined by the
`stream.Readable` class.

#### Two reading modes

`Readable` streams effectively operate in one of two modes: flowing and
paused. These modes are separate from [object mode][object-mode].
A [`Readable`][] stream can be in object mode or not, regardless of whether
it is in flowing mode or paused mode.

* In flowing mode, data is read from the underlying system automatically
  and provided to an application as quickly as possible using events via the
  [`EventEmitter`][] interface.

* In paused mode, the [`stream.read()`][stream-read] method must be called
  explicitly to read chunks of data from the stream.

All [`Readable`][] streams begin in paused mode but can be switched to flowing
mode in one of the following ways:

* Adding a [`'data'`][] event handler.
* Calling the [`stream.resume()`][stream-resume] method.
* Calling the [`stream.pipe()`][] method to send the data to a [`Writable`][].

The `Readable` can switch back to paused mode using one of the following:

* If there are no pipe destinations, by calling the
  [`stream.pause()`][stream-pause] method.
* If there are pipe destinations, by removing all pipe destinations.
  Multiple pipe destinations may be removed by calling the
  [`stream.unpipe()`][] method.

The important concept to remember is that a `Readable` will not generate data
until a mechanism for either consuming or ignoring that data is provided. If
the consuming mechanism is disabled or taken away, the `Readable` will _attempt_
to stop generating the data.

For backward compatibility reasons, removing [`'data'`][] event handlers will
**not** automatically pause the stream. Also, if there are piped destinations,
then calling [`stream.pause()`][stream-pause] will not guarantee that the
stream will _remain_ paused once those destinations drain and ask for more data.

If a [`Readable`][] is switched into flowing mode and there are no consumers
available to handle the data, that data will be lost. This can occur, for
instance, when the `readable.resume()` method is called without a listener
attached to the `'data'` event, or when a `'data'` event handler is removed
from the stream.

Adding a [`'readable'`][] event handler automatically makes the stream
stop flowing, and the data has to be consumed via
[`readable.read()`][stream-read]. If the [`'readable'`][] event handler is
removed, then the stream will start flowing again if there is a
[`'data'`][] event handler.

#### Three states

The "two modes" of operation for a `Readable` stream are a simplified
abstraction for the more complicated internal state management that is happening
within the `Readable` stream implementation.

Specifically, at any given point in time, every `Readable` is in one of three
possible states:

* `readable.readableFlowing === null`
* `readable.readableFlowing === false`
* `readable.readableFlowing === true`

When `readable.readableFlowing` is `null`, no mechanism for consuming the
stream's data is provided. Therefore, the stream will not generate data.
While in this state, attaching a listener for the `'data'` event, calling the
`readable.pipe()` method, or calling the `readable.resume()` method will switch
`readable.readableFlowing` to `true`, causing the `Readable` to begin actively
emitting events as data is generated.

Calling `readable.pause()`, `readable.unpipe()`, or receiving backpressure
will cause the `readable.readableFlowing` to be set as `false`,
temporarily halting the flowing of events but _not_ halting the generation of
data. While in this state, attaching a listener for the `'data'` event
will not switch `readable.readableFlowing` to `true`.

```js
const { PassThrough, Writable } = require('node:stream');
const pass = new PassThrough();
const writable = new Writable();

pass.pipe(writable);
pass.unpipe(writable);
// readableFlowing is now false.

pass.on('data', (chunk) => { console.log(chunk.toString()); });
// readableFlowing is still false.
pass.write('ok');  // Will not emit 'data'.
pass.resume();     // Must be called to make stream emit 'data'.
// readableFlowing is now true.
```

While `readable.readableFlowing` is `false`, data may be accumulating
within the stream's internal buffer.

#### Choose one API style

The `Readable` stream API evolved across multiple Node.js versions and provides
multiple methods of consuming stream data. In general, developers should choose
_one_ of the methods of consuming data and _should never_ use multiple methods
to consume data from a single stream. Specifically, using a combination
of `on('data')`, `on('readable')`, `pipe()`, or async iterators could
lead to unintuitive behavior.

#### Class: `stream.Readable`

<!-- YAML
added: v0.9.4
-->

<!--type=class-->

##### Event: `'close'`

<!-- YAML
added: v0.9.4
changes:
  - version: v10.0.0
    pr-url: https://github.com/nodejs/node/pull/18438
    description: Add `emitClose` option to specify if `'close'` is emitted on
                 destroy.
-->

The `'close'` event is emitted when the stream and any of its underlying
resources (a file descriptor, for example) have been closed. The event indicates
that no more events will be emitted, and no further computation will occur.

A [`Readable`][] stream will always emit the `'close'` event if it is
created with the `emitClose` option.

##### Event: `'data'`

<!-- YAML
added: v0.9.4
-->

* `chunk` {Buffer|string|any} The chunk of data. For streams that are not
  operating in object mode, the chunk will be either a string or `Buffer`.
  For streams that are in object mode, the chunk can be any JavaScript value
  other than `null`.

The `'data'` event is emitted whenever the stream is relinquishing ownership of
a chunk of data to a consumer. This may occur whenever the stream is switched
in flowing mode by calling `readable.pipe()`, `readable.resume()`, or by
attaching a listener callback to the `'data'` event. The `'data'` event will
also be emitted whenever the `readable.read()` method is called and a chunk of
data is available to be returned.

Attaching a `'data'` event listener to a stream that has not been explicitly
paused will switch the stream into flowing mode. Data will then be passed as
soon as it is available.

The listener callback will be passed the chunk of data as a string if a default
encoding has been specified for the stream using the
`readable.setEncoding()` method; otherwise the data will be passed as a
`Buffer`.

```js
const readable = getReadableStreamSomehow();
readable.on('data', (chunk) => {
  console.log(`Received ${chunk.length} bytes of data.`);
});
```

##### Event: `'end'`

<!-- YAML
added: v0.9.4
-->

The `'end'` event is emitted when there is no more data to be consumed from
the stream.

The `'end'` event **will not be emitted** unless the data is completely
consumed. This can be accomplished by switching the stream into flowing mode,
or by calling [`stream.read()`][stream-read] repeatedly until all data has been
consumed.

```js
const readable = getReadableStreamSomehow();
readable.on('data', (chunk) => {
  console.log(`Received ${chunk.length} bytes of data.`);
});
readable.on('end', () => {
  console.log('There will be no more data.');
});
```

##### Event: `'error'`

<!-- YAML
added: v0.9.4
-->

* Type: {Error}

The `'error'` event may be emitted by a `Readable` implementation at any time.
Typically, this may occur if the underlying stream is unable to generate data
due to an underlying internal failure, or when a stream implementation attempts
to push an invalid chunk of data.

The listener callback will be passed a single `Error` object.

##### Event: `'pause'`

<!-- YAML
added: v0.9.4
-->

The `'pause'` event is emitted when [`stream.pause()`][stream-pause] is called
and `readableFlowing` is not `false`.

##### Event: `'readable'`

<!-- YAML
added: v0.9.4
changes:
  - version: v10.0.0
    pr-url: https://github.com/nodejs/node/pull/17979
    description: The `'readable'` is always emitted in the next tick after
                 `.push()` is called.
  - version: v10.0.0
    pr-url: https://github.com/nodejs/node/pull/18994
    description: Using `'readable'` requires calling `.read()`.
-->

The `'readable'` event is emitted when there is data available to be read from
the stream, up to the configured high water mark (`state.highWaterMark`). Effectively,
it indicates that the stream has new information within the buffer. If data is available
within this buffer, [`stream.read()`][stream-read] can be called to retrieve that data.
Additionally, the `'readable'` event may also be emitted when the end of the stream has been
reached.

```js
const readable = getReadableStreamSomehow();
readable.on('readable', function() {
  // There is some data to read now.
  let data;

  while ((data = this.read()) !== null) {
    console.log(data);
  }
});
```

If the end of the stream has been reached, calling
[`stream.read()`][stream-read] will return `null` and trigger the `'end'`
event. This is also true if there never was any data to be read. For instance,
in the following example, `foo.txt` is an empty file:

```js
const fs = require('node:fs');
const rr = fs.createReadStream('foo.txt');
rr.on('readable', () => {
  console.log(`readable: ${rr.read()}`);
});
rr.on('end', () => {
  console.log('end');
});
```

The output of running this script is:

```console
$ node test.js
readable: null
end
```

In some cases, attaching a listener for the `'readable'` event will cause some
amount of data to be read into an internal buffer.

In general, the `readable.pipe()` and `'data'` event mechanisms are easier to
understand than the `'readable'` event. However, handling `'readable'` might
result in increased throughput.

If both `'readable'` and [`'data'`][] are used at the same time, `'readable'`
takes precedence in controlling the flow, i.e. `'data'` will be emitted
only when [`stream.read()`][stream-read] is called. The
`readableFlowing` property would become `false`.
If there are `'data'` listeners when `'readable'` is removed, the stream
will start flowing, i.e. `'data'` events will be emitted without calling
`.resume()`.

##### Event: `'resume'`

<!-- YAML
added: v0.9.4
-->

The `'resume'` event is emitted when [`stream.resume()`][stream-resume] is
called and `readableFlowing` is not `true`.

##### `readable.destroy([error])`

<!-- YAML
added: v8.0.0
changes:
  - version: v14.0.0
    pr-url: https://github.com/nodejs/node/pull/29197
    description: Work as a no-op on a stream that has already been destroyed.
-->

* `error` {Error} Error which will be passed as payload in `'error'` event
* Returns: {this}

Destroy the stream. Optionally emit an `'error'` event, and emit a `'close'`
event (unless `emitClose` is set to `false`). After this call, the readable
stream will release any internal resources and subsequent calls to `push()`
will be ignored.

Once `destroy()` has been called any further calls will be a no-op and no
further errors except from `_destroy()` may be emitted as `'error'`.

Implementors should not override this method, but instead implement
[`readable._destroy()`][readable-_destroy].

##### `readable.closed`

<!-- YAML
added: v18.0.0
-->

* Type: {boolean}

Is `true` after `'close'` has been emitted.

##### `readable.destroyed`

<!-- YAML
added: v8.0.0
-->

* Type: {boolean}

Is `true` after [`readable.destroy()`][readable-destroy] has been called.

##### `readable.isPaused()`

<!-- YAML
added: v0.11.14
-->

* Returns: {boolean}

The `readable.isPaused()` method returns the current operating state of the
`Readable`. This is used primarily by the mechanism that underlies the
`readable.pipe()` method. In most typical cases, there will be no reason to
use this method directly.

```js
const readable = new stream.Readable();

readable.isPaused(); // === false
readable.pause();
readable.isPaused(); // === true
readable.resume();
readable.isPaused(); // === false
```

##### `readable.pause()`

<!-- YAML
added: v0.9.4
-->

* Returns: {this}

The `readable.pause()` method will cause a stream in flowing mode to stop
emitting [`'data'`][] events, switching out of flowing mode. Any data that
becomes available will remain in the internal buffer.

```js
const readable = getReadableStreamSomehow();
readable.on('data', (chunk) => {
  console.log(`Received ${chunk.length} bytes of data.`);
  readable.pause();
  console.log('There will be no additional data for 1 second.');
  setTimeout(() => {
    console.log('Now data will start flowing again.');
    readable.resume();
  }, 1000);
});
```

The `readable.pause()` method has no effect if there is a `'readable'`
event listener.

##### `readable.pipe(destination[, options])`

<!-- YAML
added: v0.9.4
-->

* `destination` {stream.Writable} The destination for writing data
* `options` {Object} Pipe options
  * `end` {boolean} End the writer when the reader ends. **Default:** `true`.
* Returns: {stream.Writable} The _destination_, allowing for a chain of pipes if
  it is a [`Duplex`][] or a [`Transform`][] stream

The `readable.pipe()` method attaches a [`Writable`][] stream to the `readable`,
causing it to switch automatically into flowing mode and push all of its data
to the attached [`Writable`][]. The flow of data will be automatically managed
so that the destination `Writable` stream is not overwhelmed by a faster
`Readable` stream.

The following example pipes all of the data from the `readable` into a file
named `file.txt`:

```js
const fs = require('node:fs');
const readable = getReadableStreamSomehow();
const writable = fs.createWriteStream('file.txt');
// All the data from readable goes into 'file.txt'.
readable.pipe(writable);
```

It is possible to attach multiple `Writable` streams to a single `Readable`
stream.

The `readable.pipe()` method returns a reference to the _destination_ stream
making it possible to set up chains of piped streams:

```js
const fs = require('node:fs');
const zlib = require('node:zlib');
const r = fs.createReadStream('file.txt');
const z = zlib.createGzip();
const w = fs.createWriteStream('file.txt.gz');
r.pipe(z).pipe(w);
```

By default, [`stream.end()`][stream-end] is called on the destination `Writable`
stream when the source `Readable` stream emits [`'end'`][], so that the
destination is no longer writable. To disable this default behavior, the `end`
option can be passed as `false`, causing the destination stream to remain open:

```js
reader.pipe(writer, { end: false });
reader.on('end', () => {
  writer.end('Goodbye\n');
});
```

One important caveat is that if the `Readable` stream emits an error during
processing, the `Writable` destination _is not closed_ automatically. If an
error occurs, it will be necessary to _manually_ close each stream in order
to prevent memory leaks.

The [`process.stderr`][] and [`process.stdout`][] `Writable` streams are never
closed until the Node.js process exits, regardless of the specified options.

##### `readable.read([size])`

<!-- YAML
added: v0.9.4
-->

* `size` {number} Optional argument to specify how much data to read.
* Returns: {string|Buffer|null|any}

The `readable.read()` method reads data out of the internal buffer and
returns it. If no data is available to be read, `null` is returned. By default,
the data is returned as a `Buffer` object unless an encoding has been
specified using the `readable.setEncoding()` method or the stream is operating
in object mode.

The optional `size` argument specifies a specific number of bytes to read. If
`size` bytes are not available to be read, `null` will be returned _unless_
the stream has ended, in which case all of the data remaining in the internal
buffer will be returned.

If the `size` argument is not specified, all of the data contained in the
internal buffer will be returned.

The `size` argument must be less than or equal to 1 GiB.

The `readable.read()` method should only be called on `Readable` streams
operating in paused mode. In flowing mode, `readable.read()` is called
automatically until the internal buffer is fully drained.

```js
const readable = getReadableStreamSomehow();

// 'readable' may be triggered multiple times as data is buffered in
readable.on('readable', () => {
  let chunk;
  console.log('Stream is readable (new data received in buffer)');
  // Use a loop to make sure we read all currently available data
  while (null !== (chunk = readable.read())) {
    console.log(`Read ${chunk.length} bytes of data...`);
  }
});

// 'end' will be triggered once when there is no more data available
readable.on('end', () => {
  console.log('Reached end of stream.');
});
```

Each call to `readable.read()` returns a chunk of data or `null`, signifying
that there's no more data to read at that moment. These chunks aren't automatically
concatenated. Because a single `read()` call does not return all the data, using
a while loop may be necessary to continuously read chunks until all data is retrieved.
When reading a large file, `.read()` might return `null` temporarily, indicating
that it has consumed all buffered content but there may be more data yet to be
buffered. In such cases, a new `'readable'` event is emitted once there's more
data in the buffer, and the `'end'` event signifies the end of data transmission.

Therefore to read a file's whole contents from a `readable`, it is necessary
to collect chunks across multiple `'readable'` events:

```js
const chunks = [];

readable.on('readable', () => {
  let chunk;
  while (null !== (chunk = readable.read())) {
    chunks.push(chunk);
  }
});

readable.on('end', () => {
  const content = chunks.join('');
});
```

A `Readable` stream in object mode will always return a single item from
a call to [`readable.read(size)`][stream-read], regardless of the value of the
`size` argument.

If the `readable.read()` method returns a chunk of data, a `'data'` event will
also be emitted.

Calling [`stream.read([size])`][stream-read] after the [`'end'`][] event has
been emitted will return `null`. No runtime error will be raised.

##### `readable.readable`

<!-- YAML
added: v11.4.0
-->

* Type: {boolean}

Is `true` if it is safe to call [`readable.read()`][stream-read], which means
the stream has not been destroyed or emitted `'error'` or `'end'`.

##### `readable.readableAborted`

<!-- YAML
added: v16.8.0
changes:
 - version:
    - v24.0.0
    - v22.17.0
   pr-url: https://github.com/nodejs/node/pull/57513
   description: Marking the API stable.
-->

* Type: {boolean}

Returns whether the stream was destroyed or errored before emitting `'end'`.

##### `readable.readableDidRead`

<!-- YAML
added:
  - v16.7.0
  - v14.18.0
changes:
 - version:
    - v24.0.0
    - v22.17.0
   pr-url: https://github.com/nodejs/node/pull/57513
   description: Marking the API stable.
-->

* Type: {boolean}

Returns whether `'data'` has been emitted.

##### `readable.readableEncoding`

<!-- YAML
added: v12.7.0
-->

* Type: {null|string}

Getter for the property `encoding` of a given `Readable` stream. The `encoding`
property can be set using the [`readable.setEncoding()`][] method.

##### `readable.readableEnded`

<!-- YAML
added: v12.9.0
-->

* Type: {boolean}

Becomes `true` when [`'end'`][] event is emitted.

##### `readable.errored`

<!-- YAML
added:
  v18.0.0
-->

* Type: {Error}

Returns error if the stream has been destroyed with an error.

##### `readable.readableFlowing`

<!-- YAML
added: v9.4.0
-->

* Type: {boolean}

This property reflects the current state of a `Readable` stream as described
in the [Three states][] section.

##### `readable.readableHighWaterMark`

<!-- YAML
added: v9.3.0
-->

* Type: {number}

Returns the value of `highWaterMark` passed when creating this `Readable`.

##### `readable.readableLength`

<!-- YAML
added: v9.4.0
-->

* Type: {number}

This property contains the number of bytes (or objects) in the queue
ready to be read. The value provides introspection data regarding
the status of the `highWaterMark`.

##### `readable.readableObjectMode`

<!-- YAML
added: v12.3.0
-->

* Type: {boolean}

Getter for the property `objectMode` of a given `Readable` stream.

##### `readable.resume()`

<!-- YAML
added: v0.9.4
changes:
  - version: v10.0.0
    pr-url: https://github.com/nodejs/node/pull/18994
    description: The `resume()` has no effect if there is a `'readable'` event
                 listening.
-->

* Returns: {this}

The `readable.resume()` method causes an explicitly paused `Readable` stream to
resume emitting [`'data'`][] events, switching the stream into flowing mode.

The `readable.resume()` method can be used to fully consume the data from a
stream without actually processing any of that data:

```js
getReadableStreamSomehow()
  .resume()
  .on('end', () => {
    console.log('Reached the end, but did not read anything.');
  });
```

The `readable.resume()` method has no effect if there is a `'readable'`
event listener.

##### `readable.setEncoding(encoding)`

<!-- YAML
added: v0.9.4
-->

* `encoding` {string} The encoding to use.
* Returns: {this}

The `readable.setEncoding()` method sets the character encoding for
data read from the `Readable` stream.

By default, no encoding is assigned and stream data will be returned as
`Buffer` objects. Setting an encoding causes the stream data
to be returned as strings of the specified encoding rather than as `Buffer`
objects. For instance, calling `readable.setEncoding('utf8')` will cause the
output data to be interpreted as UTF-8 data, and passed as strings. Calling
`readable.setEncoding('hex')` will cause the data to be encoded in hexadecimal
string format.

The `Readable` stream will properly handle multi-byte characters delivered
through the stream that would otherwise become improperly decoded if simply
pulled from the stream as `Buffer` objects.

```js
const readable = getReadableStreamSomehow();
readable.setEncoding('utf8');
readable.on('data', (chunk) => {
  assert.equal(typeof chunk, 'string');
  console.log('Got %d characters of string data:', chunk.length);
});
```

##### `readable.unpipe([destination])`

<!-- YAML
added: v0.9.4
-->

* `destination` {stream.Writable} Optional specific stream to unpipe
* Returns: {this}

The `readable.unpipe()` method detaches a `Writable` stream previously attached
using the [`stream.pipe()`][] method.

If the `destination` is not specified, then _all_ pipes are detached.

If the `destination` is specified, but no pipe is set up for it, then
the method does nothing.

```js
const fs = require('node:fs');
const readable = getReadableStreamSomehow();
const writable = fs.createWriteStream('file.txt');
// All the data from readable goes into 'file.txt',
// but only for the first second.
readable.pipe(writable);
setTimeout(() => {
  console.log('Stop writing to file.txt.');
  readable.unpipe(writable);
  console.log('Manually close the file stream.');
  writable.end();
}, 1000);
```

##### `readable.unshift(chunk[, encoding])`

<!-- YAML
added: v0.9.11
changes:
  - version:
    - v22.0.0
    - v20.13.0
    pr-url: https://github.com/nodejs/node/pull/51866
    description: The `chunk` argument can now be a `TypedArray` or `DataView` instance.
  - version: v8.0.0
    pr-url: https://github.com/nodejs/node/pull/11608
    description: The `chunk` argument can now be a `Uint8Array` instance.
-->

* `chunk` {Buffer|TypedArray|DataView|string|null|any} Chunk of data to unshift
  onto the read queue. For streams not operating in object mode, `chunk` must
  be a {string}, {Buffer}, {TypedArray}, {DataView} or `null`.
  For object mode streams, `chunk` may be any JavaScript value.
* `encoding` {string} Encoding of string chunks. Must be a valid
  `Buffer` encoding, such as `'utf8'` or `'ascii'`.

Passing `chunk` as `null` signals the end of the stream (EOF) and behaves the
same as `readable.push(null)`, after which no more data can be written. The EOF
signal is put at the end of the buffer and any buffered data will still be
flushed.

The `readable.unshift()` method pushes a chunk of data back into the internal
buffer. This is useful in certain situations where a stream is being consumed by
code that needs to "un-consume" some amount of data that it has optimistically
pulled out of the source, so that the data can be passed on to some other party.

The `stream.unshift(chunk)` method cannot be called after the [`'end'`][] event
has been emitted or a runtime error will be thrown.

Developers using `stream.unshift()` often should consider switching to
use of a [`Transform`][] stream instead. See the [API for stream implementers][]
section for more information.

```js
// Pull off a header delimited by \n\n.
// Use unshift() if we get too much.
// Call the callback with (error, header, stream).
const { StringDecoder } = require('node:string_decoder');
function parseHeader(stream, callback) {
  stream.on('error', callback);
  stream.on('readable', onReadable);
  const decoder = new StringDecoder('utf8');
  let header = '';
  function onReadable() {
    let chunk;
    while (null !== (chunk = stream.read())) {
      const str = decoder.write(chunk);
      if (str.includes('\n\n')) {
        // Found the header boundary.
        const split = str.split(/\n\n/);
        header += split.shift();
        const remaining = split.join('\n\n');
        const buf = Buffer.from(remaining, 'utf8');
        stream.removeListener('error', callback);
        // Remove the 'readable' listener before unshifting.
        stream.removeListener('readable', onReadable);
        if (buf.length)
          stream.unshift(buf);
        // Now the body of the message can be read from the stream.
        callback(null, header, stream);
        return;
      }
      // Still reading the header.
      header += str;
    }
  }
}
```

Unlike [`stream.push(chunk)`][stream-push], `stream.unshift(chunk)` will not
end the reading process by resetting the internal reading state of the stream.
This can cause unexpected results if `readable.unshift()` is called during a
read (i.e. from within a [`stream._read()`][stream-_read] implementation on a
custom stream). Following the call to `readable.unshift()` with an immediate
[`stream.push('')`][stream-push] will reset the reading state appropriately,
however it is best to simply avoid calling `readable.unshift()` while in the
process of performing a read.

##### `readable.wrap(stream)`

<!-- YAML
added: v0.9.4
-->

* `stream` {Stream} An "old style" readable stream
* Returns: {this}

Prior to Node.js 0.10, streams did not implement the entire `node:stream`
module API as it is currently defined. (See [Compatibility][] for more
information.)

When using an older Node.js library that emits [`'data'`][] events and has a
[`stream.pause()`][stream-pause] method that is advisory only, the
`readable.wrap()` method can be used to create a [`Readable`][] stream that uses
the old stream as its data source.

It will rarely be necessary to use `readable.wrap()` but the method has been
provided as a convenience for interacting with older Node.js applications and
libraries.

```js
const { OldReader } = require('./old-api-module.js');
const { Readable } = require('node:stream');
const oreader = new OldReader();
const myReader = new Readable().wrap(oreader);

myReader.on('readable', () => {
  myReader.read(); // etc.
});
```

##### `readable[Symbol.asyncIterator]()`

<!-- YAML
added: v10.0.0
changes:
  - version: v11.14.0
    pr-url: https://github.com/nodejs/node/pull/26989
    description: Symbol.asyncIterator support is no longer experimental.
-->

* Returns: {AsyncIterator} to fully consume the stream.

```js
const fs = require('node:fs');

async function print(readable) {
  readable.setEncoding('utf8');
  let data = '';
  for await (const chunk of readable) {
    data += chunk;
  }
  console.log(data);
}

print(fs.createReadStream('file')).catch(console.error);
```

If the loop terminates with a `break`, `return`, or a `throw`, the stream will
be destroyed. In other terms, iterating over a stream will consume the stream
fully. The stream will be read in chunks of size equal to the `highWaterMark`
option. In the code example above, data will be in a single chunk if the file
has less than 64 KiB of data because no `highWaterMark` option is provided to
[`fs.createReadStream()`][].

##### `readable[Symbol.for('Stream.toAsyncStreamable')]()`

<!-- YAML
added: v26.1.0
-->

> Stability: 1 - Experimental

* Returns: {AsyncIterable} An `AsyncIterable<Uint8Array[]>` that yields
  batched chunks from the stream.

When the `--experimental-stream-iter` flag is enabled, `Readable` streams
implement the [`Stream.toAsyncStreamable`][] protocol, enabling efficient
consumption by the [`stream/iter`][] API.

This provides a batched async iterator that drains the stream's internal
buffer into `Uint8Array[]` batches, amortizing the per-chunk Promise overhead
of the standard `Symbol.asyncIterator` path. For byte-mode streams, chunks
are yielded directly as `Buffer` instances (which are `Uint8Array` subclasses).
For object-mode or encoded streams, each chunk is normalized to `Uint8Array`
before batching.

The returned iterator is tagged as a validated source, so [`from()`][stream-iter-from]
passes it through without additional normalization.

```mjs
import { Readable } from 'node:stream';
import { text, from } from 'node:stream/iter';

const readable = new Readable({
  read() { this.push('hello'); this.push(null); },
});

// Readable is automatically consumed via toAsyncStreamable
console.log(await text(from(readable))); // 'hello'
```

```cjs
const { Readable } = require('node:stream');
const { text, from } = require('node:stream/iter');

async function run() {
  const readable = new Readable({
    read() { this.push('hello'); this.push(null); },
  });

  console.log(await text(from(readable))); // 'hello'
}

run().catch(console.error);
```

Without the `--experimental-stream-iter` flag, calling this method throws
[`ERR_STREAM_ITER_MISSING_FLAG`][].

##### `readable[Symbol.asyncDispose]()`

<!-- YAML
added:
 - v20.4.0
 - v18.18.0
changes:
 - version: v24.2.0
   pr-url: https://github.com/nodejs/node/pull/58467
   description: No longer experimental.
-->

Calls [`readable.destroy()`][readable-destroy] with an `AbortError` and returns
a promise that fulfills when the stream is finished.

##### `readable.compose(stream[, options])`

<!-- YAML
added:
  - v19.1.0
  - v18.13.0
changes:
 - version:
    - v24.0.0
    - v22.17.0
   pr-url: https://github.com/nodejs/node/pull/57513
   description: Marking the API stable.
-->

* `stream` {Writable|Duplex|WritableStream|TransformStream|Function}
* `options` {Object}
  * `signal` {AbortSignal} allows destroying the stream if the signal is
    aborted.
* Returns: {Duplex} a stream composed with the stream `stream`.

```mjs
import { Readable } from 'node:stream';

async function* splitToWords(source) {
  for await (const chunk of source) {
    const words = String(chunk).split(' ');

    for (const word of words) {
      yield word;
    }
  }
}

const wordsStream = Readable.from(['text passed through', 'composed stream']).compose(splitToWords);
const words = await wordsStream.toArray();

console.log(words); // prints ['text', 'passed', 'through', 'composed', 'stream']
```

`readable.compose(s)` is equivalent to `stream.compose(readable, s)`.

This method also allows for an {AbortSignal} to be provided, which will destroy
the composed stream when aborted.

See [`stream.compose(...streams)`][] for more information.

##### `readable.iterator([options])`

<!-- YAML
added: v16.3.0
changes:
 - version:
    - v24.0.0
    - v22.17.0
   pr-url: https://github.com/nodejs/node/pull/57513
   description: Marking the API stable.
-->

* `options` {Object}
  * `destroyOnReturn` {boolean} When set to `false`, calling `return` on the
    async iterator, or exiting a `for await...of` iteration using a `break`,
    `return`, or `throw` will not destroy the stream. **Default:** `true`.
* Returns: {AsyncIterator} to consume the stream.

The iterator created by this method gives users the option to cancel the
destruction of the stream if the `for await...of` loop is exited by `return`,
`break`, or `throw`, or if the iterator should destroy the stream if the stream
emitted an error during iteration.

```js
const { Readable } = require('node:stream');

async function printIterator(readable) {
  for await (const chunk of readable.iterator({ destroyOnReturn: false })) {
    console.log(chunk); // 1
    break;
  }

  console.log(readable.destroyed); // false

  for await (const chunk of readable.iterator({ destroyOnReturn: false })) {
    console.log(chunk); // Will print 2 and then 3
  }

  console.log(readable.destroyed); // True, stream was totally consumed
}

async function printSymbolAsyncIterator(readable) {
  for await (const chunk of readable) {
    console.log(chunk); // 1
    break;
  }

  console.log(readable.destroyed); // true
}

async function showBoth() {
  await printIterator(Readable.from([1, 2, 3]));
  await printSymbolAsyncIterator(Readable.from([1, 2, 3]));
}

showBoth();
```

##### `readable.map(fn[, options])`

<!-- YAML
added:
  - v17.4.0
  - v16.14.0
changes:
  - version:
    - v20.7.0
    - v18.19.0
    pr-url: https://github.com/nodejs/node/pull/49249
    description: added `highWaterMark` in options.
-->

> Stability: 1 - Experimental

* `fn` {Function|AsyncFunction} a function to map over every chunk in the
  stream.
  * `data` {any} a chunk of data from the stream.
  * `options` {Object}
