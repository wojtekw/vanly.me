export class DocumentError extends Error {
  constructor(code, outcome = 'dead') {
    super(code);
    this.name = 'DocumentError';
    this.code = code;
    this.outcome = outcome;
  }
}
