import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { User } from '../auth';
import { digest } from '../auth';
import { q } from '../db';

@Injectable()
export class IdempotencyService {
  async run<T>(
    db: PoolClient,
    actor: User,
    operation: string,
    key: unknown,
    input: unknown,
    perform: () => Promise<T>,
  ): Promise<T> {
    if (typeof key !== 'string' || key.length < 8 || key.length > 120)
      throw new BadRequestException('Brakuje identyfikatora operacji. Odśwież stronę.');
    const hash = digest(JSON.stringify(input));
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      actor.id + operation + key,
    ]);
    const [old] = await q<{ response: { hash: string; data: T } }>(
      'SELECT response FROM idempotency WHERE user_id=$1 AND operation=$2 AND key=$3',
      [actor.id, operation, key],
      db,
    );
    if (old) {
      if (old.response.hash !== hash)
        throw new ConflictException('Ten identyfikator został użyty dla innych danych.');
      return old.response.data;
    }
    const data = await perform();
    await db.query('INSERT INTO idempotency(user_id,operation,key,response) VALUES($1,$2,$3,$4)', [
      actor.id,
      operation,
      key,
      JSON.stringify({ hash, data }),
    ]);
    return data;
  }
}
