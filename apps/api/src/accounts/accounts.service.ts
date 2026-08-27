import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { AccountsApplicationService } from "./accounts.application.js";
import type { CreateAccountDto, UpdateAccountDto } from "./accounts.dto.js";
import { AccountsRepository } from "./accounts.repository.js";

export { assertGeneralAccountTarget } from "./accounts.application.js";

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(AccountsRepository) private readonly repository: AccountsRepository,
    @Inject(AccountsApplicationService) private readonly application: AccountsApplicationService,
  ) {}

  list() {
    return this.repository.list(this.pool);
  }

  admissions() {
    return this.repository.listAdmissionNames(this.pool);
  }

  create(input: CreateAccountDto, actor: AuthenticatedUser) {
    return this.application.create(input, actor);
  }

  update(id: number, input: UpdateAccountDto, actor: AuthenticatedUser) {
    return this.application.update(id, input, actor);
  }

  remove(id: number, actor: AuthenticatedUser) {
    return this.application.remove(id, actor);
  }
}
