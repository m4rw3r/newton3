/* @flow */
"use strict";

/**
 * Module enabling Generators to be run and cancelled.
 */

declare type Process<T> = {
  then<U>(
    onFulfill?: (value: T)   => Promise<U> | U,
    onReject?:  (error: any) => Promise<U> | U
  ): Promise<U>;
  cancel?: () => void;
}

type Resolver<T> = (t: T) => Process<mixed>;

const runGenerator = (mkGeneratorRunner(run): (g: Generator<mixed, mixed, mixed>) => Process<mixed>);

function isGenerator(data: mixed): boolean {
  return data != null && typeof data === "object" && typeof data.next === "function" && typeof data.throw === "function" && typeof data.return === "function";
}

function mkProcess<T>(p: Promise<T>, cancel: () => void): Process<T> {
  return {
    then<U>(
      s?: (value: T)   => Promise<U> | U,
      e?: (error: any) => Promise<U> | U
    ): Promise<U> {
      return p.then(s, e);
    },
    cancel: cancel
  };
}

export default function run(data: mixed): Process<mixed> {
  if(isGenerator(data)) {
    // We assert that the above check verifies that it is a generator
    return runGenerator((data: any));
  }
  else if(data === null ||
          typeof data !== "object" ||
          typeof data.then === "function" && typeof data.cancel !== "function") {
    // Cannot be cancelled, no cancel method
    return Promise.resolve(data);
  }
  else if(typeof data.then === "function" && typeof data.cancel === "function") {
    // TODO: Is this a decent way to make a cancellable promise?
    // object does have then and cancel functions, it should be a process
    return (data: any);
  }
  else if(Array.isArray(data)) {
    const nested = data.map(run);
    const p      = Promise.all(nested);

    // TODO: Is this a decent way to get a cancel?
    return mkProcess(p, () => nested.forEach((n: any) => {
      if(typeof n.cancel === "function") {
        n.cancel();
      }
    }))
  }
  else {
    let keys   = [];
    let values = [];

    for(let k in data) {
      if(data.hasOwnProperty(k)) {
        keys.push(k);
        // Keep on resolving before we start to wait to issue requests in paralell
        values.push(run(data[k]));
      }
    }

    const p = Promise.all(values).then(function(d) {
      let obj = {};

      for(var i = 0; i < keys.length; i++) {
        obj[keys[i]] = d[i];
      }

      return obj;
    });
    
    return mkProcess(p, () => values.forEach((v: any) => {
      if(typeof v.cancel === "function") {
        v.cancel();
      }
    }))
  }
}

function mkGeneratorRunner<T>(resolver: Resolver<T>): <R>(g: Generator<T, R, mixed>) => Process<R> {
  return function startProcess<R>(gen: Generator<T, R, mixed>): Process<R> {
    let   c = null;
    const p = new Promise((resolve, reject) => {
      function queue(r): void {
        if(r.done) {
          // r.value on done is maybe nothing, we ignore this here. Generators MUST return a value
          resolve((r.value: any));
        }
        else {
          // We need to store the original c here to be able to cancel it
          c = resolver(r.value);

          c.then(next, error);
        }
      }

      function next(result: mixed): void {
        try {
          queue(gen.next(result));
        }
        catch(e) {
          reject(e);
        }
      }

      function error(error: mixed): void {
        try {
          queue(gen.throw(error));
        }
        catch(e) {
          reject(e);
        }
      }

      next(undefined);
    });

    function cancel() {
      gen.return().value;

      if(c && typeof c.cancel === "function") {
        c.cancel();
      }
    }

    return mkProcess(p, cancel);
  }
}
