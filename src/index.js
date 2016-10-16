/* @flow */
"use strict";

import {resolveArray, resolveObject} from "./resolve.js";

type VirtualDOM       = mixed;
//type State<P, S>      = { current: Action<P, S>, params: P };
type RenderFn<P, S>   = (s: State<P, S>) => S;
type MaybeAsync       = Promise<mixed>|{[s: string]: MaybeAsync}|Array<MaybeAsync>;
type Transition<P, S> = Generator<MaybeAsync, RenderFn<P, S>, mixed>;
type Action<P, S>     = (p: P) => Transition<P, S>;

type Observer<T, U, E> = {
  // Receives the subscription object when `subscribe` is called
  start?:    (s: Subscription) => void;
  // Receives the next value in the sequence
  next?:     (v: T) => void;
  // Receives the sequence error
  error?:    (e: E) => void;
  // Receives the sequence completion value
  complete?: (c: U) => void;
};

interface Subscription {
  // Cancels the subscription
  unsubscribe() : void;
  // A boolean value indicating whether the subscription is closed
  closed: boolean;
}

type MaybePromise<T> = Promise<T> | T;

type Process<T> =  {
  promise: Promise<T>,
  //then<U, V>(onSuccess: (t: T) => U|Promise<U, V>, onError: (e: E) => V|Promise<U, V>): Promise<U, V>;
  //then<U>(onSuccess: (t: T) => MaybePromise<U>, onError: (e: mixed) => MaybePromise<U>): Promise<U>;
  cancel:  () => void;
}

type GenMethod    = "next" | "throw";
type GenObj<T, R> = {
  next:  (n?: any) => IteratorResult<T, R>,
  throw: (e?: any) => IteratorResult<T, R>
};

function resolvePromises(data: mixed): Promise<mixed> {
  // This one also handles primitives in addition to Promises
  if(data === null || typeof data !== "object" || typeof data.then === "function") {
    return Promise.resolve(data);
  }

  if(Array.isArray(data)) {
    return resolveArray(data);
  }

  return resolveObject(data);
}

function mkAsyncProcess<T>(gen: Generator<mixed, T, mixed>): Process<T> {
  let cancelled = false;

  let p = new Promise(function(ok, error) {
    function next(type: GenMethod, result: mixed): void {
      if(cancelled) {
        // Call generator return to give any possible wrapper the ability to
        // destroy any related resources.
        return gen.return().value;
      }

      try {
        // We cast to a GenObj so that we can call GenMethods dynamically
        const { value, done } = (gen: GenObj<mixed, T>)[type](result);

        if(done) {
          // TODO: Why is this cast required?
          ok(((value: any): T));
        }
        else {
          resolvePromises(value).then(
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
  
  return {
    promise: p,
    cancel:  function cancel() {
      cancelled = true;
    }
  };
}

export class State<P, S> {
  _manager: StateManager<S>;
  current:  Action<P, S>;
  params:   P;
  constructor(manager: StateManager<S>, action: Action<P, S>, params: P) {
    this._manager      = manager;
    this.current       = action;
    this.params        = params;
    // We cast here since Flow does not like that we reassign the methods (it wants to have
    // immutable methods due to covariance).
    (this: any).mutate = this.mutate.bind(this);
    (this: any).reload = this.reload.bind(this);
  }
  mutate<T>(action: Action<T, S>, params: T): Promise<void> {
    return this._manager.mutate(action, params);
  }
  reload(): Promise<void> {
    return this._manager.mutate(this.current, this.params);
  }
}

export class ActionError<P, S> {
  action: Action<P, S>;
  params: P;
  error:  mixed;
  constructor(action: Action<P, S>, params: P, error: mixed) {
    this.action = action;
    this.params = params;
    this.error  = error;
  }
}

export class CancelledAction<P, S> extends ActionError<P, S> {
  render: RenderFn<P, S>;
  constructor(action: Action<P, S>, params: P, render: RenderFn<P, S>) {
    super(action, params, null);

    this.render = render;
  }
}

export class CancelledError<P, S> extends ActionError<P, S> { }

export default class StateManager<S> {
  // We do not care about the parameters here (would be nice if Flow had a forall p. like PureScript)
  _current:   ?Process<RenderFn<any, S>>;
  _observers: Array<Observer<S, void, ActionError<any, S>>>;
  constructor() {
    this._current   = null;
    this._observers = [];
  }
  mutate<P>(f: Action<P, S>, params: P): Promise<void> {
    // TODO: Hooks
    if(this._current) {
      // TODO: Reason
      this._current.cancel();
    }

    let process = mkAsyncProcess(f(params));

    this._current = process;

    return this._current.promise.then(
      s => this._onState(s, f, params, process),
      e => this._onError(e, f, params, process)
    );
  }
  _onState<P, P>(render: RenderFn<P, S>, action: Action<P, S>, params: P, process: Process<RenderFn<P, S>>): void {
    if(this._current === process) {
      this._current = null;

      // TODO: What about mutation in callbacks? i won't be correct
      for(let i = 0; i < this._observers.length; i++) {
        if(this._observers[i].next) {
          // Any is used here since we assert that render will not mutate the observer-object itself
          (this._observers[i].next: any)(render(Object.freeze(new State(this, action, params))));
        }
      }
    }
    else {
      // TODO: What about mutation in callbacks? i won't be correct
      for(let i = 0; i < this._observers.length; i++) {
        if(this._observers[i].error) {
          this._observers[i].error(new CancelledAction(action, params, render));
        }
      }
    }
  }
  _onError<P, P>(error: mixed, action: Action<P, S>, params: P, process: Process<RenderFn<P, S>>): void {
    if(this._current === process) {
      this._current = null;

      // TODO: What about mutation in callbacks? i won't be correct
      for(let i = 0; i < this._observers.length; i++) {
        if(this._observers[i].error) {
          this._observers[i].error(new ActionError(action, params, error));
        }
      }
    }
    else {
      // TODO: What about mutation in callbacks? i won't be correct
      for(let i = 0; i < this._observers.length; i++) {
        if(this._observers[i].error) {
          this._observers[i].error(new CancelledError(action, params, error));
        }
      }
    }
  }
  subscribe(o: Observer<S, void, ActionError<mixed, S>>): Subscription {
    const self = this;
    const s    =  {
      unsubscribe: function unsubscribe() {
        let i = self._observers.indexOf(o);
        if(i !== -1) {
          self._observers.splice(i, 1);

          s.closed = true;
        }
      },
      closed:      false
    };

    if(o.start) {
      o.start(s);
    }

    this._observers.push(o);

    return s;
  }
}

/*
type MaybePromise     = Promise<any>|any;
type Parameters       = {[id:string]: MaybePromise} | null;
type TransitionRender = (x:     Parameters,
                         state: {
                           current:      any,
                           parameters:   {[id:string]: any},
                           transitionTo: (f: Transition, p: Parameters) => Promise<void>
                        }) => VirtualDom;
type Transition       = <T>(t: T) => { data: {[id:string]: any}, render: TransitionRender };

// Library for managing state-transitions and queued render-passes.

// type Transition p s = p -> MaybePromise (s -> VirtualDOM)
// runTransition :: Transition p s -> p -> s -> Promise VirtualDOM
// 
// TODO: Not even needed, just expose resolve instead?
export function runTransition(f, p, s) {
  return resolve(f(p)).then(render => {
    if(typeof render !== "function") {
      throw new Error("Expected return of state generator to be a function");
    }

    return render(s);
  })
}

export class State {
  // State :: forall s. StateManager -> Transition -> s -> State
  constructor(manager, ctor, params) {
    this.current = ctor;
    this.params  = params;
    this.mutate  = function(f, p) {
      return manager.mutate(f, p);
    }.bind(this);
    this.reload  = function() {
      return manager.mutate(ctor, params);
    }.bind(this);
  }
}

// Probably not a good idea to use objects like this since we want some introspection and also
// link to the StateManager while also being pluggable during runtime :/
export class Queue {
  constructor() {
    this._curr = null;
    this._list = [];
  }
  // enqueue :: forall p. Transition p -> p -> Promise void
  enqueue(f, p) {
    const next = () => {
      if(this._list.length > 0) {
        const {f, p} = this._list.shift();

        this._curr = this._manager.launchMutation(f, p).then(next, next);
      }
      else {
        this._curr = null;
      }
    }

    if(this._curr) {
      this._list.push({f: f, p: p});
    }
    else {
      // TODO: Configurable behaviour on error
      this._curr = this._manager.launchMutation(f, p).then(next, next);
    }
  }
}

export class Replace {
  constructor() {
    this._curr = null;
  }
  enqueue(f, p) {
    if(this._curr) {
      Promise.cancel(this._curr);
    }
    
    let next = () => {
      if(this._curr === p) {
      this._curr === null
    };
    }
    
    // TODO: Need to abort, implement minimalistic way of aborting at least at the render
    // boundary, to prevent the VirtualDOM from being rendered if a new state has been
    // supplied.
    this._manager.launchMutation(f, p).then(next, next);

    this._curr = 
  }
}

export default class StateManager {
  constructor(update) {
    this._running = null;
    this._update  = update;
  }
  // type Transition s = s -> MaybePromise (State -> VirtualDOM)
  // mutate :: Transition s -> s -> Promise void
  mutate(f, p) {
    // TODO: Notify listeners about f and p
    const p = resolve(f(p)).then(this.update.bind(this));

    if(process.env.NODE_ENV !== "production" && this._running) {
      // TODO: Warn
    }
    
    this._running = 
  }
}

// TODO: Component which can re-render parts of the VirtualDOM when an Observable updates
// TODO: Debug config where warnings can be emitted on console or error.
// TODO: How to prevent events/mutations to happen simultaneously?
//       4 choices, maybe pluggable? Queue mutations to happen in order, each updating the UI,
//       Throw an error if a mutation is initiated during a mutation,
//       Silently drop the new mutation and proceed with the old one
//       Silently drop the original mutation (and cancel its Promise) and execute the new one
// TODO: How to manage out-of-band mutations? eg. push-data from server or a ui-element which
//       needs to update (eg. exaple app is playing music, track changes). How to inject the new
//       data without forcing a full refetch of all the data in the action?
// TODO: How to handle errors?
// TODO: How to handle nested state-managers?
// TODO: How to handle nested states?
// TODO: How to attach pre or post hooks? Maybe just promises?
// TODO: Better API for managing during hook
// 
// StateManager :: (VirtualDOM -> Promise void) -> StateManager
export default class StateManager {
  constructor(update) {
    this._update   = update;
    // TODO: Configurable
    this._strategy = new Queue();
    
    this._strategy._manager = this;
  }
  // type Transition s = s -> MaybePromise (State -> VirtualDOM)
  // mutate :: Transition s -> s -> Promise void
  // 
  // Wrapper around the strategy enqueue
  mutate(f, p) {
    return this._strategy.enqueue(f, p);
  }
  // launchMutation :: Transition s -> s -> Promise void
  launchMutation(f, p) {
    // TODO: Handle promise error here
    return resolve(f(p)).then(render => this.update(render, Object.freeze(new State(this, f, p))));
  }
  update(render, renderParam) {
    if(typeof render !== "function") {
      throw new Error("Expected return of state generator to be a function");
    }

    return this._update(render(renderParam));
  }
}
*/
