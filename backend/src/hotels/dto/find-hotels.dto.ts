import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Guard rails for the only untrusted input in the system: the query string. */
export class FindHotelsDto {
  @IsString()
  @IsNotEmpty({ message: 'city is required' })
  @MaxLength(64)
  city!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minPrice must be an integer' })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice must be an integer' })
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxPrice?: number;
}
