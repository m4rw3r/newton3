/* @flow */

// Library for managing state-transitions and queued render-passes.

/*
Action (P) -> (Generator<RenderFn>)
*/

/*
// TODO: Component which can re-render parts of the VirtualDOM when an Observable updates
// TODO: Debug config where warnings can be emitted on console or error.
// TODO: How to manage out-of-band mutations? eg. push-data from server or a ui-element which
//       needs to update (eg. exaple app is playing music, track changes). How to inject the new
//       data without forcing a full refetch of all the data in the action?
// TODO: How to handle errors?
// TODO: How to handle nested state-managers?
// TODO: How to handle nested states?
// TODO: How to attach pre or post hooks? Maybe just promises?
// TODO: Better API for managing during hook
*/

import run from "./process.js";

type Process<T> = {
  then<U>(
    onFulfill?: (value: T)   => Promise<U> | U,
    onReject?:  (error: any) => Promise<U> | U
  ): Promise<U>;
  cancel?: () => void;
}

// Function responsible for rendering the state
type RenderFn<P, S>   = (s: State<P, S>) => S;
// Maybe an asynchronous action
type MaybeAsync       = Promise<mixed>|{[s: string]: MaybeAsync}|Array<MaybeAsync>;
// Generator which is run to obtain the new state render function
type Transition<P, S> = Generator<MaybeAsync, RenderFn<P, S>, mixed>;
// Generator constructor
type Action<P, S>     = (p: P) => Transition<P, S>;

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
    if(this._current && this._current.cancel) {
      // TODO: Reason
      this._current.cancel();
    }

    let process = ((run(f(params)): any): Process<RenderFn<any, S>>);

    this._current = process;

    return this._current.then(
      s => this._onState(s, f, params, process),
      e => this._onError(e, f, params, process)
    );
  }
  _onState<P, P>(render: RenderFn<P, S>, action: Action<P, S>, params: P, process: Process<RenderFn<P, S>>): void {
    if(this._current === process) {
      this._current = null;

      this._observers.forEach(o => {
        if(o.next) {
          // Any is used here since we assert that render will not mutate the observer-object itself
          (o.next: any)(render(Object.freeze(new State(this, action, params))));
        }
      });
    }
    else {
      this._observers.forEach(o => {
        if(o.error) {
          o.error(new CancelledAction(action, params, render));
        }
      })
    }
  }
  _onError<P, P>(error: mixed, action: Action<P, S>, params: P, process: Process<RenderFn<P, S>>): void {
    if(this._current === process) {
      // If we have sent it to any observer, if not we need to raise the error
      let handled = false;

      this._current = null;

      this._observers.forEach(o => {
        if(o.error) {
          handled = true;

          o.error(new ActionError(action, params, error));
        }
      });

      if( ! handled) {
        throw new ActionError(action, params, error);
      }
    }
    else {
      this._observers.forEach(o => {
        if(o.error) {
          o.error(new CancelledError(action, params, error));
        }
      });
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
