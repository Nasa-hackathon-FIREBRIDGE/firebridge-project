import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './response.js';

type Position = {
  release_id: string;
  membership: string;
  limit: number;
  after: string[];
  version: 1;
};
export class CursorCodec {
  constructor(private secret: string) {}
  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest();
  }
  encode(position: Omit<Position, 'version'>) {
    const payload = Buffer.from(JSON.stringify({ ...position, version: 1 })).toString('base64url');
    return payload + '.' + this.sign(payload).toString('base64url');
  }
  decode(cursor: string, expected: Omit<Position, 'version' | 'after'>) {
    try {
      const [payload, signature, extra] = cursor.split('.');
      if (!payload || !signature || extra) throw new Error();
      const actual = Buffer.from(signature, 'base64url');
      const signed = this.sign(payload);
      if (actual.length !== signed.length || !timingSafeEqual(actual, signed)) throw new Error();
      const position = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Position;
      if (
        position.version !== 1 ||
        position.release_id !== expected.release_id ||
        position.membership !== expected.membership ||
        position.limit !== expected.limit ||
        !Array.isArray(position.after) ||
        position.after.length !== 2 ||
        !position.after.every((value) => typeof value === 'string')
      )
        throw new Error();
      return position.after;
    } catch {
      throw new ApiError(
        422,
        'INVALID_CURSOR',
        'The cursor is invalid or belongs to another request.'
      );
    }
  }
}
