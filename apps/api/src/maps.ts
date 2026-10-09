import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { q, tx } from './db';

// These counters control Vanly, not requests made directly with a browser API key.
// Google Cloud API/referrer restrictions and provider quotas are required separately.
export function mapsSettings() {
  const limit = (name: string, fallback: number, ceiling: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback;
  };
  return {
    enabled:
      process.env.GOOGLE_MAPS_ENABLED === 'true' &&
      process.env.GOOGLE_MAPS_QUOTAS_CONFIRMED === 'true' &&
      /^AIza[\w-]{30,}$/.test(process.env.GOOGLE_MAPS_BROWSER_KEY || ''),
    map: {
      day: limit('GOOGLE_MAPS_DAILY_LOADS', 100, 200),
      month: limit('GOOGLE_MAPS_MONTHLY_LOADS', 2000, 6000),
    },
    places: {
      day: limit('GOOGLE_PLACES_DAILY_QUERIES', 200, 250),
      month: limit('GOOGLE_PLACES_MONTHLY_QUERIES', 6000, 7500),
    },
  };
}

@Controller('api/v1/maps')
export class MapsController {
  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status() {
    const settings = mapsSettings();
    if (!settings.enabled) return { enabled: false, available: false };
    const today = new Date().toISOString().slice(0, 10);
    const counts = await q(
      'SELECT period,kind,requests FROM maps_usage WHERE period=ANY($1::text[])',
      [[today, today.slice(0, 7)]],
    );
    const available = counts.every(
      (r: any) =>
        r.requests < settings[r.kind as 'map' | 'places'][r.period.length === 10 ? 'day' : 'month'],
    );
    return { enabled: true, available };
  }

  @Post('permit')
  @Header('Cache-Control', 'no-store')
  async permit(@Body() body: unknown) {
    const { operation } = z
      .object({ operation: z.enum(['map', 'search', 'details']) })
      .strict()
      .parse(body);
    const settings = mapsSettings();
    if (!settings.enabled)
      throw new ServiceUnavailableException(
        'Mapa Google czeka na uruchomienie. Możesz otworzyć wyniki bezpośrednio w Google Maps.',
      );
    const kind = operation === 'map' ? 'map' : 'places';
    await tx(async (db) => {
      // Shared lock protects both windows, including concurrent tabs and API processes.
      await db.query('SELECT pg_advisory_xact_lock(822320)');
      const today = new Date().toISOString().slice(0, 10);
      for (const [period, max] of [
        [today, settings[kind].day],
        [today.slice(0, 7), settings[kind].month],
      ] as const) {
        await db.query('INSERT INTO maps_usage(period,kind) VALUES($1,$2) ON CONFLICT DO NOTHING', [
          period,
          kind,
        ]);
        const rows = await q(
          'UPDATE maps_usage SET requests=requests+1 WHERE period=$1 AND kind=$2 AND requests<$3 RETURNING requests',
          [period, kind, max],
          db,
        );
        if (!rows.length)
          throw new HttpException(
            'Wyczerpaliśmy bieżący limit map i wyszukiwania. Możesz nadal korzystać z Google Maps bezpośrednio.',
            429,
          );
      }
    });
    return operation === 'map'
      ? {
          allowed: true,
          browserKey: process.env.GOOGLE_MAPS_BROWSER_KEY,
          mapId: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
        }
      : { allowed: true };
  }
}
