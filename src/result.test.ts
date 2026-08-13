import { expect, test } from 'bun:test';
import { err, ok } from './result.ts';

test( 'ok wraps a value', () => {
  expect( ok( 1 ) ).toEqual( { ok: true, value: 1 } );
} );

test( 'err wraps an engine error', () => {
  const error = { code: 'validation' as const, message: 'bad' };
  expect( err( error ) ).toEqual( { ok: false, error } );
} );
