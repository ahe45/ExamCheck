import { IsString, Length } from "class-validator";

export class LoginDto {
  @IsString()
  @Length(1, 100)
  loginId!: string;

  @IsString()
  @Length(4, 200)
  password!: string;
}
