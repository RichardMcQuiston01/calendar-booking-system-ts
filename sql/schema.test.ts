import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql: string = readFileSync(
  join( import.meta.dir, 'schema.sql' ),
  'utf8',
);

describe( 'sql/schema.sql', () => {
  test( 'declares every reference table', () => {
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

  test( 'declares the integrity rules the engine treats as invariants', () => {
    for ( const name of [
      'entity_parent_not_self_chk',
      'entity_acyclic_trg',
      'booking_event_calendar_fk',
      'booking_slot_calendar_fk',
      'calendar_event_exclusive_excl',
      'bookable_slot_exclusive_excl',
      'booking_ad_hoc_excl',
      'calendar_event_recurrence_chk',
      'availability_rule_recurrence_chk',
      'availability_rule_start_date_chk',
      'calendar_time_zone_trg',
      'calendar_event_time_zone_trg',
      'on delete restrict',
    ] ) {
      expect( sql ).toContain( name );
    }
  } );

  test( 'keeps updated_at current with a trigger on every table', () => {
    for ( const table of [
      'entity',
      'calendar',
      'entity_calendar',
      'calendar_event',
      'availability_rule',
      'bookable_slot',
      'booking',
    ] ) {
      expect( sql ).toContain( `${ table }_updated_at_trg` );
    }
  } );
} );

/**
 * Live checks run only when SCHEMA_TEST_DATABASE_URL points at a
 * throwaway PostgreSQL database (the `public` schema is dropped).
 */
const databaseUrl: string | undefined =
  process.env.SCHEMA_TEST_DATABASE_URL;

function psql( statement: string ): { ok: boolean; output: string } {
  const run = Bun.spawnSync(
    [
      'psql',
      databaseUrl ?? '',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-c',
      statement,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  return {
    ok: run.exitCode === 0,
    output: `${ run.stdout.toString() }${ run.stderr.toString() }`,
  };
}

describe.skipIf( databaseUrl === undefined )(
  'sql/schema.sql against PostgreSQL',
  () => {
    const cal1 = '00000000-0000-4000-8000-0000000000c1';
    const cal2 = '00000000-0000-4000-8000-0000000000c2';
    const evt = '00000000-0000-4000-8000-0000000000a1';
    const ent1 = '00000000-0000-4000-8000-0000000000e1';
    const ent2 = '00000000-0000-4000-8000-0000000000e2';

    test( 'loads and enforces the rules', () => {
      expect( psql(
        'drop schema public cascade; create schema public;',
      ).ok ).toBe( true );
      const loaded = Bun.spawnSync(
        [
          'psql',
          databaseUrl ?? '',
          '-v',
          'ON_ERROR_STOP=1',
          '-q',
          '-f',
          join( import.meta.dir, 'schema.sql' ),
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect( loaded.exitCode ).toBe( 0 );

      expect( psql(
        `insert into calendar values ('${ cal1 }','America/New_York','none'),
           ('${ cal2 }','UTC','none');
         insert into entity (id, entity_type, name, parent_id) values
           ('${ ent1 }','a','a',null), ('${ ent2 }','b','b','${ ent1 }');
         insert into calendar_event (id, calendar_id, title, start_at, end_at)
           values ('${ evt }','${ cal1 }','x',
                   '2026-09-08T13:00Z','2026-09-08T14:00Z');`,
      ).ok ).toBe( true );

      const mustFail: [ string, string ][] = [
        [
          'unknown time zone',
          `insert into calendar values (gen_random_uuid(),'Not/AZone','none')`,
        ],
        [
          'entity cycle',
          `update entity set parent_id='${ ent2 }' where id='${ ent1 }'`,
        ],
        [
          'self parent',
          `update entity set parent_id=id where id='${ ent1 }'`,
        ],
        [
          'overlapping exclusive event',
          `insert into calendar_event (id, calendar_id, title, start_at, end_at)
           values (gen_random_uuid(),'${ cal1 }','y',
                   '2026-09-08T13:30Z','2026-09-08T14:30Z')`,
        ],
        [
          'recurrence interval 0',
          `insert into calendar_event (id, calendar_id, title, start_at, end_at, recurrence)
           values (gen_random_uuid(),'${ cal2 }','r',
                   '2026-10-08T13:00Z','2026-10-08T14:00Z',
                   '{"freq":"daily","interval":0}')`,
        ],
        [
          'recurrence until and count',
          `insert into calendar_event (id, calendar_id, title, start_at, end_at, recurrence)
           values (gen_random_uuid(),'${ cal2 }','r',
                   '2026-10-08T13:00Z','2026-10-08T14:00Z',
                   '{"freq":"daily","until":"2027-01-01T00:00:00.000Z","count":2}')`,
        ],
        [
          'booking on another calendar than its event',
          `insert into booking (id, calendar_id, start_at, end_at, event_id)
           values (gen_random_uuid(),'${ cal2 }',
                   '2026-09-08T13:00Z','2026-09-08T14:00Z','${ evt }')`,
        ],
      ];
      for ( const [ label, statement ] of mustFail ) {
        const result = psql( statement );
        expect( `${ label }: ${ result.ok }` ).toBe( `${ label }: false` );
      }
    } );
  },
);
