/* @flow */

declare type Process<T> = {
  then<U>(
    onFulfill?: (value: T)   => Promise<U> | U,
    onReject?:  (error: any) => Promise<U> | U
  ): Promise<U>;
  cancel?: () => void;
}
