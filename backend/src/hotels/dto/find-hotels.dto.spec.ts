import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FindHotelsDto } from './find-hotels.dto.js';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const parse = (query: Record<string, unknown>) =>
  pipe.transform(query, { type: 'query', metatype: FindHotelsDto });

describe('FindHotelsDto', () => {
  it('coerces price strings from the query string to numbers', async () => {
    await expect(parse({ city: 'delhi', minPrice: '4000', maxPrice: '6000' })).resolves.toEqual({
      city: 'delhi',
      minPrice: 4000,
      maxPrice: 6000,
    });
  });

  it('requires a city', async () => {
    await expect(parse({})).rejects.toThrow(BadRequestException);
    await expect(parse({ city: '' })).rejects.toThrow(BadRequestException);
  });

  it('rejects prices that are not non-negative integers', async () => {
    await expect(parse({ city: 'delhi', minPrice: 'cheap' })).rejects.toThrow(BadRequestException);
    await expect(parse({ city: 'delhi', minPrice: '-1' })).rejects.toThrow(BadRequestException);
    await expect(parse({ city: 'delhi', maxPrice: '10.5' })).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown query parameters instead of silently ignoring them', async () => {
    await expect(parse({ city: 'delhi', sortBy: 'price' })).rejects.toThrow(BadRequestException);
  });
});
