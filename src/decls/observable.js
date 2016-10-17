/* @flow */

declare type Observer<T, C, E> = {
  // Receives the subscription object when `subscribe` is called
  start?:    (s: Subscription) => void;
  // Receives the next value in the sequence
  next?:     (v: T) => void;
  // Receives the sequence error
  error?:    (e: E) => void;
  // Receives the sequence completion value
  complete?: (c: C) => void;
};

declare interface Observable<T, C, E> {
  // Subscribes to the sequence with an observer
  subscribe(observer: Observer<T, C, E>): Subscription;

  // Subscribes to the sequence with callbacks
  subscribe(onNext:      (t: T) => void,
            onError?:    (e: E) => void,
            onComplete?: (c: C) => void): Subscription;
}

declare interface Subscription {
  // Cancels the subscription
  unsubscribe() : void;
  // A boolean value indicating whether the subscription is closed
  closed: boolean;
}
