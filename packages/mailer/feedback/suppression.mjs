import { addressHash } from './normalize.mjs';

export class SuppressionList {
  constructor(pool) {
    this.pool = pool;
  }
  async isSuppressed(address) {
    return (
      (
        await this.pool.query('SELECT 1 FROM mail_suppressions WHERE address_hash=$1', [
          addressHash(address),
        ])
      ).rowCount > 0
    );
  }
}
