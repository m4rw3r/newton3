/* @flow */
"use strict";

// TODO: Remove dependency on generators
/// Function constructor for generator iterators
const GeneratorFunctionPrototype = (function*(){})().constructor;

/**
 * Returns true if the supplied object is an iterator (supporting next() and throw()).
 * 
 * @return boolean
 */
function isIterator(obj: mixed): boolean {
  if(typeof obj === "function" || typeof obj === "object" && obj !== null) {
    return obj.constructor === GeneratorFunctionPrototype;
  }

  return false;
}

//type MaybePromise     = Promise<any>|any;
//type Parameters       = {[id:string]: MaybePromise} | null;
//type TransitionRender = (x:     Parameters,
//                         state: {
//                           current:      any,
//                           parameters:   {[id:string]: any},
//                           transitionTo: (f: Transition, p: Parameters) => Promise<void>
//                        }) => VirtualDom;
//type Transition       = <T>(t: T) => { data: {[id:string]: any}, render: TransitionRender };

//function resolve(data: {[id:string]: MaybePromise}): Promise<{[id:string]: any}> {

/**
 * Resolves any promise or generator, or object or array of the same by wrapping it in a closure.
 * 
 * @return Promise
 */
// resolve :: (a: Object) => MaybePromise a -> Promise a
export function resolve(data: mixed): Promise<mixed> {
  if(isIterator(data)) {
    return resolveIterator(((data:any): Generator<mixed, mixed, mixed>));
  }

  // This one also handles primitives in addition to Promises
  if(data === null || typeof data !== "object" || typeof data.then === "function") {
    return Promise.resolve(data);
  }

  if(Array.isArray(data)) {
    return resolveArray(data);
  }

  return resolveObject(data);
}

type GenObj = {
  next:  (n?: any) => IteratorResult<mixed, mixed>,
  throw: (e?: any) => IteratorResult<mixed, mixed>
};

/**
 * Resolves a generator iterator as a promise, will execute the generator fully before resolving
 * the returned Promise.
 * 
 * @return Promise
 */
export function resolveIterator(iter: Generator<mixed, mixed, mixed>): Promise<mixed> {
  return new Promise(function(ok, error) {
    function next(type, result) {
      try {
        const { value, done = true } = (iter: GenObj)[type](result);

        if(done) {
          ok(resolve(value));
        }
        else {
          resolve(value).then(
            t => next("next",  t),
            e => next("throw", e),
          );
        }
      }
      catch(e) {
        error(e);
      }
    }

    next("next", undefined);
  });
}

/**
 * Resolves all values in an array, returning a promise yielding a new array containing their
 * resolved values.
 * 
 * @return Promise
 */
export function resolveArray(arr: Array<mixed>): Promise<Array<mixed>> {
  return Promise.all(arr.map(resolve));
}

/**
 * Resolves all values on an object, returns a promise yielding a new object with the same keys
 * with their resolved values.
 * 
 * @return Promise
 */
export function resolveObject(data: {[p:string]:mixed}): Promise<{[p:string]: mixed}> {
  let keys   = [];
  let values = [];

  for(let k in data) {
    if(data.hasOwnProperty(k)) {
      keys.push(k);
      // Keep on resolving before we start to wait to issue requests in paralell
      values.push(resolve(data[k]));
    }
  }

  return Promise.all(values).then(function(d) {
    let obj = {};

    for(var i = 0; i < keys.length; i++) {
      obj[keys[i]] = d[i];
    }

    return obj;
  });
}
