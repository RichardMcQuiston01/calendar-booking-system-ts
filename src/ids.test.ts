import { describe, expect, test } from 'bun:test';
import { isUuid, normalizeUuid } from './ids.ts';

describe( 'isUuid', () => {
  test( 'accepts a canonical UUID', () => {
    expect( isUuid( '11111111-1111-4111-8111-111111111111' ) ).toBe( true );
  } );

  test( 'rejects a non-UUID', () => {
    expect( isUuid( 'not-a-uuid' ) ).toBe( false );
    expect( isUuid( '11111111111141118111111111111111' ) ).toBe( false );
  } );
} );

describe( 'normalizeUuid', () => {
  test( 'lowercases a valid UUID', () => {
    expect( normalizeUuid( '11111111-1111-4111-8111-111111111111' ) )
      .toBe( '11111111-1111-4111-8111-111111111111' );
  } );
} );
