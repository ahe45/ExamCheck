import { IsOptional, IsString, Length, Matches, MaxLength } from "class-validator";
import type { CreateWorkstationInput } from "./workstations.types.js";

export class CreateWorkstationDto implements CreateWorkstationInput {
  @IsString()
  @Length(2, 100)
  @Matches(/^[A-Z0-9_-]+$/)
  code!: string;

  @IsString()
  @Length(2, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
