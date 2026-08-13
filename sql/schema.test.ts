import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe( 'sql/schema.sql', () => {
  test( 'declares every reference table', () => {
    const sql = readFileSync(
      join( import.meta.dir, 'schema.sql' ),
      'utf8',
    );
    for ( const table of [
      'entity',
      'calendar',
      'entity_calendar',
      'calendar_event',
      'availability_rule',
      'bookable_slot',
      'booking',
    ] ) {
      expect( sql ).toContain( `create table ${ table }` );
    }
  } );
} );
