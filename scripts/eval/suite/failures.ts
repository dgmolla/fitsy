export type FailureKind = 'parse' | 'format' | 'timeout' | 'abstain' | 'adapter';

/** A validated provider failure can cross the adapter boundary without exposing raw errors or credentials. */
export class OutputFailure extends Error {
  constructor(readonly kind: FailureKind, message: string) { super(message); }
}
