import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class SetAvailabilityDto {
  /** Accepts the string forms a form post sends, but nothing looser than that. */
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'available must be true or false' })
  available!: boolean;
}
